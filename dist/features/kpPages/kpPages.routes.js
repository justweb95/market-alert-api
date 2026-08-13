import { Router } from 'express';
import { scrapeLatestKpListings, } from './kpPages.controller.js';
const kpPagesRouter = Router();
kpPagesRouter.get('/latest', scrapeLatestKpListings);
export { kpPagesRouter };
//# sourceMappingURL=kpPages.routes.js.map