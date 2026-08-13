import { prisma } from "../../db/prisma.js";
import { sendExpoPushNotification } from "./expoPush.service.js";

const MAX_NOTIFICATION_RETRIES = 3;

type AlertWithDevice = {
  id: string;
  deviceId: string;
  category: string;
  keywords: string[];
  priceMax: number | null;
  locationText: string;
  propertyType: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  kmFrom: number | null;
  kmTo: number | null;
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

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractRawObject(listing: ListingRow): Record<string, unknown> {
  if (!listing.raw || typeof listing.raw !== "object") return {};
  return listing.raw as Record<string, unknown>;
}

function buildListingText(listing: ListingRow): string {
  const raw = extractRawObject(listing);
  return normalizeForMatch([
    listing.title,
    listing.url,
    listing.locationText ?? "",
    String(raw.categoryName ?? ""),
    String(raw.groupName ?? ""),
    String(raw.desc ?? ""),
    String(raw.description ?? ""),
  ].join(" "));
}

function getListingPriceEur(listing: ListingRow): number | null {
  // listing.price is already normalized to EUR at ingest time (ingest.worker.ts) -
  // re-running normalizePriceToEur here would detect the original RSD hints and
  // convert it a second time.
  return listing.price;
}

function isAutoPartText(text: string): boolean {
  return /(auto[-\s]?delov|auto[-\s]?oprema|diferencijal|menjac|amortizer|turbina|alternator|anlaser|kocnic|kvacil|far|stop|branik|retrovizor|trap|lezaj|poluosovin|hladnjak|patosnic|presvlak|tapacirung|kadica)/.test(text);
}

function isAutoVehicleText(text: string): boolean {
  return /(auto[-\s]?oglasi|automobil|vozilo|limuzina|karavan|hatchback|suv|coupe|kabrio|sedan)/.test(text);
}

function isMotoText(text: string): boolean {
  return /(motori|motocikl|motorcikl|skuter|atv|quad)/.test(text);
}

function isMotoPartText(text: string): boolean {
  return /(moto[-\s]?delov|delov[i]?\s+za\s+mot|lanci|lanac|karburator|auspuh|vizir|kofer|kaciga\s+del)/.test(text);
}

function isMotoEquipmentText(text: string): boolean {
  return /(moto[-\s]?oprema|jakna|rukavic|kaciga|cizme|protektor|oprema\s+za\s+mot)/.test(text);
}

function isPropertyText(text: string): boolean {
  return /(nekretnin|stan|lokal|kuca|plac|parcela|zemljiste)/.test(text);
}

function getPropertyTypeFromListing(listing: ListingRow): "STAN" | "LOKAL" | "PARCELA" | null {
  const text = buildListingText(listing);
  if (/(lokal|lokali)/.test(text)) return "LOKAL";
  if (/(plac|parcela|zemljiste)/.test(text)) return "PARCELA";
  if (/(stan|garsonjera|apartman)/.test(text)) return "STAN";
  return null;
}

function getListingKinds(listing: ListingRow): Set<string> {
  const kinds = new Set<string>();
  const text = buildListingText(listing);

  if (listing.source === "pa-car") {
    kinds.add("AUTO_VEHICLE");
  }

  if (listing.source === "pa-moto") {
    kinds.add("MOTO_VEHICLE");
  }

  if (listing.source === "pa-moto-parts-beta") {
    if (isMotoEquipmentText(text)) kinds.add("MOTO_EQUIPMENT");
    if (isMotoPartText(text) || !isMotoEquipmentText(text)) kinds.add("MOTO_PART");
  }

  if (isAutoPartText(text)) kinds.add("AUTO_PART");
  if (isAutoVehicleText(text) && !isAutoPartText(text)) kinds.add("AUTO_VEHICLE");

  if (isMotoText(text)) {
    if (isMotoPartText(text)) kinds.add("MOTO_PART");
    if (isMotoEquipmentText(text)) kinds.add("MOTO_EQUIPMENT");
    if (!isMotoPartText(text) && !isMotoEquipmentText(text)) {
      kinds.add("MOTO_VEHICLE");
    }
  }

  if (isPropertyText(text)) kinds.add("PROPERTY");

  return kinds;
}

function getListingYear(listing: ListingRow): number | null {
  const raw = extractRawObject(listing);
  const directCandidates = [raw.year, raw.productionDate, raw.godiste];
  for (const candidate of directCandidates) {
    const match = String(candidate ?? "").match(/(19\d{2}|20\d{2})/);
    if (match) return Number(match[1]);
  }

  const titleMatch = listing.title.match(/(19\d{2}|20\d{2})/);
  return titleMatch ? Number(titleMatch[1]) : null;
}

function parseKmText(value: unknown): number | null {
  const text = String(value ?? "");
  const match = text.match(/([\d\.\s]{2,})\s*km/i);
  if (!match || !match[1]) return null;

  const normalized = match[1].replace(/[\.\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getListingKm(listing: ListingRow): number | null {
  const raw = extractRawObject(listing);
  return (
    parseKmText(raw.km) ??
    parseKmText(raw.mileageFromOdometer) ??
    parseKmText(listing.title)
  );
}

function locationMatches(listing: ListingRow, locationText: string): boolean {
  const target = normalizeForMatch(locationText);
  if (!target) return true;
  const listingText = buildListingText(listing);
  return listingText.includes(target);
}

function doesMatch(listing: ListingRow, alert: AlertWithDevice): boolean {
  const categoryMap: Record<string, string[]> = {
    AUTOMOBILI: ["pa-car", "kp", "fb-group", "fb-marketplace"],
    AUTO_DELOVI: ["kp", "fb-group", "fb-marketplace"],
    MOTORI: ["pa-moto", "kp", "fb-group", "fb-marketplace"],
    MOTO_DELOVI: ["pa-moto-parts-beta", "kp", "fb-group", "fb-marketplace"],
    MOTO_OPREMA: ["pa-moto-parts-beta", "kp", "fb-group", "fb-marketplace"],
    TELEFONI: ["kp", "fb-group", "fb-marketplace"],
    RACUNARI: ["kp", "fb-group", "fb-marketplace"],
    BICIKLI: ["kp", "fb-group", "fb-marketplace"],
    NEKRETNINE: ["kp", "fb-group", "fb-marketplace"],
    SVE: ["pa-car", "pa-moto", "pa-moto-parts-beta", "kp", "fb-group", "fb-marketplace"],
  };

  const normalizedCategory = alert.category.toUpperCase();
  const allowedSources = categoryMap[normalizedCategory] ?? [];
  if (!allowedSources.includes(listing.source)) return false;

  if (normalizedCategory === "SVE") {
    if (alert.keywords.length === 0) return false;
    const titleLower = normalizeForMatch(listing.title);
    return alert.keywords.every((kw) =>
      titleLower.includes(normalizeForMatch(kw)),
    );
  }

  const listingKinds = getListingKinds(listing);
  if (normalizedCategory === "AUTOMOBILI" && !listingKinds.has("AUTO_VEHICLE")) return false;
  if (normalizedCategory === "AUTO_DELOVI" && !listingKinds.has("AUTO_PART")) return false;
  if (normalizedCategory === "MOTORI" && !listingKinds.has("MOTO_VEHICLE")) return false;
  if (normalizedCategory === "MOTO_DELOVI" && !listingKinds.has("MOTO_PART")) return false;
  if (normalizedCategory === "MOTO_OPREMA" && !listingKinds.has("MOTO_EQUIPMENT")) return false;
  if (normalizedCategory === "NEKRETNINE" && !listingKinds.has("PROPERTY")) return false;

  if (normalizedCategory === "NEKRETNINE" && alert.propertyType) {
    const propertyType = getPropertyTypeFromListing(listing);
    if (propertyType !== alert.propertyType) return false;
  }

  if (!locationMatches(listing, alert.locationText)) {
    return false;
  }

  if (alert.yearFrom !== null || alert.yearTo !== null) {
    const year = getListingYear(listing);
    if (year === null) return false;
    if (alert.yearFrom !== null && year < alert.yearFrom) return false;
    if (alert.yearTo !== null && year > alert.yearTo) return false;
  }

  if (alert.kmFrom !== null || alert.kmTo !== null) {
    const km = getListingKm(listing);
    if (km === null) return false;
    if (alert.kmFrom !== null && km < alert.kmFrom) return false;
    if (alert.kmTo !== null && km > alert.kmTo) return false;
  }

  const listingPriceEur = getListingPriceEur(listing);

  // For "SVE" category, matching intentionally relies only on keywords.
  if (normalizedCategory !== "SVE" && alert.priceMax && listingPriceEur != null && listingPriceEur > alert.priceMax) {
    return false;
  }

  if (alert.keywords.length > 0) {
    const titleLower = normalizeForMatch(listing.title);
    const allMatch = alert.keywords.every((kw) =>
      titleLower.includes(normalizeForMatch(kw)),
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

export async function matchAndNotify(
  listings: ListingRow[],
  options?: { alertIds?: string[] },
): Promise<void> {
  if (listings.length === 0) return;

  const alerts = await prisma.alert.findMany({
    where: options?.alertIds
      ? { id: { in: options.alertIds }, isActive: true }
      : { isActive: true },
    select: {
      id: true,
      deviceId: true,
      category: true,
      keywords: true,
      priceMax: true,
      locationText: true,
      propertyType: true,
      yearFrom: true,
      yearTo: true,
      kmFrom: true,
      kmTo: true,
      isActive: true,
      device: { select: { expoPushToken: true } },
    },
  }) as AlertWithDevice[];

  if (alerts.length === 0) return;

  // OPTIMIZATION: Fetch all sent logs at once (not per-alert)
  const alertIds = alerts.map((a) => a.id);
  const listingIds = listings.map((l) => l.id);
  
  const sentLogs = await prisma.notificationLog.findMany({
    where: {
      alertId: { in: alertIds },
      listingId: { in: listingIds },
    },
    select: { alertId: true, listingId: true },
  });
  
  const sentSet = new Set(
    sentLogs.map((log) => `${log.alertId}|${log.listingId}`)
  );

  // OPTIMIZATION: Fetch all pending/failed notifications at once (not per-alert)
  const pendingNotifications = await prisma.notification.findMany({
    where: {
      alertId: { in: alertIds },
      status: { in: ["PENDING", "FAILED"] },
    },
    select: { alertId: true, listingId: true },
  });
  
  const pendingSet = new Set(
    pendingNotifications
      .filter((n) => n.listingId)
      .map((n) => `${n.alertId}|${n.listingId}`)
  );

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

      // OPTIMIZATION: Check in-memory set (not DB)
      const key = `${alert.id}|${listing.id}`;
      if (sentSet.has(key)) continue;

      // OPTIMIZATION: Check in-memory set (not DB)
      if (pendingSet.has(key)) continue;

      const listingPriceEur = getListingPriceEur(listing);

      const priceText = listingPriceEur
        ? `${listingPriceEur.toLocaleString("sr-RS")} EUR`
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

export async function backfillMatchForAlert(alertId: string): Promise<void> {
  const listings = await prisma.listing.findMany({
    select: {
      id: true,
      source: true,
      title: true,
      price: true,
      locationText: true,
      url: true,
      raw: true,
    },
  });

  if (listings.length === 0) return;

  await matchAndNotify(listings as ListingRow[], { alertIds: [alertId] });
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
