// src/jobs/workers/ingest.worker.ts
import { Worker } from 'bullmq';
import { redisConnection } from '../redis.js';
import { prisma } from '../../db/prisma.js';
import { matchAndNotify } from '../../features/notification/matcher.js';

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

function safeTake(x: unknown) {
  const n = Number(x ?? 20);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : 20;
}

function extractListingData(listing: any, source: string) {
  let price: number | null = null;
  let locationText: string | null = null;

  if (source === 'kp') {
    price = typeof listing.priceNumber === 'number' ? listing.priceNumber : null;
    locationText = listing.location || null;
  } else if (source.startsWith('pa-')) {
    // Za PA, priceEur je string, pretvorite u number
    const priceStr = listing.priceEur || '';
    const priceMatch = priceStr.match(/(\d+(?:\.\d+)?)/);
    price = priceMatch ? parseFloat(priceMatch[1]) : null;
    locationText = listing.city || null;
  } else if (source.startsWith('fb-')) {
    price = typeof listing.price === 'number' ? listing.price : null;
    locationText = listing.locationText || null;
  }

  return { price, locationText };
}

async function upsertListingsBySource(
  source: string,
  listings: any[],
): Promise<number> {
  let upserted = 0;

  for (const it of listings) {
    const externalId = String(it.id);
    if (!externalId || !it.title || !it.url) continue;

    const { price, locationText } = extractListingData(it, source);

    await prisma.listing.upsert({
      where: { source_externalId: { source, externalId } },
      update: {
        title: it.title,
        url: it.url,
        price,
        locationText,
        raw: it as any,
      },
      create: {
        source,
        externalId,
        title: it.title,
        url: it.url,
        price,
        locationText,
        raw: it as any,
        createdAt: new Date(),
      },
    });

    upserted++;
  }

  return upserted;
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

    try {
      paCars = await scrapePaLatestCars({ take });
    } catch (error) {
      console.error('[ingest] PA cars scrape failed', error);
    }

    try {
      paMotos = await scrapePaLatestMotos({ take });
    } catch (error) {
      console.error('[ingest] PA motos scrape failed', error);
    }

    try {
      paMotoPartsBeta = await scrapePaMotoPartsAndEquipmentBeta({ take });
    } catch (error) {
      console.error('[ingest] PA moto parts beta scrape failed', error);
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
    const before = await prisma.listing.count();
    console.log('[ingest] db before count', before);

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

    const after = await prisma.listing.count();
    console.log('[ingest] db after count', after);
  },
  { connection: redisConnection }
);
