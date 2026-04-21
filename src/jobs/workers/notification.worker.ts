// src/jobs/workers/notification.worker.ts
import { Worker } from 'bullmq';
import { redisConnection } from '../redis.js';
import { prisma } from '../../db/prisma.js';
import { matchAndNotify, retryFailedNotifications } from '../../features/notification/matcher.js';

export const notificationWorker = new Worker(
  'notification',
  async (job) => {
    if (job.name !== 'check_notifications') return;

    console.log('[notification] job', { id: job.id });

    // Dohvati listing-e iz poslednjih 24 sati za matching
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentListings = await prisma.listing.findMany({
      where: {
        createdAt: {
          gte: oneDayAgo,
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

    console.log('[notification] checking', recentListings.length, 'recent listings against alerts');
    await matchAndNotify(recentListings);
    await retryFailedNotifications();
  },
  { connection: redisConnection }
);