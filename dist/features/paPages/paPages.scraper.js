import * as cheerio from 'cheerio';
import { parsePowerKwHp } from '../../helpers/paPages.helper.js';
import { fetchPaHtml } from './paCloudflare.service.js';
// The site's ad cards render everything the scraper needs into a single
// <img alt="..."> string, e.g.:
//   "Land Rover Range Rover Sport, 14.900 €, 2011. Džip/SUV, Dizel | 2993 cm3, 232.300 km, 180kW (245 KS), ..., Šid"
//   "Kawasaki z800, 6.350 €, 2016. , 806 cm3, 32.470 km, 83kW (113 KS), Naked, Kragujevac"
//   "SHARK navozi za ATV vozila, 280 €, Novo, Beograd"
// "ARTICLE_SELECTOR" excludes the interleaved "emptyAd" ad-slot placeholders.
const ARTICLE_SELECTOR = 'article[data-testid="featuredAd"], article[data-testid="newAd"]';
function clampTake(input) {
    const n = Number(input ?? 20);
    return Number.isFinite(n) && n > 0 && n <= 50 ? n : 20;
}
function toAbsoluteUrl(href) {
    const clean = href.split('?')[0] ?? '';
    if (!clean)
        return '';
    return clean.startsWith('http')
        ? clean
        : `https://www.polovniautomobili.com${clean.startsWith('/') ? '' : '/'}${clean}`;
}
function splitTitlePriceRest(alt) {
    const m = alt.match(/^(.*?),\s*([\d.,]+)\s*€,?\s*(.*)$/s);
    if (!m)
        return null;
    return { title: (m[1] ?? '').trim(), priceEur: `${(m[2] ?? '').trim()} €`, rest: (m[3] ?? '').trim() };
}
function lastCsvSegment(text) {
    const parts = text.split(',');
    return parts[parts.length - 1]?.trim() ?? '';
}
export async function scrapePaLatestCars(opts) {
    const take = clampTake(opts?.take);
    const targetUrl = process.env.PA_LATEST_CAR_URL ??
        'https://www.polovniautomobili.com/auto-oglasi/poslednja24h';
    const html = await fetchPaHtml(targetUrl);
    const $ = cheerio.load(html);
    const listings = [];
    $(ARTICLE_SELECTOR).each((_, el) => {
        try {
            const article = $(el);
            const href = article.find('a[href*="/auto-oglasi/"]').first().attr('href') ?? '';
            const idMatch = href.match(/\/auto-oglasi\/(\d+)\//);
            if (!idMatch)
                return;
            const img = article.find('img').first();
            const alt = img.attr('alt') ?? '';
            const parsed = splitTitlePriceRest(alt);
            if (!parsed)
                return;
            const detail = parsed.rest.match(/^(\d{4})\.\s*([^,]*),\s*([^|]+)\|\s*(\d+)\s*cm3,\s*([\d.,]+)\s*km,\s*\d+kW\s*\(\d+\s*KS\),\s*[^,]+,\s*\d+\/\d+\s*vrata,\s*\d+\s*sedišta,\s*(.+)$/);
            listings.push({
                id: Number(idMatch[1]),
                title: parsed.title,
                url: toAbsoluteUrl(href),
                brand: '',
                model: '',
                year: detail?.[1] ?? '',
                fuel: detail?.[3]?.trim() ?? '',
                bodyType: detail?.[2]?.trim() ?? '',
                km: detail?.[5] ?? '',
                priceEur: parsed.priceEur,
                city: detail?.[6]?.trim() ?? lastCsvSegment(parsed.rest),
                renewedAt: '',
                image: img.attr('src') ?? '',
            });
        }
        catch {
            // ignore parse errors
        }
    });
    const latest = listings.slice(0, take);
    return { take, count: latest.length, listings: latest };
}
export async function scrapePaLatestMotos(opts) {
    const take = clampTake(opts?.take);
    const targetUrl = process.env.PA_LATEST_MOTO_URL ??
        'https://www.polovniautomobili.com/motori/poslednja24h';
    const html = await fetchPaHtml(targetUrl);
    const $ = cheerio.load(html);
    const listings = [];
    $(ARTICLE_SELECTOR).each((_, el) => {
        try {
            const article = $(el);
            const href = article.find('a[href*="/motori/"]').first().attr('href') ?? '';
            const idMatch = href.match(/\/motori\/(\d+)\//);
            if (!idMatch)
                return;
            const img = article.find('img').first();
            const alt = img.attr('alt') ?? '';
            const parsed = splitTitlePriceRest(alt);
            if (!parsed)
                return;
            const detail = parsed.rest.match(/^(\d{4})\.\s*,\s*(\d+)\s*cm3,\s*([\d.,]+)\s*km,\s*(\d+kW\s*\(\d+\s*KS\)),\s*([^,]+),\s*(.+)$/);
            const { powerKw, powerHp } = parsePowerKwHp(detail?.[4] ?? '');
            listings.push({
                id: Number(idMatch[1]),
                title: parsed.title,
                url: toAbsoluteUrl(href),
                priceEur: parsed.priceEur,
                city: detail?.[6]?.trim() ?? lastCsvSegment(parsed.rest),
                brand: '',
                model: '',
                year: detail?.[1] ?? '',
                km: detail?.[3] ?? '',
                ccm: detail?.[2] ? `${detail[2]} cm3` : '',
                powerKw,
                powerHp,
                motoType: detail?.[5]?.trim() ?? '',
                image: img.attr('src') ?? '',
                renewedAt: '',
            });
        }
        catch {
            // ignore parse errors
        }
    });
    const latest = listings.slice(0, take);
    return { take, count: latest.length, listings: latest };
}
export async function scrapePaMotoPartsAndEquipmentBeta(opts) {
    const take = clampTake(opts?.take);
    const targetUrl = process.env.PA_MOTO_PARTS_URL ??
        'https://www.polovniautomobili.com/delovi-i-oprema/motori/moto-delovi-i-oprema/pretraga?text_search=&submit=';
    const html = await fetchPaHtml(targetUrl);
    const $ = cheerio.load(html);
    const listings = [];
    $(ARTICLE_SELECTOR).each((_, el) => {
        try {
            const article = $(el);
            const href = article.find('a[href*="/moto-delovi-i-oprema/"]').first().attr('href') ?? '';
            const idMatch = href.match(/\/moto-delovi-i-oprema\/(\d+)\//);
            if (!idMatch)
                return;
            const id = Number(idMatch[1]);
            if (!Number.isFinite(id))
                return;
            const img = article.find('img').first();
            const alt = img.attr('alt') ?? '';
            const parsed = splitTitlePriceRest(alt);
            if (!parsed)
                return;
            const city = lastCsvSegment(parsed.rest);
            const combinedText = `${parsed.title} ${parsed.rest}`.toLowerCase();
            const listingType = /(oprema|kaciga|jakna|rukavice|cizme|protektor)/.test(combinedText)
                ? 'MOTO_EQUIPMENT'
                : 'MOTO_PART';
            listings.push({
                id,
                title: parsed.title,
                url: toAbsoluteUrl(href),
                priceEur: parsed.priceEur,
                city,
                image: img.attr('src') ?? '',
                renewedAt: '',
                listingType,
            });
        }
        catch {
            // ignore parse errors
        }
    });
    const latest = listings.slice(0, take);
    return { take, count: latest.length, listings: latest };
}
//# sourceMappingURL=paPages.scraper.js.map