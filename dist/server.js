import "dotenv/config";
import { app, installErrorHandler } from "./app.js";
import { prisma } from "./db.js";
import { facebookPagesRouter } from "./features/facebookPages/facebookPages.routes.js";
import { kpPagesRouter } from "./features/kpPages/kpPages.routes.js";
import { paPagesRouter } from "./features/paPages/paPages.routes.js";
import { notificationRouter } from "./features/notification/notification.routes.js";
import { subscriptionRouter } from "./features/subscription/subscription.routes.js";
import { Queue } from "bullmq";
import { startSchedulers } from "./jobs/scheduler.js";
import { redisConnection } from "./jobs/redis.js";
import "./jobs/workers/ingest.worker.js";
import "./jobs/workers/maintenance.worker.js";
import "./jobs/workers/notification.worker.js";
await startSchedulers();
const port = Number(process.env.PORT ?? 3000);
// Facebook Pages API routes
app.use("/api/facebook-pages", facebookPagesRouter);
// KupujemProdajem API routes
app.use('/api/kp/', kpPagesRouter);
// PolovniAutomobili API routes
app.use('/api/pa/', paPagesRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/subscription', subscriptionRouter);
installErrorHandler();
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
const ingestQueue = new Queue("ingest", { connection: redisConnection });
app.post("/debug/run-ingest", async (req, res) => {
    const job = await ingestQueue.add("ingest_latest", { take: 5 });
    res.json({ ok: true, jobId: job.id });
});
//# sourceMappingURL=server.js.map