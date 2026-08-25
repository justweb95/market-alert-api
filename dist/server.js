import "dotenv/config";
import { app, installErrorHandler } from "./app.js";
import { prisma } from "./db.js";
import { facebookPagesRouter } from "./features/facebookPages/facebookPages.routes.js";
import { kpPagesRouter } from "./features/kpPages/kpPages.routes.js";
import { paPagesRouter } from "./features/paPages/paPages.routes.js";
import { notificationRouter } from "./features/notification/notification.routes.js";
import { subscriptionRouter } from "./features/subscription/subscription.routes.js";
import { statisticRouter } from "./features/statistic/statistic.routes.js";
import { generalLimiter, scraperJobLimiter } from "./lib/rate-limit.js";
import { Queue } from "bullmq";
import { startSchedulers } from "./jobs/scheduler.js";
import { redisConnection } from "./jobs/redis.js";
import { startIngestWatchdog } from "./jobs/watchdog.js";
import "./jobs/workers/ingest.worker.js";
import "./jobs/workers/maintenance.worker.js";
import "./jobs/workers/notification.worker.js";
await startSchedulers();
startIngestWatchdog();
const DEBUG_ROUTES_ENABLED = process.env.DEBUG_ROUTES_ENABLED === "1";
const DEBUG_ROUTES_TOKEN = process.env.DEBUG_ROUTES_TOKEN?.trim();
function requireDebugAccess(req, res, next) {
    if (!DEBUG_ROUTES_ENABLED) {
        return res.status(404).json({ error: "Not found" });
    }
    if (!DEBUG_ROUTES_TOKEN) {
        return res.status(503).json({ error: "Debug routes are disabled until DEBUG_ROUTES_TOKEN is set" });
    }
    const token = req.headers["x-debug-token"];
    const providedToken = Array.isArray(token) ? token[0] : token;
    if (providedToken !== DEBUG_ROUTES_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}
const port = Number(process.env.PORT ?? 3000);
// Apply global rate limiting to all /api routes
app.use("/api", generalLimiter);
// Facebook Pages API routes
app.use("/api/facebook-pages", facebookPagesRouter);
// KupujemProdajem API routes
app.use('/api/kp/', kpPagesRouter);
// PolovniAutomobili API routes
app.use('/api/pa/', paPagesRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/subscription', subscriptionRouter);
app.use('/api/statistic', statisticRouter);
const server = app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on http://localhost:${port}`);
});
/**
 * Graceful Shutdown Handler
 * Ensures all pending jobs finish and data is safely flushed
 */
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('⚠️  Shutdown already in progress...');
        return;
    }
    isShuttingDown = true;
    console.log(`\n🔴 Received ${signal} signal, starting graceful shutdown...`);
    // Stop accepting new connections
    server.close(async () => {
        console.log('✅ HTTP server closed');
        try {
            // Wait for background jobs to complete (max 10 seconds)
            console.log('⏳ Waiting for background jobs to complete (10s timeout)...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            // Disconnect Redis
            console.log('🔌 Disconnecting Redis...');
            // Note: redisConnection is used by BullMQ workers
            // Workers will be cleaned up automatically
            // Disconnect database
            console.log('🔌 Disconnecting database...');
            await prisma.$disconnect();
            console.log('✅ Database disconnected');
            console.log('✅ Graceful shutdown complete');
            process.exit(0);
        }
        catch (err) {
            console.error('❌ Error during shutdown:', err);
            process.exit(1);
        }
    });
    // Force shutdown after 30 seconds if still running
    setTimeout(() => {
        console.error('❌ Forced shutdown (30s timeout exceeded)');
        process.exit(1);
    }, 30000);
}
// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
});
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', { reason, promise });
    gracefulShutdown('unhandledRejection');
});
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});
app.get("/debug/listings", scraperJobLimiter, requireDebugAccess, async (req, res) => {
    const count = await prisma.listing.count();
    const last10 = await prisma.listing.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
    });
    res.json({ count, last10 });
});
const ingestQueue = new Queue("ingest", { connection: redisConnection });
app.post("/debug/run-ingest", scraperJobLimiter, requireDebugAccess, async (req, res) => {
    const job = await ingestQueue.add("ingest_latest", { take: 5 });
    res.json({ ok: true, jobId: job.id });
});
// 404 za nepoznate rute — konzistentan JSON umesto Express default HTML stranice
app.use((req, res) => {
    res.status(404).json({ error: "Ruta ne postoji" });
});
// Mora biti POSLEDNJI middleware registrovan — Express hvata greske samo iz
// ruta/middleware-a registrovanih PRE error handler-a.
installErrorHandler();
//# sourceMappingURL=server.js.map