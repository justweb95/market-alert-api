import type { Request, Response } from "express";
import { scrapePaLatestCars, scrapePaLatestMotos } from "./paPages.scraper.js";

export async function scrapeLatestCarPaListings(req: Request, res: Response): Promise<void> {
  const { limit } = req.query;

  try {
    const { count, listings } = await scrapePaLatestCars({ take: Number(limit) });
    res.json({ success: true, count, data: listings });
  } catch (error: unknown) {
    console.error('PA scrape error:', error);
    res.status(500).json({ success: false, error: 'Scrape failed' });
  }
}

export async function scrapeLatestMotoPaListings(req: Request, res: Response): Promise<void> {
  const { limit } = req.query;

  try {
    const { count, listings } = await scrapePaLatestMotos({ take: Number(limit) });
    res.json({ success: true, count, data: listings });
  } catch (error: unknown) {
    console.error('PA moto scrape error:', error);
    res.status(500).json({ success: false, error: 'Scrape failed' });
  }
}
