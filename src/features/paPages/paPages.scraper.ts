import axios from 'axios';
import * as cheerio from 'cheerio';
import { parsePowerKwHp } from '../../helpers/paPages.helper.js';

export interface PaListing {
  id: number;
  title: string;
  url: string;
  brand: string;
  model: string;
  year: string;
  fuel: string;
  km: string;
  priceEur: string;
  city: string;
  renewedAt: string;
  image: string;
}

export interface PaMotoListing {
  id: number;
  title: string;
  url: string;

  priceEur: string;
  city: string;

  brand: string;
  model: string;
  year: string;

  km: string;
  ccm: string;
  powerKw: string;
  powerHp: string;
  motoType: string;

  image: string;
  renewedAt: string;
}

export interface PaMotoPartsListing {
  id: number;
  title: string;
  url: string;
  priceEur: string;
  city: string;
  image: string;
  renewedAt: string;
  listingType: 'MOTO_PART' | 'MOTO_EQUIPMENT';
}

const STEALTH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  DNT: '1',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

function clampTake(input: unknown) {
  const n = Number(input ?? 20);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : 20;
}

export async function scrapePaLatestCars(opts?: { take?: number; timeoutMs?: number }) {
  const take = clampTake(opts?.take);
  const timeoutMs = opts?.timeoutMs ?? 10_000;

  const targetUrl =
    process.env.PA_LATEST_CAR_URL ??
    'https://www.polovniautomobili.com/auto-oglasi/poslednja24h';

  const { data: html } = await axios.get(targetUrl, {
    headers: STEALTH_HEADERS,
    timeout: timeoutMs,
  });

  const $ = cheerio.load(html);
  const listings: PaListing[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const jsonLdRaw = $(el).html();
      if (!jsonLdRaw) return;

      const jsonLd = JSON.parse(jsonLdRaw);
      if (!Array.isArray(jsonLd) || !jsonLd[0]) return;

      const car = jsonLd[0];
      const idMatch = String(car.url || '').match(/auto-oglasi\/(\d+)/);
      if (!idMatch) return;

      const id = idMatch[1];
      const article = $(`article[data-classifiedid="${id}"]`);
      if (!article.length) return;

      const url = String(car.url || '');
      const absoluteUrl = url.startsWith('http')
        ? url
        : `https://www.polovniautomobili.com${url.startsWith('/') ? '' : '/'}${url}`;

      listings.push({
        id: Number(id),
        title: String(car.name ?? '').trim(),
        url: absoluteUrl,
        brand: String(car.brand ?? '').trim(),
        model: String(car.model ?? '').trim(),
        year: String(car.productionDate ?? '').trim(),
        fuel: String(car.fuelType ?? '').trim(),
        km: String(car.mileageFromOdometer ?? '').trim(),
        priceEur: article.find('.price span').first().text().trim(),
        city: article.find('.city').text().replace(/^.*?\s/i, '').trim(),
        renewedAt: String(article.attr('data-renewdate') ?? '').trim(),
        image: String(car.image ?? '').trim(),
      });
    } catch {
      // ignore parse errors
    }
  });

  const latest = listings.slice(-take);
  return { take, count: latest.length, listings: latest };
}

export async function scrapePaLatestMotos(opts?: { take?: number; timeoutMs?: number }) {
  const take = clampTake(opts?.take);
  const timeoutMs = opts?.timeoutMs ?? 10_000;

  const targetUrl =
    process.env.PA_LATEST_MOTO_URL ??
    'https://www.polovniautomobili.com/motori/poslednja24h';

  const { data: html } = await axios.get(targetUrl, {
    headers: STEALTH_HEADERS,
    timeout: timeoutMs,
  });

  const $ = cheerio.load(html);
  const listings: PaMotoListing[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed[0]) return;

      const moto = parsed[0];
      if (moto['@type'] !== 'Motorcycle') return;

      const urlStr = String(moto.url || '').trim();
      const idMatch = urlStr.match(/\/motori\/(\d+)\//);
      if (!idMatch) return;

      const id = idMatch[1];
      const article = $(`article.ad-${id}`);
      if (!article.length) return;

      const title = String(moto.name || '').trim();
      const priceEur = article.find('.price span').first().text().replace(/\s+/g, ' ').trim();
      const city = article.find('.city').text().replace(/\s+/g, ' ').trim();

      const set0Top = article.find('.info .setInfo').eq(0).find('.top').attr('title') || '';
      const set0Bottom = article.find('.info .setInfo').eq(0).find('.bottom').attr('title') || '';
      const year = set0Top.replace(/\s+/g, ' ').trim();
      const ccm = set0Bottom.replace(/\s+/g, ' ').trim();

      const set1Top = article.find('.info .setInfo').eq(1).find('.top').attr('title') || '';
      const set1Bottom = article.find('.info .setInfo').eq(1).find('.bottom').attr('title') || '';
      const km = set1Top.replace(/\s+/g, ' ').trim();
      const powerText = set1Bottom.replace(/\s+/g, ' ').trim();
      const { powerKw, powerHp } = parsePowerKwHp(powerText);

      const set2Top = article.find('.info .setInfo').eq(2).find('.top').attr('title') || '';
      const motoType = set2Top.replace(/\s+/g, ' ').trim();

      const absoluteUrl = urlStr.startsWith('http')
        ? urlStr
        : `https://www.polovniautomobili.com${urlStr.startsWith('/') ? '' : '/'}${urlStr}`;

      listings.push({
        id: Number(id),
        title,
        url: absoluteUrl,
        priceEur,
        city,
        brand: String(moto.brand || '').trim(),
        model: String(moto.model || '').trim(),
        year,
        km,
        ccm,
        powerKw,
        powerHp,
        motoType,
        image: String(moto.image || '').trim(),
        renewedAt: String(article.attr('data-renewdate') || '').trim(),
      });
    } catch {
      // ignore parse errors
    }
  });

  const latest = listings.slice(0, take);
  return { take, count: latest.length, listings: latest };
}

export async function scrapePaMotoPartsAndEquipmentBeta(opts?: {
  take?: number;
  timeoutMs?: number;
}) {
  const take = clampTake(opts?.take);
  const timeoutMs = opts?.timeoutMs ?? 10_000;

  const targetUrl =
    process.env.PA_MOTO_PARTS_URL ??
    'https://www.polovniautomobili.com/delovi-i-oprema/motori/moto-delovi-i-oprema/pretraga?text_search=&submit=';

  const { data: html } = await axios.get(targetUrl, {
    headers: STEALTH_HEADERS,
    timeout: timeoutMs,
  });

  const $ = cheerio.load(html);
  const listings: PaMotoPartsListing[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed[0]) return;

      const item = parsed[0];
      const title = String(item.name ?? '').trim();
      const urlStr = String(item.url ?? '').trim();
      if (!title || !urlStr) return;

      const idMatch = urlStr.match(/\/(\d+)(?:\/|$)/);
      if (!idMatch) return;

      const id = Number(idMatch[1]);
      if (!Number.isFinite(id)) return;

      const absoluteUrl = urlStr.startsWith('http')
        ? urlStr
        : `https://www.polovniautomobili.com${urlStr.startsWith('/') ? '' : '/'}${urlStr}`;

      const article = $(`article.ad-${id}, article[data-classifiedid="${id}"]`).first();
      const articleText = article.text().replace(/\s+/g, ' ').trim().toLowerCase();

      const listingType: 'MOTO_PART' | 'MOTO_EQUIPMENT' =
        /(oprema|kaciga|jakna|rukavice|cizme|protektor)/.test(articleText) ||
        /(oprema|kaciga|jakna|rukavice|cizme|protektor)/.test(title.toLowerCase())
          ? 'MOTO_EQUIPMENT'
          : 'MOTO_PART';

      listings.push({
        id,
        title,
        url: absoluteUrl,
        priceEur: article.find('.price span').first().text().replace(/\s+/g, ' ').trim(),
        city: article.find('.city').text().replace(/\s+/g, ' ').trim(),
        image: String(item.image ?? '').trim(),
        renewedAt: String(article.attr('data-renewdate') ?? '').trim(),
        listingType,
      });
    } catch {
      // ignore parse errors
    }
  });

  const latest = listings.slice(0, take);
  return { take, count: latest.length, listings: latest };
}
