import { prisma } from './prisma.js';

export async function deleteListingsOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await prisma.listing.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  return result.count;
}
