import { Router } from "express";
import {
    createAlert,
    deleteAlert,
    getAlerts,
    getPendingNotifications,
    markNotificationAsSeen,
    registerDevice,
    sendTestNotification,
    toggleAlert,
} from "./notification.controller.js";

export const notificationRouter = Router();

notificationRouter.post("/devices", registerDevice);
notificationRouter.post("/alerts", createAlert);
notificationRouter.get("/alerts/:deviceId", getAlerts);
notificationRouter.patch("/alerts/:id/toggle", toggleAlert);
notificationRouter.delete("/alerts/:id", deleteAlert);
notificationRouter.post("/test", sendTestNotification);
notificationRouter.get("/pending/:deviceId", getPendingNotifications);
notificationRouter.patch("/:id/seen", markNotificationAsSeen);
