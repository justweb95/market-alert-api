import Expo from "expo-server-sdk";
const expo = new Expo(process.env.EXPO_ACCESS_TOKEN
    ? { accessToken: process.env.EXPO_ACCESS_TOKEN }
    : undefined);
export async function sendExpoPushNotification({ to, title, body, data, }) {
    if (!Expo.isExpoPushToken(to)) {
        throw new Error(`Neispravan Expo push token: ${to}`);
    }
    const message = {
        to,
        title,
        body,
        sound: "default",
        priority: "high",
        channelId: "default",
        ...(data ? { data } : {}),
    };
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        const failedTicket = tickets.find((ticket) => ticket.status === "error");
        if (failedTicket?.status === "error") {
            throw new Error(failedTicket.details?.error
                ? `${failedTicket.message} (${failedTicket.details.error})`
                : failedTicket.message);
        }
    }
}
//# sourceMappingURL=expoPush.service.js.map