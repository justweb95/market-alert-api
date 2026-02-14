import { Router } from 'express';

import {
  scrapeLatestKpListings,
  scrapeOglasHtml,


} from './kpPages.controller.js';

const kpPagesRouter = Router();



kpPagesRouter.get('/latest', scrapeLatestKpListings);
kpPagesRouter.get('/oglas-html', scrapeOglasHtml);


export { kpPagesRouter };