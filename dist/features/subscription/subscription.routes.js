import { Router } from "express";
import { handleRevenueCatWebhook } from "./subscription.controller.js";
export const subscriptionRouter = Router();
// RevenueCat sends POST events here — configure this URL in RC dashboard under Integrations → Webhooks
subscriptionRouter.post("/webhook", handleRevenueCatWebhook);
//# sourceMappingURL=subscription.routes.js.map