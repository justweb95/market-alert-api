import { scrapePaLatestCars, scrapePaLatestMotos } from "./paPages.scraper.js";
export async function scrapeLatestCarPaListings(req, res) {
    const { limit } = req.query;
    try {
        const { count, listings } = await scrapePaLatestCars({ take: Number(limit) });
        res.json({ success: true, count, data: listings });
    }
    catch (error) {
        console.error('PA scrape error:', error);
        res.status(500).json({ success: false, error: 'Scrape failed' });
    }
}
export async function scrapeLatestMotoPaListings(req, res) {
    const { limit } = req.query;
    try {
        const { count, listings } = await scrapePaLatestMotos({ take: Number(limit) });
        res.json({ success: true, count, data: listings });
    }
    catch (error) {
        console.error('PA moto scrape error:', error);
        res.status(500).json({ success: false, error: 'Scrape failed' });
    }
}
//# sourceMappingURL=paPages.controller.js.map