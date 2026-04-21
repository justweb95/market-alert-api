import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';
export const ingestQueue = new Queue('ingest', { connection: redisConnection });
export const maintenanceQueue = new Queue('maintenance', { connection: redisConnection });
export const notificationQueue = new Queue('notification', { connection: redisConnection });
//# sourceMappingURL=queues.js.map