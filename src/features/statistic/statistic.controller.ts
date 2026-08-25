import type { Request, Response } from "express";
import type { PlanTier } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { FREE_BRONZE_CODE } from "../../lib/constants.js";

type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "SEEN";

type StatisticsResponse = {
  generatedAt: string;
  overview: {
    totalUsers: number;
    totalDevices: number;
    totalAlerts: number;
    activeAlerts: number;
    totalNotifications: number;
    totalNotificationLogs: number;
    totalListings: number;
    latestListingAt: Date | null;
  };
  listingsBySource: Array<{ source: string; count: number }>;
  notificationsByStatus: Array<{ status: string; count: number }>;
  usersByPlanTier: Array<{ tier: string; count: number }>;
  drugarskiCount: number;
  subscriptionsByStatus: Array<{ status: string; count: number }>;
  alertsByCategory: Array<{ category: string; count: number }>;
  revenueEstimate: {
    monthlyEur: number;
    byTier: Array<{ tier: string; count: number; monthlyEur: number }>;
  };
  trialToPaidConversion: {
    trialOnlyUsers: number;
    paidUsers: number;
    conversionRate: number;
  };
  recentScrapeRuns: Array<{
    id: string;
    source: string;
    success: boolean;
    itemCount: number;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  pipelineHealth: {
    scrapeIntervalMinutes: number;
    lastScrapeRunAt: Date | null;
    lastSuccessfulScrapeAt: Date | null;
    minutesSinceLastScrapeRun: number | null;
    isStale: boolean;
  };
  users: Array<{
    userId: string;
    name: string;
    email: string;
    tier: string;
    promoCodeUsed: string | null;
    subscription: {
      tier: string;
      status: string;
      productId: string | null;
      startedAt: Date;
      renewsAt: Date | null;
      pausedAt: Date | null;
      cancelledAt: Date | null;
    } | null;
    registeredAt: Date;
    devicesCount: number;
    alertsCount: number;
    notificationsTotal: number;
    notificationsByStatus: Record<NotificationStatus, number>;
  }>;
};

const STATS_CACHE_TTL_MS = 30_000;
let statsCache: { expiresAt: number; payload: StatisticsResponse } | null = null;

function decodeBasicAuthorizationHeader(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return null;
  }

  const encoded = authHeader.slice(6).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isAuthorized(req: Request, res: Response): boolean {
  const expectedUsername = process.env.STATISTIC_USER;
  const expectedPassword = process.env.STATISTIC_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    res.status(500).json({
      error: "STATISTIC_USER i STATISTIC_PASSWORD nisu podeseni u .env",
    });
    return false;
  }

  const credentials = decodeBasicAuthorizationHeader(req.headers.authorization);

  if (
    credentials?.username !== expectedUsername ||
    credentials.password !== expectedPassword
  ) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Market Monitor Statistics"');
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

export async function getStatistic(req: Request, res: Response) {
  if (!isAuthorized(req, res)) {
    return;
  }

  if (statsCache && statsCache.expiresAt > Date.now()) {
    res.json(statsCache.payload);
    return;
  }

  const [
    totalUsers,
    totalDevices,
    totalAlerts,
    totalListings,
    totalNotifications,
    totalNotificationLogs,
    activeAlerts,
    listingsBySource,
    notificationsByStatus,
    usersByPlanTier,
    subscriptionsByStatus,
    latestListing,
    alertsByCategory,
    activeSubsByTier,
    totalPaidUsers,
    drugarskiCount,
    recentScrapeRuns,
    lastScrapeRun,
    lastSuccessfulScrapeRun,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.device.count(),
    prisma.alert.count(),
    prisma.listing.count(),
    prisma.notification.count(),
    prisma.notificationLog.count(),
    prisma.alert.count({ where: { isActive: true } }),
    prisma.listing.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.notification.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.groupBy({ by: ["planTier"], _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.listing.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.alert.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["tier"], _count: { _all: true }, where: { status: "ACTIVE" } }),
    prisma.subscription.count(),
    prisma.user.count({ where: { promoCodeUsed: FREE_BRONZE_CODE } }),
    prisma.scrapeRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 7,
      select: {
        id: true,
        source: true,
        success: true,
        itemCount: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
    // Vreme poslednjeg ScrapeRun reda BILO KOG ishoda (uspeh ili neuspeh) je jedini
    // pouzdan signal da li je ingest ciklus uopste izvrsen — pojedinacan izvor
    // (npr. KP) moze da promasi bez ovoga (recordScrapeRun i dalje pise red), ali
    // ako se CEO ciklus zaglavi (2026-08-20 incident: Chromium proces visio, nijedan
    // await se nikad nije zavrsio), nijedan red se ne upisuje uopste — sto je tacno
    // ono sto trazimo da detektujemo.
    prisma.scrapeRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.scrapeRun.findFirst({
      where: { success: true },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const TIER_PRICE: Record<string, number> = { FREE: 0, BRONZE: 10, SILVER: 15, GOLD: 20 };
  const revenueByTier = activeSubsByTier.map((r) => ({
    tier: r.tier,
    count: r._count._all,
    monthlyEur: (TIER_PRICE[r.tier] ?? 0) * r._count._all,
  }));
  const monthlyRevenue = revenueByTier.reduce((sum, t) => sum + t.monthlyEur, 0);

  const paidUsers = totalPaidUsers;
  const trialOnlyUsers = Math.max(0, totalUsers - paidUsers);
  const conversionRate = totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : 0;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      planTier: true,
      promoCodeUsed: true,
      createdAt: true,
      subscription: {
        select: {
          tier: true,
          status: true,
          productId: true,
          startedAt: true,
          renewsAt: true,
          pausedAt: true,
          cancelledAt: true,
        },
      },
      _count: {
        select: {
          devices: true,
        },
      },
    },
  });

  const [alertsByUserRaw, notificationsByUserRaw] = await Promise.all([
    prisma.$queryRaw<Array<{ userId: string | null; count: bigint }>>`
      SELECT d."userId" AS "userId", COUNT(a.id) AS count
      FROM "Alert" a
      JOIN "Device" d ON d.id = a."deviceId"
      WHERE d."userId" IS NOT NULL
      GROUP BY d."userId"
    `,
    prisma.$queryRaw<Array<{ userId: string | null; status: NotificationStatus; count: bigint }>>`
      SELECT d."userId" AS "userId", n.status AS status, COUNT(n.id) AS count
      FROM "Notification" n
      JOIN "Device" d ON d.id = n."deviceId"
      WHERE d."userId" IS NOT NULL
      GROUP BY d."userId", n.status
    `,
  ]);

  const alertsByUser = new Map<string, number>();
  for (const row of alertsByUserRaw) {
    if (!row.userId) continue;
    alertsByUser.set(row.userId, Number(row.count));
  }

  const notificationsByUser = new Map<string, Record<NotificationStatus, number>>();
  for (const row of notificationsByUserRaw) {
    if (!row.userId) continue;
    const current = notificationsByUser.get(row.userId) ?? {
      PENDING: 0,
      SENT: 0,
      FAILED: 0,
      SEEN: 0,
    };
    current[row.status] = Number(row.count);
    notificationsByUser.set(row.userId, current);
  }

  const usersDetailed = users.map((user) => {
    const notificationsByCurrentUser = notificationsByUser.get(user.id) ?? {
      PENDING: 0,
      SENT: 0,
      FAILED: 0,
      SEEN: 0,
    };

    const alertsCount = alertsByUser.get(user.id) ?? 0;
    const notificationsTotal =
      notificationsByCurrentUser.PENDING +
      notificationsByCurrentUser.SENT +
      notificationsByCurrentUser.FAILED +
      notificationsByCurrentUser.SEEN;

    return {
      userId: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      tier: user.planTier,
      promoCodeUsed: user.promoCodeUsed,
      subscription: user.subscription,
      registeredAt: user.createdAt,
      devicesCount: user._count.devices,
      alertsCount,
      notificationsTotal,
      notificationsByStatus: notificationsByCurrentUser,
    };
  });

  // Isti prag koji koristi watchdog (jobs/watchdog.ts) da sam sebe restartuje: 5
  // propustenih ciklusa. Ovde je informativno, samo za dashboard — watchdog ima
  // svoju nezavisnu logiku u backend procesu.
  const scrapeIntervalMinutes = parseInt(process.env.SCRAPE_INTERVAL_MINUTES || "5", 10);
  const staleThresholdMinutes = scrapeIntervalMinutes * 5;
  const minutesSinceLastScrapeRun = lastScrapeRun
    ? Math.floor((Date.now() - lastScrapeRun.createdAt.getTime()) / 60_000)
    : null;
  const pipelineHealth: StatisticsResponse["pipelineHealth"] = {
    scrapeIntervalMinutes,
    lastScrapeRunAt: lastScrapeRun?.createdAt ?? null,
    lastSuccessfulScrapeAt: lastSuccessfulScrapeRun?.createdAt ?? null,
    minutesSinceLastScrapeRun,
    isStale: minutesSinceLastScrapeRun === null || minutesSinceLastScrapeRun > staleThresholdMinutes,
  };

  const payload: StatisticsResponse = {
    generatedAt: new Date().toISOString(),
    overview: {
      totalUsers,
      totalDevices,
      totalAlerts,
      activeAlerts,
      totalNotifications,
      totalNotificationLogs,
      totalListings,
      latestListingAt: latestListing?.createdAt ?? null,
    },
    listingsBySource: listingsBySource.map((row) => ({
      source: row.source,
      count: row._count._all,
    })),
    notificationsByStatus: notificationsByStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    usersByPlanTier: usersByPlanTier.map((row) => ({
      tier: row.planTier,
      count: row._count._all,
    })),
    drugarskiCount,
    subscriptionsByStatus: subscriptionsByStatus.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    alertsByCategory: alertsByCategory
      .map((row) => ({ category: row.category, count: row._count?._all ?? 0 }))
      .sort((a, b) => b.count - a.count),
    revenueEstimate: {
      monthlyEur: monthlyRevenue,
      byTier: revenueByTier,
    },
    trialToPaidConversion: {
      trialOnlyUsers,
      paidUsers,
      conversionRate,
    },
    recentScrapeRuns,
    pipelineHealth,
    users: usersDetailed,
  };

  statsCache = {
    expiresAt: Date.now() + STATS_CACHE_TTL_MS,
    payload,
  };

  res.json(payload);
}

const MANUAL_GRANT_DAYS = 30;
const MANAGEABLE_TIERS = new Set(["BRONZE", "SILVER", "GOLD"]);
type SubscriptionAction = "activate" | "pause" | "resume" | "cancel" | "expire";

// PATCH /api/statistic/admin/subscription
export async function manageSubscription(req: Request, res: Response) {
  if (!isAuthorized(req, res)) return;

  const { userId, action, tier } = req.body as {
    userId?: string;
    action?: SubscriptionAction;
    tier?: PlanTier;
  };

  if (!userId || !action) {
    return res.status(400).json({ error: "userId i action su obavezni" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  if (!user) {
    return res.status(404).json({ error: "Korisnik nije pronadjen" });
  }

  const now = new Date();

  if (action === "activate") {
    if (!tier || !MANAGEABLE_TIERS.has(tier)) {
      return res.status(400).json({ error: "tier je obavezan (BRONZE/SILVER/GOLD) za activate" });
    }

    const renewsAt = new Date(now.getTime() + MANUAL_GRANT_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.subscription.upsert({
        where: { userId },
        update: {
          tier,
          status: "ACTIVE",
          renewsAt,
          pausedAt: null,
          cancelledAt: null,
          updatedAt: now,
        },
        create: { userId, tier, status: "ACTIVE", renewsAt, updatedAt: now },
      }),
      prisma.user.update({ where: { id: userId }, data: { planTier: tier } }),
    ]);
  } else {
    if (!user.subscription) {
      return res.status(400).json({ error: "Korisnik nema pretplatu za ovu akciju" });
    }

    if (action === "pause") {
      await prisma.subscription.update({
        where: { userId },
        data: { status: "PAUSED", pausedAt: now, updatedAt: now },
      });
    } else if (action === "resume") {
      await prisma.subscription.update({
        where: { userId },
        data: { status: "ACTIVE", pausedAt: null, updatedAt: now },
      });
    } else if (action === "cancel") {
      await prisma.subscription.update({
        where: { userId },
        data: { status: "CANCELLED", cancelledAt: now, updatedAt: now },
      });
    } else if (action === "expire") {
      await prisma.$transaction([
        prisma.subscription.update({
          where: { userId },
          data: { status: "EXPIRED", cancelledAt: now, renewsAt: null, updatedAt: now },
        }),
        prisma.user.update({ where: { id: userId }, data: { planTier: "FREE" } }),
      ]);
    } else {
      return res.status(400).json({ error: "Nepoznata akcija" });
    }
  }

  statsCache = null;
  return res.status(200).json({ ok: true });
}

// PATCH /api/statistic/admin/drugarski
export async function manageDrugarski(req: Request, res: Response) {
  if (!isAuthorized(req, res)) return;

  const { userId, action } = req.body as { userId?: string; action?: "grant" | "revoke" };

  if (!userId || !action) {
    return res.status(400).json({ error: "userId i action su obavezni" });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ error: "Korisnik nije pronadjen" });
  }

  await prisma.user.update({
    where: { id: userId },
    data:
      action === "grant"
        ? { promoCodeUsed: FREE_BRONZE_CODE, promoRedeemedAt: new Date() }
        : { promoCodeUsed: null, promoRedeemedAt: null },
  });

  statsCache = null;
  return res.status(200).json({ ok: true });
}
