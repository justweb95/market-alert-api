// src/jobs/workers/ingest.worker.ts
import { Worker } from 'bullmq';
import { redisConnection } from '../redis';
import { prisma } from '../../db/prisma';
import { matchAndNotify } from '../../features/notification/matcher.ts';

import { scrapeKpLatest } from '../../features/kpPages/kpPages.scraper.ts';
import { scrapePaLatestCars, scrapePaLatestMotos } from '../../features/paPages/paPages.scraper.ts';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeTake(x: unknown) {
  const n = Number(x ?? 20);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : 20;
}

export const ingestWorker = new Worker(
  'ingest',
  async (job) => {
    if (job.name !== 'ingest_latest') return;

    console.log('[ingest] job', { id: job.id, data: job.data });
    console.log('[ingest] DATABASE_URL', process.env.DATABASE_URL);

    const FAST = process.env.INGEST_FAST === '1';
    const minMs = FAST ? 500 : (8 * 60 + 39) * 1000;
    const maxMs = FAST ? 1500 : (11 * 60 + 23) * 1000;

    const jitterMs = Math.floor(minMs + Math.random() * (maxMs - minMs));
    console.log('[ingest] sleeping ms', jitterMs);
    await sleep(jitterMs);

    const take = safeTake(job.data?.take);

    // ---- 1) SCRAPE ----
    const kp = await scrapeKpLatest({ page: 1, take });
    const paCars = await scrapePaLatestCars({ take });
    const paMotos = await scrapePaLatestMotos({ take });

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
        await prisma.listing.upsert({
          where: { source_externalId: { source: 'kp', externalId: String(it.id) } },
          update: { title: it.title, url: it.url, raw: it as any },
          create: {
            source: 'kp',
            externalId: String(it.id),
            title: it.title,
            url: it.url,
            raw: it as any,
            createdAt: new Date(),
          },
        });
        upserted++;
      }

      // PA cars
      for (const it of paCars.listings) {
        await prisma.listing.upsert({
          where: { source_externalId: { source: 'pa-car', externalId: String(it.id) } },
          update: { title: it.title, url: it.url, raw: it as any },
          create: {
            source: 'pa-car',
            externalId: String(it.id),
            title: it.title,
            url: it.url,
            raw: it as any,
            createdAt: new Date(),
          },
        });
        upserted++;
      }

      // PA motos
      for (const it of paMotos.listings) {
        await prisma.listing.upsert({
          where: { source_externalId: { source: 'pa-moto', externalId: String(it.id) } },
          update: { title: it.title, url: it.url, raw: it as any },
          create: {
            source: 'pa-moto',
            externalId: String(it.id),
            title: it.title,
            url: it.url,
            raw: it as any,
            createdAt: new Date(),
          },
        });
        upserted++;
      }

      console.log('[ingest] upserted', upserted);

      // ---- 3) MATCH & NOTIFY (tek kad su SVI u bazi) ----
      const dbListings = await prisma.listing.findMany({
        where: {
          OR: [
            ...kp.listings.map((x) => ({ source: 'kp', externalId: String(x.id) })),
            ...paCars.listings.map((x) => ({ source: 'pa-car', externalId: String(x.id) })),
            ...paMotos.listings.map((x) => ({ source: 'pa-moto', externalId: String(x.id) })),
          ],
        },
      });

      console.log('[ingest] matching', dbListings.length, 'listings against alerts');
      await matchAndNotify(dbListings);

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
