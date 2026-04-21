
import { prisma } from "./src/db/prisma";

async function main() {
  const listingCount = await prisma.listing.count();
  const listingBySource = await prisma.listing.groupBy({
    by: ["source"],
    _count: { source: true }
  });
  const audiUnder20k = await prisma.listing.findMany({
    where: {
      title: { contains: "audi", mode: "insensitive" },
      price: { lte: 20000 }
    },
    take: 10,
    orderBy: { createdAt: "desc" }
  });
  const cheapCandidates = await prisma.listing.findMany({
    where: {
      price: { lte: 20000 },
      OR: [
        { title: { contains: "audi", mode: "insensitive" } },
        { title: { contains: "bmw", mode: "insensitive" } },
        { title: { contains: "golf", mode: "insensitive" } },
        { title: { contains: "iphone", mode: "insensitive" } },
        { title: { contains: "samsung", mode: "insensitive" } }
      ]
    },
    take: 10,
    orderBy: { createdAt: "desc" }
  });
  const activeAlerts = await prisma.alert.findMany({
    select: { id: true, category: true, priceMax: true, keywords: true }
  });

  console.log(JSON.stringify({ listingCount, listingBySource, audiUnder20k, cheapCandidates, activeAlerts }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());

