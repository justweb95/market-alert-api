import Expo from 'expo-server-sdk';
import { prisma } from '../../db/prisma';

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type AlertWithDevice = {
  id: string;
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
};

function doesMatch(listing: ListingRow, alert: AlertWithDevice): boolean {
  const categoryMap: Record<string, string[]> = {
    AUTOMOBILI: ['pa-car', 'kp'],
    MOTORI: ['pa-moto', 'kp'],
    TELEFONI: ['kp'],
  };

  const allowedSources = categoryMap[alert.category] ?? [];
  if (!allowedSources.includes(listing.source)) return false;

  if (alert.priceMax && listing.price != null) {
    if (listing.price > alert.priceMax) return false;
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

export async function matchAndNotify(listings: ListingRow[]): Promise<void> {
  if (listings.length === 0) return;

  const alerts = await prisma.alert.findMany({
    where: { isActive: true },
    include: { device: true },
  });

  if (alerts.length === 0) return;

  const expo = new Expo();
  const messages: PushMessage[] = [];
  const logsToCreate: { alertId: string; listingId: string }[] = [];

  for (const alert of alerts) {
    if (!Expo.isExpoPushToken(alert.device.expoPushToken)) continue;

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

      const priceText = listing.price
        ? `${listing.price.toLocaleString('sr-RS')} EUR`
        : 'Cena nije navedena';

      messages.push({
        to: alert.device.expoPushToken,
        title: `🔔 ${listing.title}`,
        body: `${priceText}${listing.locationText ? ' • ' + listing.locationText : ''}`,
        data: {
          listingId: listing.id,
          url: listing.url,
          alertId: alert.id,
        },
      });

      logsToCreate.push({ alertId: alert.id, listingId: listing.id });
    }
  }

  if (messages.length === 0) {
    console.log('[matcher] No matches found');
    return;
  }

  console.log(`[matcher] Sending ${messages.length} push notifications`);

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      console.log('[matcher] sent chunk, receipts:', receipts.length);
    } catch (e) {
      console.error('[matcher] push send error', e);
    }
  }

  await prisma.notificationLog.createMany({
    data: logsToCreate,
    skipDuplicates: true,
  });

  console.log(`[matcher] Logged ${logsToCreate.length} notifications`);
}
