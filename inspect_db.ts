import { prisma } from './src/db/prisma';

async function main() {
    try {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

        const notifications = await prisma.notification.findMany({
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                status: true,
                title: true,
                createdAt: true,
                sentAt: true,
                failedAt: true,
                deviceId: true,
            }
        });

        const recentNotificationsCount = await prisma.notification.count({
            where: {
                createdAt: { gte: thirtyMinsAgo }
            }
        });

        const recentListingsCount = await prisma.listing.count({
            where: {
                createdAt: { gte: thirtyMinsAgo }
            }
        });

        console.log(JSON.stringify({
            now: now.toISOString(),
            latestNotifications: notifications,
            recentNotificationsCount,
            recentListingsCount
        }, null, 2));
    } catch (error) {
        console.error('Error during execution:', error);
    }
}

main()
    .catch(e => {
        console.error('Fatal error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
