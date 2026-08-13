import { Router } from "express";
import { getStatistic, manageDrugarski, manageSubscription } from "./statistic.controller.js";
import { statisticLimiter } from "../../lib/rate-limit.js";
export const statisticRouter = Router();
statisticRouter.get("/", statisticLimiter, getStatistic);
statisticRouter.patch("/admin/subscription", statisticLimiter, manageSubscription);
statisticRouter.patch("/admin/drugarski", statisticLimiter, manageDrugarski);
//# sourceMappingURL=statistic.routes.js.map