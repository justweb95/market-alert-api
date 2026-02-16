import { Worker } from 'bullmq';
import { redisConnection } from '../redis';
import { prisma } from '../../db/prisma';

export const maintenanceWorker = new Worker(
  'maintenance',
  async (job) => {
    if (job.name !== 'cleanup_old_listings') return;

    const days = Number(job.data?.days ?? 2);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // prvo obriši logove koji referenciraju listing-e (FK)
    await prisma.notificationLog.deleteMany({
      where: {
        listing: { createdAt: { lt: cutoff } },
      },
    });

    const deleted = await prisma.listing.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return { deleted: deleted.count, days };
  },
  { connection: redisConnection }
);
