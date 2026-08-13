// src/jobs/workers/ingest.worker.ts
import { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { redisConnection } from '../redis.js';
import { prisma } from '../../db/prisma.js';
import { matchAndNotify } from '../../features/notification/matcher.js';
import { normalizePriceToEur } from '../../helpers/currency.helper.js';

import { scrapeKpLatest } from '../../features/kpPages/kpPages.scraper.js';
import {
  scrapePaLatestCars,
  scrapePaLatestMotos,
  scrapePaMotoPartsAndEquipmentBeta,
} from '../../features/paPages/paPages.scraper.js';
import {
  scrapeFacebookGroupsLatest,
  scrapeFacebookMarketplaceLatest,
} from '../../features/facebookPages/facebookSources.scraper.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// PA je jedini izvor iza Cloudflare-a (headed Chromium prolazi izazov, ali svaki
// prolaz je "skup" u smislu bot-fingerprint-a). Da ne bismo gadjali PA na svaki
// ingest ciklus (podrazumevano 5 min = 864 zahteva/dan), PA se skrejpuje ređe,
// nezavisno od KP intervala. In-memory timestamp je dovoljan — worker je jedan
// dugotrajan proces, restart samo resetuje tajmer (bezopasno, samo jedan raniji
// PA prolaz taj ciklus).
let lastPaRunAt = 0;
function shouldRunPaThisCycle(): boolean {
  const intervalMs = Number(process.env.PA_SCRAPE_INTERVAL_MINUTES ?? 15) * 60_000;
  if (Date.now() - lastPaRunAt < intervalMs) return false;
  lastPaRunAt = Date.now();
  return true;
}

function jitter(minMs: number, maxMs: number) {
  return sleep(Math.floor(minMs + Math.random() * (maxMs - minMs)));
}

function safeTake(x: unknown) {
  const n = Number(x ?? 20);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : 20;
}

function extractListingData(listing: any, source: string) {
  let price: number | null = null;
  let locationText: string | null = null;

  if (source === 'kp') {
    price = normalizePriceToEur({
      amount: listing.priceNumber,
      hints: [listing.currencyAcronym, listing.currency, listing.priceText],
    });
    locationText = listing.location || null;
  } else if (source.startsWith('pa-')) {
    price = normalizePriceToEur({
      amount: listing.priceEur,
      explicitCurrency: 'EUR',
      hints: [listing.priceEur],
    });
    locationText = listing.city || null;
  } else if (source.startsWith('fb-')) {
    price = normalizePriceToEur({
      amount: listing.price,
      hints: [
        typeof listing.price === 'string' ? listing.price : null,
        listing.title,
        typeof listing.raw?.price === 'string' ? listing.raw.price : null,
      ],
    });
    locationText = listing.locationText || null;
  }

  return { price, locationText };
}

async function upsertListingsBySource(
  source: string,
  listings: any[],
): Promise<number> {
  if (listings.length === 0) return 0;

  // Keep only valid listings and de-duplicate by externalId to avoid redundant DB work.
  const deduped = new Map<string, any>();
  for (const item of listings) {
    const externalId = String(item?.id ?? '');
    if (!externalId || !item?.title || !item?.url) continue;
    deduped.set(externalId, item);
  }

  const rows = Array.from(deduped.entries()).map(([externalId, item]) => {
    const { price, locationText } = extractListingData(item, source);
    return {
      id: randomUUID(),
      source,
      externalId,
      title: String(item.title),
      url: String(item.url),
      price,
      locationText,
      rawJson: JSON.stringify(item ?? {}),
    };
  });

  if (rows.length === 0) return 0;

  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const values = chunk.map((row) =>
      Prisma.sql`(${row.id}, ${row.source}, ${row.externalId}, ${row.title}, ${row.price}, ${row.locationText}, ${row.url}, ${row.rawJson}::jsonb)`
    );

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "Listing" ("id", "source", "externalId", "title", "price", "locationText", "url", "raw")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("source", "externalId")
        DO UPDATE SET
          "title" = EXCLUDED."title",
          "price" = EXCLUDED."price",
          "locationText" = EXCLUDED."locationText",
          "url" = EXCLUDED."url",
          "raw" = EXCLUDED."raw"
      `
    );
  }

  return rows.length;
}

export const ingestWorker = new Worker(
  'ingest',
  async (job) => {
    if (job.name !== 'ingest_latest') return;

    console.log('[ingest] job', { id: job.id, data: job.data });
    console.log('[ingest] DATABASE_URL', process.env.DATABASE_URL);

    const FAST = process.env.INGEST_FAST === '1';
    const minMs = FAST ? 500 : 20_000;
    const maxMs = FAST ? 1_500 : 60_000;

    const jitterMs = Math.floor(minMs + Math.random() * (maxMs - minMs));
    console.log('[ingest] sleeping ms', jitterMs);
    await sleep(jitterMs);

    const take = safeTake(job.data?.take);

    // ---- 1) SCRAPE ----
    let kp = { listings: [] as Awaited<ReturnType<typeof scrapeKpLatest>>['listings'] };
    let paCars = { listings: [] as Awaited<ReturnType<typeof scrapePaLatestCars>>['listings'] };
    let paMotos = { listings: [] as Awaited<ReturnType<typeof scrapePaLatestMotos>>['listings'] };
    let paMotoPartsBeta = {
      listings: [] as Awaited<ReturnType<typeof scrapePaMotoPartsAndEquipmentBeta>>['listings'],
    };
    let fbGroups = { listings: [] as Awaited<ReturnType<typeof scrapeFacebookGroupsLatest>>['listings'] };
    let fbMarketplace = {
      listings: [] as Awaited<ReturnType<typeof scrapeFacebookMarketplaceLatest>>['listings'],
    };

    try {
      kp = await scrapeKpLatest({ page: 1, take });
    } catch (error) {
      console.error('[ingest] KP scrape failed', error);
    }

    if (shouldRunPaThisCycle()) {
      try {
        paCars = await scrapePaLatestCars({ take });
      } catch (error) {
        console.error('[ingest] PA cars scrape failed', error);
      }

      await jitter(2_000, 8_000);

      try {
        paMotos = await scrapePaLatestMotos({ take });
      } catch (error) {
        console.error('[ingest] PA motos scrape failed', error);
      }

      await jitter(2_000, 8_000);

      try {
        paMotoPartsBeta = await scrapePaMotoPartsAndEquipmentBeta({ take });
      } catch (error) {
        console.error('[ingest] PA moto parts beta scrape failed', error);
      }
    } else {
      console.log('[ingest] skipping PA this cycle (PA_SCRAPE_INTERVAL_MINUTES not elapsed)');
    }

    try {
      fbGroups = await scrapeFacebookGroupsLatest({ take });
    } catch (error) {
      console.error('[ingest] FB groups scrape failed', error);
    }

    try {
      fbMarketplace = await scrapeFacebookMarketplaceLatest({ take });
    } catch (error) {
      console.error('[ingest] FB marketplace scrape failed', error);
    }

    console.log('[ingest] scraped', {
      kp: kp.listings.length,
      paCars: paCars.listings.length,
      paMotos: paMotos.listings.length,
      paMotoPartsBeta: paMotoPartsBeta.listings.length,
      fbGroups: fbGroups.listings.length,
      fbMarketplace: fbMarketplace.listings.length,
    });

    // ---- 2) UPSERT (NO DUPES) ----
    const enableIngestCountLogs = process.env.INGEST_COUNT_LOGS === '1';
    if (enableIngestCountLogs) {
      const before = await prisma.listing.count();
      console.log('[ingest] db before count', before);
    }

    console.time('[ingest] upsert_total');
    try {
      let upserted = 0;

      upserted += await upsertListingsBySource('kp', kp.listings);
      upserted += await upsertListingsBySource('pa-car', paCars.listings);
      upserted += await upsertListingsBySource('pa-moto', paMotos.listings);
      upserted += await upsertListingsBySource('pa-moto-parts-beta', paMotoPartsBeta.listings);
      upserted += await upsertListingsBySource('fb-group', fbGroups.listings);
      upserted += await upsertListingsBySource('fb-marketplace', fbMarketplace.listings);

      console.log('[ingest] upserted', upserted);

      // ---- 3) MATCH & NOTIFY (za listinge koji su stvarno scrape-ovani) ----
      const matchConditions = [
        ...kp.listings.map((x) => ({ source: 'kp', externalId: String(x.id) })),
        ...paCars.listings.map((x) => ({ source: 'pa-car', externalId: String(x.id) })),
        ...paMotos.listings.map((x) => ({ source: 'pa-moto', externalId: String(x.id) })),
        ...paMotoPartsBeta.listings.map((x) => ({ source: 'pa-moto-parts-beta', externalId: String(x.id) })),
        ...fbGroups.listings.map((x) => ({ source: 'fb-group', externalId: String(x.id) })),
        ...fbMarketplace.listings.map((x) => ({ source: 'fb-marketplace', externalId: String(x.id) })),
      ];

      if (matchConditions.length > 0) {
        const dbListings = await prisma.listing.findMany({
          where: { OR: matchConditions },
        });

        console.log('[ingest] matching', dbListings.length, 'listings against alerts');
        await matchAndNotify(dbListings);
      } else {
        console.log('[ingest] no listings scraped; skipping matchAndNotify');
      }

    } catch (e) {
      console.error('[ingest] UPSERT FAILED', e);
      throw e;
    } finally {
      console.timeEnd('[ingest] upsert_total');
    }

    if (enableIngestCountLogs) {
      const after = await prisma.listing.count();
      console.log('[ingest] db after count', after);
    }
  },
  { connection: redisConnection }
);
