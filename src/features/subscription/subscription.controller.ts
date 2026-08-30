import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import type { PlanTier, SubscriptionStatus } from "@prisma/client";

// Product ID → PlanTier mapping — must match what you configure in App Store / Play Store / RevenueCat dashboard
const PRODUCT_TIER: Record<string, PlanTier> = {
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
const EXPIRATION_EVENTS = new Set([
  "EXPIRATION",
  "BILLING_ISSUE",
]);

// RevenueCat event types for pause (Android only via Google Play)
const PAUSE_EVENTS = new Set(["SUBSCRIPTION_PAUSED"]);

/**
 * Google Play ume da posalje product_id kao "subscriptionId:basePlanId"
 * (npr. "market_monitor_bronze_monthly:monthly"), pa stroga jednakost promasi.
 * Vraca null kad se proizvod ne prepozna - pozivalac tada NE dira tier, jer bi
 * tiho spustanje na FREE oduzelo pristup korisniku koji je platio.
 */
function resolveTier(productId: string | undefined | null): PlanTier | null {
  if (!productId) return null;

  const direct = PRODUCT_TIER[productId];
  if (direct) return direct;

  const base = productId.split(":")[0];
  if (base && PRODUCT_TIER[base]) return PRODUCT_TIER[base];

  const prefixed = Object.keys(PRODUCT_TIER).find((key) => productId.startsWith(key));
  return prefixed ? PRODUCT_TIER[prefixed] ?? null : null;
}

/** Poredjenje deljene tajne otporno na merenje vremena odgovora. */
function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type RevenueCatEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "PRODUCT_CHANGE"
  | "CANCELLATION"
  | "UNCANCELLATION"
  | "BILLING_ISSUE"
  | "EXPIRATION"
  | "SUBSCRIPTION_PAUSED"
  | "SUBSCRIPTION_EXTENDED"
  | string;

type RevenueCatWebhookPayload = {
  api_version: string;
  event: {
    type: RevenueCatEventType;
    id: string;
    app_user_id: string;       // Our User.id (or deviceId for anonymous users)
    original_app_user_id: string;
    product_id: string;        // e.g. "market_monitor_bronze_monthly"
    expiration_at_ms?: number | null;
    cancel_reason?: string;
    pause_expiration_date?: number | null;
  };
};

// POST /api/subscription/webhook
export async function handleRevenueCatWebhook(req: Request, res: Response) {
  // Deljena tajna se podesava u RevenueCat dashboard-u → Project → Integrations →
  // Webhooks i stize u "Authorization" header-u.
  //
  // FAIL-CLOSED: ako tajna nije podesena, webhook se ODBIJA. Ranije se u tom
  // slucaju propustao svaki zahtev, pa je bilo ko sa poznatim app_user_id-jem
  // mogao sebi da dodeli GOLD. Bolje je da se pretplate privremeno ne sinhronizuju
  // (RevenueCat ponavlja isporuku) nego da entitlement bude otvoren.
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[subscription] REVENUECAT_WEBHOOK_SECRET nije podesen - webhook je odbijen. " +
        "Postavi istu vrednost u .env i u RevenueCat dashboard-u.",
    );
    return res.status(503).json({ error: "Webhook nije konfigurisan" });
  }

  if (!secretMatches(req.headers["authorization"], secret)) {
    console.warn("[subscription] Webhook auth failed");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body as RevenueCatWebhookPayload;
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

  const resolvedTier = resolveTier(productId);

  // Nepoznat proizvod na aktivnom dogadjaju: ne diramo tier. Ranije je padao na
  // "FREE", pa bi korisnik koji je upravo platio ostao bez pristupa ako se
  // product ID u Play-u i PRODUCT_TIER mapi razidju.
  if (ACTIVE_EVENTS.has(event.type) && !resolvedTier) {
    console.error(
      `[subscription] Nepoznat product_id "${productId}" na dogadjaju ${event.type} - ` +
        "tier nije promenjen. Uskladi PRODUCT_TIER sa Play Console-om.",
    );
    return res.status(200).json({ ok: true, note: "Unknown product, tier unchanged" });
  }

  const newTier: PlanTier = resolvedTier ?? "FREE";

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

  if (event.type === "CANCELLATION") {
    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        status: "CANCELLED",
        renewsAt,
        pausedAt: null,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        tier: newTier,
        status: "CANCELLED",
        revenuecatId: appUserId,
        productId,
        renewsAt,
        pausedAt: null,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Cancellation only marks auto-renew disabled; entitlement stays unchanged until EXPIRATION.
    console.log(`[subscription] Cancelled renewal for user ${user.id}`);
    return res.status(200).json({ ok: true });
  }

  if (EXPIRATION_EVENTS.has(event.type)) {
    const newStatus: SubscriptionStatus = "EXPIRED";

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
      // Downgrade to FREE only when subscription actually expires.
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
