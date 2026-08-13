
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis({ host: "localhost", port: 6379, maxRetriesPerRequest: null });

async function checkQueue(queueName: string) {
  const queue = new Queue(queueName, { connection });
  const counts = await queue.getJobCounts();
  const failed = await queue.getFailed(0, 3);
  const failedReasons = failed.map(j => j.failedReason);
  return { name: queueName, counts, failedReasons };
}

async function main() {
  const ingest = await checkQueue("ingest-queue");
  const notifications = await checkQueue("notification-queue");
  console.log(JSON.stringify({ ingest, notifications }, null, 2));
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

