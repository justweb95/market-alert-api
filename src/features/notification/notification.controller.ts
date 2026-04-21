import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { sendExpoPushNotification } from "./expoPush.service.js";

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

// POST /api/notifications/devices
export async function registerDevice(req: Request, res: Response) {
  const { expoPushToken, platform } = req.body;
  const deviceId = getSingleString(req.body?.deviceId);
  const normalizedPlatform = normalizePlatform(platform);

  if (!expoPushToken || !normalizedPlatform) {
    return res
      .status(400)
      .json({ error: "Validni expoPushToken i platform su obavezni" });
  }

  const device = deviceId
    ? await prisma.device.upsert({
        where: { id: deviceId },
        update: { expoPushToken, lastSeenAt: new Date(), platform: normalizedPlatform },
        create: { expoPushToken, platform: normalizedPlatform },
      })
    : await prisma.device.upsert({
        where: { expoPushToken },
        update: { lastSeenAt: new Date(), platform: normalizedPlatform },
        create: { expoPushToken, platform: normalizedPlatform },
      });

  return res.status(200).json(device);
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
    select: { id: true },
  });

  if (!device) {
    return res.status(404).json({ error: "Uredjaj nije pronadjen" });
  }

  const count = await prisma.alert.count({ where: { deviceId } });
  if (count >= 3) {
    return res.status(400).json({ error: "Maksimalan broj alerta je 3" });
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
