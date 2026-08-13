import { prisma } from "./src/db/prisma";
async function main() {
  try {
    const notifications = await prisma.notification.count();
    const listings = await prisma.listing.count();
    console.log(`notifications: ${notifications}`);
    console.log(`listings: ${listings}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
