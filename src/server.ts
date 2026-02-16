import "dotenv/config";
import { app } from "./app.js";
import { prisma } from "./db.ts";

import { facebookPagesRouter } from "./features/facebookPages/facebookPages.routes.js";
import { kpPagesRouter } from "./features/kpPages/kpPages.routes.ts";
import { paPagesRouter } from "./features/paPages/paPages.routes.ts";


import 'dotenv/config';
import { startSchedulers } from './jobs/scheduler';

import './jobs/workers/ingest.worker';
import './jobs/workers/maintenance.worker';

await startSchedulers();


const port = Number(process.env.PORT ?? 3000);

// Facebook Pages API routes
app.use("/api/facebook-pages", facebookPagesRouter);
// KupujemProdajem API routes
app.use('/api/kp/', kpPagesRouter);
// PolovniAutomobili API routes
app.use('/api/pa/', paPagesRouter);

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://localhost:${port}`);
});


app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/debug/listings", async (req, res) => {
  const count = await prisma.listing.count();
  const last10 = await prisma.listing.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  
  res.json({ count, last10 });
});


import { Queue } from 'bullmq';
import { redisConnection } from './jobs/redis';

const ingestQueue = new Queue('ingest', { connection: redisConnection });

app.post('/debug/run-ingest', async (req, res) => {
  const job = await ingestQueue.add('ingest_latest', { take: 5 });
  res.json({ ok: true, jobId: job.id });
});


