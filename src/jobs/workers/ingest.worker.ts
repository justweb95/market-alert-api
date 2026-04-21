// src/jobs/workers/ingest.worker.ts
import { Worker } from 'bullmq';
import { redisConnection } from '../redis.js';
import { prisma } from '../../db/prisma.js';
import { matchAndNotify } from '../../features/notification/matcher.js';

import { scrapeKpLatest } from '../../features/kpPages/kpPages.scraper.js';
import { scrapePaLatestCars, scrapePaLatestMotos } from '../../features/paPages/paPages.scraper.js';

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
  }

  return { price, locationText };
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

    console.log('[ingest] scraped', {
      kp: kp.listings.length,
      paCars: paCars.listings.length,
      paMotos: paMotos.listings.length,
    });

    // ---- 2) UPSERT (NO DUPES) ----
    const before = await prisma.listing.count();
    console.log('[ingest] db before count', before);

    console.time('[ingest] upsert_total');
    try {
      let upserted = 0;

      // KP
      for (const it of kp.listings) {
        const { price, locationText } = extractListingData(it, 'kp');
        await prisma.listing.upsert({
          where: { source_externalId: { source: 'kp', externalId: String(it.id) } },
          update: { title: it.title, url: it.url, price, locationText, raw: it as any },
          create: {
            source: 'kp',
            externalId: String(it.id),
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

      // PA cars
      for (const it of paCars.listings) {
        const { price, locationText } = extractListingData(it, 'pa-car');
        await prisma.listing.upsert({
          where: { source_externalId: { source: 'pa-car', externalId: String(it.id) } },
          update: { title: it.title, url: it.url, price, locationText, raw: it as any },
          create: {
            source: 'pa-car',
            externalId: String(it.id),
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

      // PA motos
      for (const it of paMotos.listings) {
        const { price, locationText } = extractListingData(it, 'pa-moto');
        await prisma.listing.upsert({
          where: { source_externalId: { source: 'pa-moto', externalId: String(it.id) } },
          update: { title: it.title, url: it.url, price, locationText, raw: it as any },
          create: {
            source: 'pa-moto',
            externalId: String(it.id),
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

      console.log('[ingest] upserted', upserted);

      // ---- 3) MATCH & NOTIFY (za listinge koji su stvarno scrape-ovani) ----
      const matchConditions = [
        ...kp.listings.map((x) => ({ source: 'kp', externalId: String(x.id) })),
        ...paCars.listings.map((x) => ({ source: 'pa-car', externalId: String(x.id) })),
        ...paMotos.listings.map((x) => ({ source: 'pa-moto', externalId: String(x.id) })),
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
