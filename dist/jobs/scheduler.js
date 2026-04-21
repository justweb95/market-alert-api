import { ingestQueue, maintenanceQueue, notificationQueue } from './queues.js';
async function replaceRepeatableByName(queue, name, data, pattern, jobId) {
    const existing = await queue.getRepeatableJobs();
    for (const repeatable of existing) {
        if (repeatable.name === name) {
            await queue.removeRepeatableByKey(repeatable.key);
        }
    }
    await queue.add(name, data, {
        jobId,
        repeat: { pattern },
    });
}
export async function startSchedulers() {
    const scrapeInterval = parseInt(process.env.SCRAPE_INTERVAL_MINUTES || '5', 10);
    const notificationInterval = parseInt(process.env.NOTIFICATION_INTERVAL_MINUTES || '2', 10);
    // Scrape svaka X minuta
    await replaceRepeatableByName(ingestQueue, 'ingest_latest', { take: 50 }, `*/${scrapeInterval} * * * *`, 'repeat-ingest-latest');
    // Notifikacije svaka Y minuta
    await replaceRepeatableByName(notificationQueue, 'check_notifications', {}, `*/${notificationInterval} * * * *`, 'repeat-check-notifications');
    // cleanup jednom dnevno (briše listing-e starije od 2 dana)
    await replaceRepeatableByName(maintenanceQueue, 'cleanup_old_listings', { days: 2 }, '10 3 * * *', 'repeat-cleanup-old-listings');
    const ingestRepeat = await ingestQueue.getRepeatableJobs();
    const notificationRepeat = await notificationQueue.getRepeatableJobs();
    const maintenanceRepeat = await maintenanceQueue.getRepeatableJobs();
    console.log('Repeatable ingest jobs:', ingestRepeat);
    console.log('Repeatable notification jobs:', notificationRepeat);
    console.log('Repeatable maintenance jobs:', maintenanceRepeat);
}
//# sourceMappingURL=scheduler.js.map