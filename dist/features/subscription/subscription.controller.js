import { prisma } from "../../db/prisma.js";
// Product ID → PlanTier mapping — must match what you configure in App Store / Play Store / RevenueCat dashboard
const PRODUCT_TIER = {
    market_monitor_bronze_monthly: "BRONZE",
    market_monitor_silver_monthly: "SILVER",
    market_monitor_gold_monthly: "GOLD",
};
// RevenueCat event types that indicate an active, paid subscription
const ACTIVE_EVENTS = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "SUBSCRIPTION_EXTENDED",
]);
// RevenueCat event types that indicate the subscription is no longer active
const DEACTIVATION_EVENTS = new Set([
    "CANCELLATION",
    "EXPIRATION",
    "BILLING_ISSUE",
]);
// RevenueCat event types for pause (Android only via Google Play)
const PAUSE_EVENTS = new Set(["SUBSCRIPTION_PAUSED"]);
// POST /api/subscription/webhook
export async function handleRevenueCatWebhook(req, res) {
    // Validate shared secret header set in RevenueCat dashboard → Project → Integrations → Webhooks
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (secret) {
        const provided = req.headers["authorization"];
        if (provided !== secret) {
            console.warn("[subscription] Webhook auth failed");
            return res.status(401).json({ error: "Unauthorized" });
        }
    }
    const body = req.body;
    const event = body?.event;
    if (!event?.type || !event?.app_user_id) {
        return res.status(400).json({ error: "Invalid webhook payload" });
    }
    const appUserId = event.app_user_id;
    const productId = event.product_id;
    const renewsAt = event.expiration_at_ms
        ? new Date(event.expiration_at_ms)
        : null;
    console.log(`[subscription] Webhook event: ${event.type} for user: ${appUserId}, product: ${productId}`);
    // Find the user — app_user_id is our User.id
    const user = await prisma.user.findUnique({ where: { id: appUserId } });
    if (!user) {
        // May be an anonymous or deviceId-based user — log and accept gracefully
        console.warn(`[subscription] User not found for RC id: ${appUserId}`);
        return res.status(200).json({ ok: true, note: "User not found, ignored" });
    }
    const newTier = PRODUCT_TIER[productId] ?? "FREE";
    if (ACTIVE_EVENTS.has(event.type)) {
        // Upsert an active subscription record and upgrade user tier
        await prisma.$transaction([
            prisma.subscription.upsert({
                where: { userId: user.id },
                update: {
                    tier: newTier,
                    status: "ACTIVE",
                    productId,
                    renewsAt,
                    pausedAt: null,
                    cancelledAt: null,
                    updatedAt: new Date(),
                },
                create: {
                    userId: user.id,
                    tier: newTier,
                    status: "ACTIVE",
                    revenuecatId: appUserId,
                    productId,
                    renewsAt,
                    updatedAt: new Date(),
                },
            }),
            prisma.user.update({
                where: { id: user.id },
                data: { planTier: newTier },
            }),
        ]);
        console.log(`[subscription] Activated ${newTier} for user ${user.id}, renews: ${renewsAt?.toISOString()}`);
        return res.status(200).json({ ok: true });
    }
    if (DEACTIVATION_EVENTS.has(event.type)) {
        const newStatus = event.type === "CANCELLATION" ? "CANCELLED" : "EXPIRED";
        await prisma.$transaction([
            prisma.subscription.upsert({
                where: { userId: user.id },
                update: {
                    status: newStatus,
                    cancelledAt: new Date(),
                    renewsAt: null,
                    updatedAt: new Date(),
                },
                create: {
                    userId: user.id,
                    tier: newTier,
                    status: newStatus,
                    revenuecatId: appUserId,
                    productId,
                    cancelledAt: new Date(),
                    updatedAt: new Date(),
                },
            }),
            // Downgrade to FREE when subscription lapses
            prisma.user.update({
                where: { id: user.id },
                data: { planTier: "FREE" },
            }),
        ]);
        console.log(`[subscription] Deactivated (${newStatus}) for user ${user.id}`);
        return res.status(200).json({ ok: true });
    }
    if (PAUSE_EVENTS.has(event.type)) {
        const pauseExpiry = event.pause_expiration_date
            ? new Date(event.pause_expiration_date)
            : null;
        await prisma.subscription.upsert({
            where: { userId: user.id },
            update: {
                status: "PAUSED",
                pausedAt: new Date(),
                renewsAt: pauseExpiry,
                updatedAt: new Date(),
            },
            create: {
                userId: user.id,
                tier: newTier,
                status: "PAUSED",
                revenuecatId: appUserId,
                productId,
                pausedAt: new Date(),
                renewsAt: pauseExpiry,
                updatedAt: new Date(),
            },
        });
        console.log(`[subscription] Paused for user ${user.id}`);
        return res.status(200).json({ ok: true });
    }
    // Unknown event type — acknowledge but do nothing
    return res.status(200).json({ ok: true, note: "Event type not handled" });
}
//# sourceMappingURL=subscription.controller.js.map