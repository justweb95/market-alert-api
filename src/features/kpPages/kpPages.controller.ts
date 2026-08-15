import axios from 'axios';
import type { Request, Response } from 'express';
import { scrapeKpLatest } from './kpPages.scraper.js';

const STEALTH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

export async function scrapeLatestKpListings(req: Request, res: Response): Promise<void> {
  const { page: pageParam = '1', limit: limitParam = '20' } = req.query;

  const page = Number(pageParam);
  const limit = Number(limitParam);
  const take = Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20;

  if (Number.isNaN(page) || page < 1) {
    res.status(400).json({ success: false, error: 'Invalid page number' });
    return;
  }

  try {
    const { listings } = await scrapeKpLatest({ page, take });
    res.json({ success: true, page, take, count: listings.length, listings });
  } catch (error: unknown) {
    console.error('Error scraping KP:', error);
    res.status(500).json({ success: false, error: 'Failed to scrape KP listings' });
  }
}

// Debug helper - vraca raw HTML jednog oglasa (ne prolazi kroz Patchright, taj deo
// sajta jos nije proveravan da li ima istu ne-browser detekciju kao listing stranice).
export async function scrapeOglasHtml(req: Request, res: Response): Promise<void> {
  const url = String(req.query.url ?? '').trim();
  if (!url) {
    res.status(400).json({ error: 'Missing url query param' });
    return;
  }

  try {
    const { data: html } = await axios.get(url, {
      headers: STEALTH_HEADERS,
      timeout: 20000,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error: unknown) {
    console.error('Error fetching KP oglas html:', error);
    res.status(500).json({ error: 'Failed to fetch oglas html' });
  }
}
