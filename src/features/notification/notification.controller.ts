import type { Request, Response } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { sendExpoPushNotification } from "./expoPush.service.js";

type PlanTier = "FREE" | "BRONZE" | "SILVER" | "GOLD";

const FREE_BRONZE_CODE = "03081995";
const TIER_ALERT_LIMIT: Record<PlanTier, number> = {
  FREE: 0,
  BRONZE: 3,
  SILVER: 6,
  GOLD: 10,
};

const PRICING_PLANS = [
  { tier: "BRONZE", alerts: 3, monthlyEur: 10 },
  { tier: "SILVER", alerts: 6, monthlyEur: 15 },
  { tier: "GOLD", alerts: 10, monthlyEur: 20 },
] as const;

function normalizePlatform(platform: unknown): "ANDROID" | "IOS" | "WEB" | null {
  if (typeof platform !== "string") return null;

  const normalized = platform.trim().toUpperCase();

  if (normalized === "ANDROID" || normalized === "ANDROID-EMULATOR") {
    return "ANDROID";
  }

  if (normalized === "IOS") {
    return "IOS";
  }

  if (normalized === "WEB") {
    return "WEB";
  }

  return null;
}

function getSingleString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, hashed: string): boolean {
  const [salt, storedDigest] = hashed.split(":");
  if (!salt || !storedDigest) return false;

  const currentDigest = scryptSync(password, salt, 64).toString("hex");

  try {
    return timingSafeEqual(
      Buffer.from(storedDigest, "hex"),
      Buffer.from(currentDigest, "hex"),
    );
  } catch {
    return false;
  }
}

function getTierAlertLimit(tier: PlanTier): number {
  return TIER_ALERT_LIMIT[tier] ?? TIER_ALERT_LIMIT.FREE;
}

async function buildProfilePayload(deviceId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          planTier: true,
          promoCodeUsed: true,
          promoRedeemedAt: true,
        },
      },
    },
  });

  if (!device) return null;

  const planTier = (device.user?.planTier ?? "FREE") as PlanTier;
  const isDrugarskiActive = device.user?.promoCodeUsed === FREE_BRONZE_CODE;
  const effectiveAlertLimit = isDrugarskiActive
    ? 5
    : getTierAlertLimit(planTier);
  const signalCount = device.user?.id
    ? await prisma.alert.count({ where: { device: { userId: device.user.id } } })
    : await prisma.alert.count({ where: { deviceId } });

  return {
    deviceId: device.id,
    user: device.user,
    planTier,
    alertLimit: effectiveAlertLimit,
    signalCount,
    pricingPlans: PRICING_PLANS,
    freeBronzeCode: FREE_BRONZE_CODE,
  };
}

// POST /api/notifications/devices
export async function registerDevice(req: Request, res: Response) {
  const expoPushToken = getSingleString(req.body?.expoPushToken);
  const platform = req.body?.platform;
  const deviceId = getSingleString(req.body?.deviceId);
  const normalizedPlatform = normalizePlatform(platform);
  const firstName = getSingleString(req.body?.firstName);
  const lastName = getSingleString(req.body?.lastName);
  const email = getSingleString(req.body?.email);
  const password = getSingleString(req.body?.password);
  const hasAnyUserField = !!(firstName || lastName || email || password);

  if (!expoPushToken || !normalizedPlatform) {
    return res
      .status(400)
      .json({ error: "Validni expoPushToken i platform su obavezni" });
  }

  if (hasAnyUserField && (!firstName || !lastName || !email || !password)) {
    return res.status(400).json({
      error: "Za registraciju naloga potrebni su ime, prezime, email i password",
    });
  }

  if (password && password.length < 6) {
    return res.status(400).json({ error: "Password mora imati najmanje 6 karaktera" });
  }

  try {
    let resolvedUserId: string | null = null;

    if (hasAnyUserField && firstName && lastName && email && password) {
      const normalizedEmail = normalizeEmail(email);
      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUser) {
        if (!verifyPassword(password, existingUser.passwordHash)) {
          return res.status(401).json({ error: "Pogresan email ili password" });
        }

        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firstName,
            lastName,
          },
        });
        resolvedUserId = updatedUser.id;
      } else {
        const createdUser = await prisma.user.create({
          data: {
            firstName,
            lastName,
            email: normalizedEmail,
            passwordHash: hashPassword(password),
          },
        });
        resolvedUserId = createdUser.id;
      }
    }

    let device = null as Awaited<ReturnType<typeof prisma.device.create>> | null;

    if (deviceId) {
      const existingById = await prisma.device.findUnique({ where: { id: deviceId } });
      if (existingById) {
        device = await prisma.device.update({
          where: { id: deviceId },
          data: {
            expoPushToken,
            platform: normalizedPlatform,
            ...(resolvedUserId ? { userId: resolvedUserId } : {}),
            lastSeenAt: new Date(),
          },
        });
      }
    }

    if (!device) {
      const existingByToken = await prisma.device.findUnique({ where: { expoPushToken } });
      if (existingByToken) {
        device = await prisma.device.update({
          where: { id: existingByToken.id },
          data: {
            platform: normalizedPlatform,
            ...(resolvedUserId
              ? { userId: resolvedUserId }
              : existingByToken.userId
                ? { userId: existingByToken.userId }
                : {}),
            lastSeenAt: new Date(),
          },
        });
      }
    }

    if (!device) {
      device = await prisma.device.create({
        data: {
          expoPushToken,
          platform: normalizedPlatform,
          ...(resolvedUserId ? { userId: resolvedUserId } : {}),
        },
      });
    }

    const profile = await buildProfilePayload(device.id);
    return res.status(200).json({ ...device, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] registerDevice error:", message);
    return res.status(500).json({ error: "Greska pri registraciji uredjaja" });
  }
}

// POST /api/notifications/alerts
export async function createAlert(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);
  const category = getSingleString(req.body?.category);
  const rawKeywords = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
  const keywords = rawKeywords.filter(
    (keyword: unknown): keyword is string =>
      typeof keyword === "string" && keyword.trim().length > 0,
  );
  const rawPriceMax = Number(req.body?.priceMax);
  const priceMax = Number.isFinite(rawPriceMax) ? rawPriceMax : null;
  const locationText = getSingleString(req.body?.locationText) ?? "";

  if (!deviceId || !category || !priceMax) {
    return res
      .status(400)
      .json({ error: "deviceId, category i priceMax su obavezni" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, userId: true, user: { select: { planTier: true, promoCodeUsed: true } } },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  const planTier = (device.user?.planTier ?? "FREE") as PlanTier;
  const isDrugarskiActive = device.user?.promoCodeUsed === FREE_BRONZE_CODE;
  const maxAlerts = isDrugarskiActive ? 5 : getTierAlertLimit(planTier);
  const count = device.userId
    ? await prisma.alert.count({ where: { device: { userId: device.userId } } })
    : await prisma.alert.count({ where: { deviceId } });

  if (count >= maxAlerts) {
    return res.status(400).json({
      error:
        maxAlerts === 0
          ? "FREE plan je zakljucan. Aktiviraj kod ili sacekaj planove."
          : `Maksimalan broj signala za ${planTier} plan je ${maxAlerts}`,
    });
  }

  const alert = await prisma.alert.create({
    data: {
      deviceId,
      category,
      keywords: keywords ?? [],
      priceMax,
      locationText: locationText ?? "",
    },
  });

  return res.status(201).json(alert);
}

// GET /api/notifications/alerts/:deviceId
export async function getAlerts(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  const alerts = await prisma.alert.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json(alerts);
}

// PATCH /api/notifications/alerts/:id/toggle
export async function toggleAlert(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Alert ID je obavezan" });
  }

  const alert = await prisma.alert.findUnique({ where: { id } });
  if (!alert) return res.status(404).json({ error: "Alert nije pronadjen" });

  const updated = await prisma.alert.update({
    where: { id },
    data: { isActive: !alert.isActive },
  });

  return res.status(200).json(updated);
}

// DELETE /api/notifications/alerts/:id
export async function deleteAlert(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Alert ID je obavezan" });
  }

  await prisma.alert.delete({ where: { id } });

  return res.status(200).json({ ok: true });
}

// POST /api/notifications/test
export async function sendTestNotification(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);
  let createdNotificationId: string | null = null;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  try {
    const notification = await prisma.notification.create({
      data: {
        deviceId,
        title: "Test notifikacija",
        body: "Push notifikacije rade i u background-u.",
        data: { url: "https://www.kupujemprodajem.com/" },
        status: "PENDING",
      },
    });
    createdNotificationId = notification.id;

    await sendExpoPushNotification({
      to: device.expoPushToken,
      title: notification.title,
      body: notification.body,
      data: {
        url: "https://www.kupujemprodajem.com/",
        notificationId: notification.id,
      },
    });

    const sentNotification = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        failedAt: null,
        lastError: null,
      },
    });

    console.log("[notification] Test notification sent for device:", deviceId);

    return res.status(200).json({
      ok: true,
      message: "Test notifikacija poslata",
      notification: sentNotification,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] Test notification error:", message);

    if (createdNotificationId) {
      await prisma.notification.update({
        where: { id: createdNotificationId },
        data: {
          status: "FAILED",
          retries: { increment: 1 },
          failedAt: new Date(),
          lastError: message,
        },
      });
    }

    return res.status(500).json({ error: message });
  }
}

// GET /api/notifications/pending/:deviceId
export async function getPendingNotifications(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  try {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });

    if (!device) {
      return res.status(404).json({ error: "Uredjaj nije pronadjen" });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        deviceId,
        status: {
          in: ["PENDING", "SENT"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    console.log(
      `[notification] Retrieved ${notifications.length} pending notifications for device:`,
      deviceId,
    );

    return res.status(200).json(notifications);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] Error getting pending notifications:", message);
    return res.status(500).json({ error: message });
  }
}

// PATCH /api/notifications/:id/seen
export async function markNotificationAsSeen(req: Request, res: Response) {
  const id = getSingleString(req.params.id);

  if (!id) {
    return res.status(400).json({ error: "Notification ID je obavezan" });
  }

  try {
    const updated = await prisma.notification.update({
      where: { id },
      data: {
        status: "SEEN",
        seenAt: new Date(),
      },
    });

    console.log("[notification] Marked as seen:", id);

    return res.status(200).json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata greska";
    console.error("[notification] Error marking as seen:", message);
    return res.status(500).json({ error: message });
  }
}

// GET /api/notifications/profile/:deviceId
export async function getProfile(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  const profile = await buildProfilePayload(deviceId);
  if (!profile) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  return res.status(200).json(profile);
}

// PATCH /api/notifications/profile/:deviceId
export async function updateProfile(req: Request, res: Response) {
  const deviceId = getSingleString(req.params.deviceId);
  const firstName = getSingleString(req.body?.firstName);
  const lastName = getSingleString(req.body?.lastName);
  const email = getSingleString(req.body?.email);
  const password = getSingleString(req.body?.password);

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId je obavezan" });
  }

  if (password && password.length < 6) {
    return res.status(400).json({ error: "Password mora imati najmanje 6 karaktera" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { user: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  let userId = device.userId;

  if (!device.userId) {
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        error: "Za kreiranje profila potrebni su ime, prezime, email i password",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      if (!verifyPassword(password, existing.passwordHash)) {
        return res.status(401).json({ error: "Pogresan email ili password" });
      }

      const linked = await prisma.device.update({
        where: { id: deviceId },
        data: { userId: existing.id },
      });
      userId = linked.userId;
    } else {
      const created = await prisma.user.create({
        data: {
          firstName,
          lastName,
          email: normalizedEmail,
          passwordHash: hashPassword(password),
        },
      });
      const linked = await prisma.device.update({
        where: { id: deviceId },
        data: { userId: created.id },
      });
      userId = linked.userId;
    }
  } else {
    const data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      passwordHash?: string;
    } = {};

    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;
    if (email) data.email = normalizeEmail(email);
    if (password) data.passwordHash = hashPassword(password);

    if (Object.keys(data).length > 0) {
      if (data.email) {
        const emailOwner = await prisma.user.findUnique({ where: { email: data.email } });
        if (emailOwner && emailOwner.id !== device.userId) {
          return res.status(409).json({ error: "Email je vec zauzet" });
        }
      }

      await prisma.user.update({ where: { id: device.userId }, data });
    }
  }

  if (!userId) {
    return res.status(500).json({ error: "Profil nije moguce povezati sa uredjajem" });
  }

  const profile = await buildProfilePayload(deviceId);
  return res.status(200).json(profile);
}

// POST /api/notifications/promo/redeem
export async function redeemPromoCode(req: Request, res: Response) {
  const deviceId = getSingleString(req.body?.deviceId);
  const code = getSingleString(req.body?.code);

  if (!deviceId || !code) {
    return res.status(400).json({ error: "deviceId i code su obavezni" });
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { user: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  if (!device.userId) {
    return res.status(400).json({ error: "Prvo sacuvaj korisnicki profil" });
  }

  if (code.trim().toUpperCase() !== FREE_BRONZE_CODE) {
    return res.status(400).json({ error: "Promo kod nije validan" });
  }

  await prisma.user.update({
    where: { id: device.userId },
    data: {
      planTier: "FREE",
      promoCodeUsed: FREE_BRONZE_CODE,
      promoRedeemedAt: new Date(),
    },
  });

  const profile = await buildProfilePayload(deviceId);
  return res.status(200).json(profile);
}
