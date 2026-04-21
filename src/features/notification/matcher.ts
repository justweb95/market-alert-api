import { prisma } from "../../db/prisma.js";
import { sendExpoPushNotification } from "./expoPush.service.js";

const MAX_NOTIFICATION_RETRIES = 3;

type AlertWithDevice = {
  id: string;
  deviceId: string;
  category: string;
  keywords: string[];
  priceMax: number;
  isActive: boolean;
  device: { expoPushToken: string };
};

type ListingRow = {
  id: string;
  source: string;
  title: string;
  price: number | null;
  locationText: string | null;
  url: string;
  raw?: unknown;
};

type PendingNotificationForRetry = {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  retries: number;
  alertId: string | null;
  listingId: string | null;
  device: { expoPushToken: string };
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Nepoznata greska pri slanju push notifikacije";
}

async function markNotificationSent(notificationId: string): Promise<void> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: {
      status: "SENT",
      sentAt: new Date(),
      failedAt: null,
      lastError: null,
    },
  });
}

async function markNotificationsSent(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;

  await prisma.notification.updateMany({
    where: { id: { in: notificationIds } },
    data: {
      status: "SENT",
      sentAt: new Date(),
      failedAt: null,
      lastError: null,
    },
  });
}

async function markNotificationFailed(
  notificationId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      lastError: errorMessage,
      retries: { increment: 1 },
    },
  });
}

async function markNotificationsFailed(
  notificationIds: string[],
  errorMessage: string,
): Promise<void> {
  if (notificationIds.length === 0) return;

  await prisma.notification.updateMany({
    where: { id: { in: notificationIds } },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      lastError: errorMessage,
    },
  });

  await prisma.notification.updateMany({
    where: { id: { in: notificationIds } },
    data: {
      retries: { increment: 1 },
    },
  });
}

async function createNotificationLogIfMissing(
  alertId: string,
  listingId: string,
): Promise<void> {
  await prisma.notificationLog.createMany({
    data: [{ alertId, listingId }],
    skipDuplicates: true,
  });
}

async function sendAndPersistNotification(input: {
  notificationId: string;
  expoPushToken: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await sendExpoPushNotification({
      to: input.expoPushToken,
      title: input.title,
      body: input.body,
      data: input.data,
    });

    await markNotificationSent(input.notificationId);
    return { ok: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await markNotificationFailed(input.notificationId, errorMessage);
    return { ok: false, error: errorMessage };
  }
}

function buildBatchPushTitle(count: number): string {
  if (count === 1) return "[NOVO] 1 novi oglas";
  if (count >= 2 && count <= 4) return `[NOVO] ${count} nova oglasa`;
  return `[NOVO] ${count} novih oglasa`;
}

function buildBatchPushBody(
  keywords: string[],
  listings: Array<{ title: string; priceText: string }>,
): string {
  const keywordText = keywords.filter(Boolean).join(" ").trim();
  const prefix = keywordText
    ? `Za filter ${keywordText}`
    : "Pronadjeni su novi oglasi";

  if (listings.length === 0) {
    return prefix;
  }

  const firstListing = listings[0];
  if (listings.length === 1 && firstListing) {
    return `${prefix}: ${firstListing.title}`;
  }

  const preview = listings
    .slice(0, 2)
    .map((listing) => `${listing.title} (${listing.priceText})`)
    .join(", ");

  return `${prefix}. Primeri: ${preview}`;
}

const AUTO_PARTS_KEYWORDS = [
  "deo",
  "delovi",
  "diferencijal",
  "menjac",
  "motor",
  "amortizer",
  "turbina",
  "alternator",
  "anlaser",
  "kociona",
  "kocnice",
  "disk",
  "plocice",
  "kvacilo",
  "far",
  "stop",
  "branik",
  "retrovizor",
  "trap",
  "lezaj",
  "poluosovina",
  "hladnjak",
  "set kvacila",
];

function titleLooksLikeAutoPart(title: string): boolean {
  const lower = title.toLowerCase();
  return AUTO_PARTS_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function doesMatch(listing: ListingRow, alert: AlertWithDevice): boolean {
  const categoryMap: Record<string, string[]> = {
    AUTOMOBILI: ["pa-car", "kp", "fb-group", "fb-marketplace"],
    AUTO_DELOVI: ["kp", "fb-group", "fb-marketplace"],
    MOTORI: ["pa-moto", "kp", "fb-group", "fb-marketplace"],
    TELEFONI: ["kp", "fb-group", "fb-marketplace"],
    RACUNARI: ["kp", "fb-group", "fb-marketplace"],
    BICIKLI: ["kp", "fb-group", "fb-marketplace"],
    NEKRETNINE: ["kp", "fb-group", "fb-marketplace"],
  };

  const allowedSources = categoryMap[alert.category] ?? [];
  if (!allowedSources.includes(listing.source)) return false;

  const looksLikePart = titleLooksLikeAutoPart(listing.title);
  if (alert.category === "AUTOMOBILI" && looksLikePart) return false;
  if (alert.category === "AUTO_DELOVI" && !looksLikePart) return false;

  if (alert.priceMax && listing.price != null && listing.price > alert.priceMax) {
    return false;
  }

  if (alert.keywords.length > 0) {
    const titleLower = listing.title.toLowerCase();
    const allMatch = alert.keywords.every((kw) =>
      titleLower.includes(kw.toLowerCase()),
    );
    if (!allMatch) return false;
  }

  return true;
}

function extractListingImageUrl(listing: ListingRow): string | null {
  if (!listing.raw || typeof listing.raw !== "object") return null;

  const raw = listing.raw as Record<string, unknown>;
  const image = raw.image;
  if (typeof image === "string" && image.trim().length > 0) return image;

  const smallImage = raw.smallImage;
  if (typeof smallImage === "string" && smallImage.trim().length > 0) {
    return smallImage;
  }

  return null;
}

export async function matchAndNotify(listings: ListingRow[]): Promise<void> {
  if (listings.length === 0) return;

  const alerts = (await prisma.alert.findMany({
    where: { isActive: true },
    include: { device: true },
  })) as AlertWithDevice[];

  if (alerts.length === 0) return;

  const notificationsToCreate: Array<{
    deviceId: string;
    expoPushToken: string;
    keywords: string[];
    title: string;
    body: string;
    data: Record<string, string>;
    listingId: string;
    alertId: string;
    priceText: string;
  }> = [];

  for (const alert of alerts) {
    for (const listing of listings) {
      if (!doesMatch(listing, alert)) continue;

      const alreadySent = await prisma.notificationLog.findUnique({
        where: {
          alertId_listingId: {
            alertId: alert.id,
            listingId: listing.id,
          },
        },
      });
      if (alreadySent) continue;

      const existingPendingOrFailed = await prisma.notification.findFirst({
        where: {
          alertId: alert.id,
          listingId: listing.id,
          status: { in: ["PENDING", "FAILED"] },
        },
        select: { id: true },
      });

      if (existingPendingOrFailed) continue;

      const priceText = listing.price
        ? `${listing.price.toLocaleString("sr-RS")} EUR`
        : "Cena nije navedena";

      notificationsToCreate.push({
        deviceId: alert.deviceId,
        expoPushToken: alert.device.expoPushToken,
        keywords: alert.keywords,
        title: `[NOVO] ${listing.title}`,
        body: `${priceText}${listing.locationText ? ` | ${listing.locationText}` : ""}`,
        data: {
          listingId: listing.id,
          url: listing.url,
          alertId: alert.id,
          imageUrl: extractListingImageUrl(listing) ?? "",
        },
        listingId: listing.id,
        alertId: alert.id,
        priceText,
      });
    }
  }

  if (notificationsToCreate.length === 0) {
    console.log("[matcher] No matches found");
    return;
  }

  console.log(`[matcher] Processing ${notificationsToCreate.length} notifications`);

  const groupedNotifications = new Map<string, typeof notificationsToCreate>();

  for (const notification of notificationsToCreate) {
    const key = `${notification.deviceId}:${notification.alertId}`;
    const existing = groupedNotifications.get(key) ?? [];
    existing.push(notification);
    groupedNotifications.set(key, existing);
  }

  for (const grouped of groupedNotifications.values()) {
    try {
      if (grouped.length === 0) {
        continue;
      }

      const createdNotifications = [] as Array<{
        id: string;
        listingId: string;
        alertId: string;
        title: string;
        body: string;
        data: Record<string, string>;
      }>;

      for (const notification of grouped) {
        const createdNotification = await prisma.notification.create({
          data: {
            deviceId: notification.deviceId,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            listingId: notification.listingId,
            alertId: notification.alertId,
            status: "PENDING",
          },
        });

        createdNotifications.push({
          id: createdNotification.id,
          listingId: notification.listingId,
          alertId: notification.alertId,
          title: notification.title,
          body: notification.body,
          data: notification.data,
        });
      }

      const firstNotification = grouped[0];
      const firstCreated = createdNotifications[0];

      if (!firstNotification || !firstCreated) {
        continue;
      }

      const sendResult = grouped.length === 1
        ? await sendAndPersistNotification({
            notificationId: firstCreated.id,
            expoPushToken: firstNotification.expoPushToken,
            title: firstNotification.title,
            body: firstNotification.body,
            data: {
              ...firstNotification.data,
              notificationId: firstCreated.id,
            },
          })
        : await (async () => {
            try {
              await sendExpoPushNotification({
                to: firstNotification.expoPushToken,
                title: buildBatchPushTitle(grouped.length),
                body: buildBatchPushBody(
                  firstNotification.keywords,
                  grouped.map((item) => ({
                    title: item.title.replace(/^\[NOVO\]\s*/, ""),
                    priceText: item.priceText,
                  })),
                ),
                data: {
                  notificationId: firstCreated.id,
                  alertId: firstNotification.alertId,
                  url: firstNotification.data.url,
                  batch: "true",
                  count: String(grouped.length),
                },
              });

              await markNotificationsSent(createdNotifications.map((item) => item.id));
              return { ok: true } as const;
            } catch (error) {
              const errorMessage = getErrorMessage(error);
              await markNotificationsFailed(
                createdNotifications.map((item) => item.id),
                errorMessage,
              );
              return { ok: false, error: errorMessage } as const;
            }
          })();

      if (!sendResult.ok) {
        console.error("[matcher] Push send failed", firstCreated.id, sendResult.error);
        continue;
      }

      for (const createdNotification of createdNotifications) {
        await createNotificationLogIfMissing(
          createdNotification.alertId,
          createdNotification.listingId,
        );
      }
    } catch (error) {
      console.error("[matcher] Error creating/sending notification", error);
    }
  }

  console.log(`[matcher] Processed ${notificationsToCreate.length} notifications`);
}

export async function retryFailedNotifications(limit = 50): Promise<void> {
  const failedNotifications = (await prisma.notification.findMany({
    where: {
      status: "FAILED",
      retries: { lt: MAX_NOTIFICATION_RETRIES },
    },
    include: {
      device: {
        select: { expoPushToken: true },
      },
    },
    orderBy: [{ failedAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  })) as PendingNotificationForRetry[];

  if (failedNotifications.length === 0) {
    return;
  }

  console.log(`[matcher] Retrying ${failedNotifications.length} failed notifications`);

  for (const notification of failedNotifications) {
    const sendResult = await sendAndPersistNotification({
      notificationId: notification.id,
      expoPushToken: notification.device.expoPushToken,
      title: notification.title,
      body: notification.body,
      data: {
        ...(notification.data ?? {}),
        notificationId: notification.id,
      },
    });

    if (!sendResult.ok) {
      console.error(
        "[matcher] Retry failed",
        notification.id,
        sendResult.error,
      );
      continue;
    }

    if (notification.alertId && notification.listingId) {
      await createNotificationLogIfMissing(notification.alertId, notification.listingId);
    }
  }
}
