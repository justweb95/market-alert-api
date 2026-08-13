import Expo from "expo-server-sdk";

const expo = new Expo(
  process.env.EXPO_ACCESS_TOKEN
    ? { accessToken: process.env.EXPO_ACCESS_TOKEN }
    : undefined,
);

type SendPushInput = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function sendExpoPushNotification({
  to,
  title,
  body,
  data,
}: SendPushInput): Promise<void> {
  if (!Expo.isExpoPushToken(to)) {
    throw new Error(`Neispravan Expo push token: ${to}`);
  }

  const message = {
    to,
    title,
    body,
    sound: "default" as const,
    priority: "high" as const,
    channelId: "default",
    ...(data ? { data } : {}),
  };

  const chunks = expo.chunkPushNotifications([message]);

  for (const chunk of chunks) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    const failedTicket = tickets.find((ticket) => ticket.status === "error");

    if (failedTicket?.status === "error") {
      throw new Error(
        failedTicket.details?.error
          ? `${failedTicket.message} (${failedTicket.details.error})`
          : failedTicket.message,
      );
    }
  }
}
