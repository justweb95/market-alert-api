import { ingestQueue, maintenanceQueue } from './queues';

export async function startSchedulers(): Promise<void> {
  // svaka 10 minuta
  await ingestQueue.add(
    'ingest_latest',
    { take: 50 },
    { repeat: { pattern: '*/10 * * * *' } }
  );

  // cleanup jednom dnevno (briše listing-e starije od 2 dana)
  await maintenanceQueue.add(
    'cleanup_old_listings',
    { days: 2 },
    { repeat: { pattern: '10 3 * * *' } } // 03:10
  );





  const ingestRepeat = await ingestQueue.getRepeatableJobs();
  const maintenanceRepeat = await maintenanceQueue.getRepeatableJobs();

  console.log('Repeatable ingest jobs:', ingestRepeat);
  console.log('Repeatable maintenance jobs:', maintenanceRepeat);

}
