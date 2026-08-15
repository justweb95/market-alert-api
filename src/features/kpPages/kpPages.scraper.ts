import * as cheerio from 'cheerio';
import { detectCurrencyFromText, parseAmount } from '../../helpers/currency.helper.js';
import { fetchKpHtml } from './kpBrowser.service.js';

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

  image?: string;
}

// 2026-08-15: KP je promenio frontend (App-Router-stil kartice, CSS-module hash
// klase) — stari parser je citao __NEXT_DATA__.props.pageProps.initialReduxState,
// sto sad dolazi prazno za ne-browser zahteve (videti kpBrowser.service.ts).
// Novi parser cita oglase direktno iz DOM-a preko klasa koje sadrze ove fragmente
// (hash prefiks/sufiks se menja po build-u, sadrzaj klase ne).
const ARTICLE_SELECTOR = 'article[class*="adHolder"]';

function pickText($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI, classSubstr: string): string {
  const match = $el.find(`[class*="${classSubstr}"]`).first();
  return match.length ? match.text().trim() : '';
}

export async function scrapeKpLatest(opts?: { page?: number; take?: number }) {
  const page = opts?.page ?? 1;
  const take = Math.max(1, Math.min(50, Number(opts?.take ?? 20) || 20));

  const targetUrl = `${process.env.KP_LATEST_URL ?? 'https://www.kupujemprodajem.com/najnoviji/'}${page}`;

  const html = await fetchKpHtml(targetUrl);
  const $ = cheerio.load(html);

  const cards = $(ARTICLE_SELECTOR).toArray().slice(0, take);

  const listings: KpListing[] = cards.map((card) => {
    const $card = $(card);
    const href = $card.find('a[href*="/oglas/"]').first().attr('href') ?? '';
    const idMatch = href.match(/\/oglas\/(\d+)/);
    const id = idMatch ? Number(idMatch[1]) : 0;
    const absoluteUrl = href.startsWith('http')
      ? href
      : `https://www.kupujemprodajem.com${href.startsWith('/') ? '' : '/'}${href}`;

    const img = $card.find('img').first();
    const title =
      pickText($card, $, '__name') ||
      img.attr('alt') ||
      $card.find('a[href*="/oglas/"]').first().attr('aria-label') ||
      '';

    const priceText = pickText($card, $, 'adPrice') || pickText($card, $, '__price');
    const priceNumber = parseAmount(priceText);
    const currency = detectCurrencyFromText(priceText) ?? '';

    const location = pickText($card, $, 'originAndPromoLocation') || pickText($card, $, 'Location');
    const image = img.attr('src') || img.attr('data-src') || '';

    return {
      id,
      title,
      url: absoluteUrl,
      desc: '',
      location,
      categoryId: 0,
      categoryName: '',
      groupId: 0,
      groupName: '',
      priceNumber,
      priceText,
      currency,
      currencyAcronym: currency,
      postedRaw: '',
      postedAt: '',
      image,
    } satisfies KpListing;
  });

  return { page, take, listings: listings.filter((l) => l.id && l.title && l.url) };
}
