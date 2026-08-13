// src/jobs/workers/notification.worker.ts
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { redisConnection } from '../redis.js';
import { prisma } from '../../db/prisma.js';
import { matchAndNotify, retryFailedNotifications } from '../../features/notification/matcher.js';

const NOTIFICATION_CURSOR_KEY = 'notification:last-check-at';
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 5 * 60 * 1000;

const redisClient = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
});

async function resolveListingWindow(now: Date): Promise<{ from: Date; to: Date }> {
  const defaultFrom = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);

  try {
    const rawCursor = await redisClient.get(NOTIFICATION_CURSOR_KEY);
    if (!rawCursor) {
      return { from: defaultFrom, to: now };
    }

    const parsed = new Date(rawCursor);
    if (Number.isNaN(parsed.getTime())) {
      return { from: defaultFrom, to: now };
    }

    const withOverlap = new Date(parsed.getTime() - OVERLAP_MS);
    return {
      from: withOverlap > defaultFrom ? withOverlap : defaultFrom,
      to: now,
    };
  } catch {
    return { from: defaultFrom, to: now };
  }
}

export const notificationWorker = new Worker(
  'notification',
  async (job) => {
    if (job.name !== 'check_notifications') return;

    console.log('[notification] job', { id: job.id });

    const now = new Date();
    const { from, to } = await resolveListingWindow(now);

    // Inkrementalni prozor sa overlap-om smanjuje CPU/DB trosak bez promene ishoda (dedup je u matcher-u).
    const recentListings = await prisma.listing.findMany({
      where: {
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      select: {
        id: true,
        source: true,
        title: true,
        price: true,
        locationText: true,
        url: true,
      },
    });

    console.log('[notification] checking', recentListings.length, 'recent listings against alerts', {
      from: from.toISOString(),
      to: to.toISOString(),
    });

    await matchAndNotify(recentListings);
    await retryFailedNotifications();

    try {
      await redisClient.set(NOTIFICATION_CURSOR_KEY, to.toISOString());
    } catch {
      // Best effort; failure should not block worker flow.
    }
  },
  { connection: redisConnection }
);