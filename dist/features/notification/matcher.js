import { prisma } from "../../db/prisma.js";
import { sendExpoPushNotification } from "./expoPush.service.js";
const MAX_NOTIFICATION_RETRIES = 3;
function getErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return "Nepoznata greska pri slanju push notifikacije";
}
async function markNotificationSent(notificationId) {
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
async function markNotificationsSent(notificationIds) {
    if (notificationIds.length === 0)
        return;
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
async function markNotificationFailed(notificationId, errorMessage) {
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
async function markNotificationsFailed(notificationIds, errorMessage) {
    if (notificationIds.length === 0)
        return;
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
async function createNotificationLogIfMissing(alertId, listingId) {
    await prisma.notificationLog.createMany({
        data: [{ alertId, listingId }],
        skipDuplicates: true,
    });
}
async function sendAndPersistNotification(input) {
    try {
        await sendExpoPushNotification({
            to: input.expoPushToken,
            title: input.title,
            body: input.body,
            data: input.data,
        });
        await markNotificationSent(input.notificationId);
        return { ok: true };
    }
    catch (error) {
        const errorMessage = getErrorMessage(error);
        await markNotificationFailed(input.notificationId, errorMessage);
        return { ok: false, error: errorMessage };
    }
}
function buildBatchPushTitle(count) {
    if (count === 1)
        return "[NOVO] 1 novi oglas";
    if (count >= 2 && count <= 4)
        return `[NOVO] ${count} nova oglasa`;
    return `[NOVO] ${count} novih oglasa`;
}
function buildBatchPushBody(keywords, listings) {
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
function doesMatch(listing, alert) {
    const categoryMap = {
        AUTOMOBILI: ["pa-car", "kp"],
        MOTORI: ["pa-moto", "kp"],
        TELEFONI: ["kp"],
        RACUNARI: ["kp"],
        BICIKLI: ["kp"],
        NEKRETNINE: ["kp"],
    };
    const allowedSources = categoryMap[alert.category] ?? [];
    if (!allowedSources.includes(listing.source))
        return false;
    if (alert.priceMax && listing.price != null && listing.price > alert.priceMax) {
        return false;
    }
    if (alert.keywords.length > 0) {
        const titleLower = listing.title.toLowerCase();
        const allMatch = alert.keywords.every((kw) => titleLower.includes(kw.toLowerCase()));
        if (!allMatch)
            return false;
    }
    return true;
}
function extractListingImageUrl(listing) {
    if (!listing.raw || typeof listing.raw !== "object")
        return null;
    const raw = listing.raw;
    const image = raw.image;
    if (typeof image === "string" && image.trim().length > 0)
        return image;
    const smallImage = raw.smallImage;
    if (typeof smallImage === "string" && smallImage.trim().length > 0) {
        return smallImage;
    }
    return null;
}
export async function matchAndNotify(listings) {
    if (listings.length === 0)
        return;
    const alerts = (await prisma.alert.findMany({
        where: { isActive: true },
        include: { device: true },
    }));
    if (alerts.length === 0)
        return;
    const notificationsToCreate = [];
    for (const alert of alerts) {
        for (const listing of listings) {
            if (!doesMatch(listing, alert))
                continue;
            const alreadySent = await prisma.notificationLog.findUnique({
                where: {
                    alertId_listingId: {
                        alertId: alert.id,
                        listingId: listing.id,
                    },
                },
            });
            if (alreadySent)
                continue;
            const existingPendingOrFailed = await prisma.notification.findFirst({
                where: {
                    alertId: alert.id,
                    listingId: listing.id,
                    status: { in: ["PENDING", "FAILED"] },
                },
                select: { id: true },
            });
            if (existingPendingOrFailed)
                continue;
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
    const groupedNotifications = new Map();
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
            const createdNotifications = [];
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
                            body: buildBatchPushBody(firstNotification.keywords, grouped.map((item) => ({
                                title: item.title.replace(/^\[NOVO\]\s*/, ""),
                                priceText: item.priceText,
                            }))),
                            data: {
                                notificationId: firstCreated.id,
                                alertId: firstNotification.alertId,
                                url: firstNotification.data.url,
                                batch: "true",
                                count: String(grouped.length),
                            },
                        });
                        await markNotificationsSent(createdNotifications.map((item) => item.id));
                        return { ok: true };
                    }
                    catch (error) {
                        const errorMessage = getErrorMessage(error);
                        await markNotificationsFailed(createdNotifications.map((item) => item.id), errorMessage);
                        return { ok: false, error: errorMessage };
                    }
                })();
            if (!sendResult.ok) {
                console.error("[matcher] Push send failed", firstCreated.id, sendResult.error);
                continue;
            }
            for (const createdNotification of createdNotifications) {
                await createNotificationLogIfMissing(createdNotification.alertId, createdNotification.listingId);
            }
        }
        catch (error) {
            console.error("[matcher] Error creating/sending notification", error);
        }
    }
    console.log(`[matcher] Processed ${notificationsToCreate.length} notifications`);
}
export async function retryFailedNotifications(limit = 50) {
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
    }));
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
            console.error("[matcher] Retry failed", notification.id, sendResult.error);
            continue;
        }
        if (notification.alertId && notification.listingId) {
            await createNotificationLogIfMissing(notification.alertId, notification.listingId);
        }
    }
}
//# sourceMappingURL=matcher.js.map