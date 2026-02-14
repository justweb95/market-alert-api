import axios from 'axios';
import type { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { 
  getAdIdFromUrl, 
  stripHtmlTags, 
  toPostedAt } from '../../helpers/kpPages.helper.ts';

const STEALTH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
}

export interface KpListing {
  id: number;              
  title: string;
  url: string;

  desc: string;

  location: string;

  categoryId: number;
  categoryName: string;
  groupId: number;
  groupName: string;

  priceNumber: number | null;   
  priceText: string;           
  currency: string;            
  currencyAcronym: string;     

  postedRaw: string;            
  postedAt: string;             
  validUntil?: string;         
}


export async function scrapeLatestKpListings(req: Request, res: Response): Promise<void> {
  const { page: pageParam = '1', limit: limitParam = '20' } = req.query;

  const page = Number(pageParam);
  const limit = Number(limitParam);
  const take = Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20;

  if (Number.isNaN(page) || page < 1) {
    res.status(400).json({ error: 'Invalid page number' });
    return;
  }

  try {
    const targetUrl = `${process.env.KP_LATEST_URL ?? 'https://www.kupujemprodajem.com/najnoviji/'}${page}`;

    const { data: html } = await axios.get(targetUrl, {
      headers: STEALTH_HEADERS,
      timeout: 30000,
    });

    const $ = cheerio.load(html);
    const basicListings: Array<{ title: string; url: string }> = [];

    // JSON-LD ItemList -> URL-ovi
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const jsonStr = $(script).html()?.trim();
        if (!jsonStr) return;

        const data = JSON.parse(jsonStr);
        if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
          data.itemListElement.forEach((item: any, index: number) => {
            if (item?.url && String(item.url).includes('/oglas/')) {
              basicListings.push({
                title: item.name || `Oglas #${index + 1}`,
                url: String(item.url).startsWith('http')
                  ? String(item.url)
                  : `https://www.kupujemprodajem.com${item.url}`,
              });
            }
          });
        }
      } catch {}
    });

    // uzmi poslednjih N (najnoviji)
    const lastN = basicListings.slice(-take);

    // details iz __NEXT_DATA__
    const listings: KpListing[] = await Promise.all(
      lastN.map(async (b) => {
        try {
          const d = await fetchOglasDetails(b.url);
          // fallback title ako treba
          return { ...d, title: d.title || b.title };
        } catch {
          // fallback (minimalno)
          return {
            id: Number(getAdIdFromUrl(b.url) || 0),
            title: b.title,
            url: b.url,
            desc: '',
            location: '',
            categoryId: 0,
            categoryName: '',
            groupId: 0,
            groupName: '',
            priceNumber: null,
            priceText: '',
            currency: '',
            currencyAcronym: '',
            postedRaw: '',
            postedAt: '',
            validUntil: '',
          };
        }
      })
    );

    res.json({
      success: true,
      page,
      take,
      totalBasicListings: basicListings.length,
      listings,
    });
  } catch (error: any) {
    console.error('Error scraping KP:', error.message);
    res.status(500).json({ error: 'Failed to scrape KP listings' });
  }
}


export async function scrapeOglasDetails(req: Request, res: Response): Promise<void> {
  const { urls }: { urls: string[] } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: 'urls[] is required' });
    return;
  }

  const details = await Promise.all(
    urls.slice(0, 5).map(async (u) => {
      try {
        return await fetchOglasDetails(u);
      } catch {
        return { url: u, error: 'Failed to scrape' };
      }
    })
  );

  res.json({ success: true, details });
}


async function fetchOglasDetails(url: string): Promise<KpListing> {
  const { data: detailHtml } = await axios.get(url, {
    headers: STEALTH_HEADERS,
    timeout: 20000,
  });

  const $ = cheerio.load(detailHtml);

  const nextDataStr = $('#__NEXT_DATA__').first().text().trim();
  if (!nextDataStr) {
    throw new Error('Missing __NEXT_DATA__');
  }

  const nextData = JSON.parse(nextDataStr);

  const adId = getAdIdFromUrl(url);
  if (!adId) {
    throw new Error('Missing adId in url');
  }

  // KP kod tebe ima ad u: props.initialReduxState.ad.byId[adId]  (videli u paste)
  // ali ostavljamo i fallback na pageProps varijantu.
  const ad =
    nextData?.props?.initialReduxState?.ad?.byId?.[adId] ??
    nextData?.props?.pageProps?.initialReduxState?.ad?.byId?.[adId];

  if (!ad) {
    throw new Error(`Ad not found in __NEXT_DATA__ for id=${adId}`);
  }

  const postedRaw = String(ad.postedRaw ?? '');
  const postedAt = toPostedAt(postedRaw);

  return {
    id: Number(ad.id ?? Number(adId)),

    title: String(ad.name ?? ''),
    url,

    desc: stripHtmlTags(String(ad.description ?? '')),

    location: String(ad.location ?? ''),

    categoryId: Number(ad.categoryId ?? 0),
    categoryName: String(ad.categoryName ?? ''),
    groupId: Number(ad.groupId ?? 0),
    groupName: String(ad.groupName ?? ''),

    priceNumber: typeof ad.priceNumber === 'number' ? ad.priceNumber : (Number.isFinite(Number(ad.priceNumber)) ? Number(ad.priceNumber) : null),
    priceText: String(ad.priceText ?? ''),
    currency: String(ad.currency ?? ''),
    currencyAcronym: String(ad.currencyAcronym ?? ''),

    postedRaw,
    postedAt,
    validUntil: String(ad.adValidUntil ?? ad.validUntil ?? ''),
  };
}








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

    // Vrati kao TEXT da Postman prikaže ceo HTML
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error: any) {
    console.error('Error fetching KP oglas html:', error?.message ?? error);
    res.status(500).json({ error: 'Failed to fetch oglas html' });
  }
}
