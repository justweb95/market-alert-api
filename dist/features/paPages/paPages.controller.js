import axios from "axios";
import * as cheerio from "cheerio";
import { parsePowerKwHp } from "../../helpers/paPages.helper.js";
const STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
};
export async function scrapeLatestCarPaListings(req, res) {
    const { limit: LimitParam = '20' } = req.query;
    const limit = Number(LimitParam);
    const timeoutMs = 10000;
    const take = Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20;
    try {
        const targetUrl = process.env.PA_LATEST_CAR_URL ?? 'https://www.polovniautomobili.com/auto-oglasi/poslednja24h';
        const { data: html } = await axios.get(targetUrl, {
            headers: STEALTH_HEADERS,
            timeout: timeoutMs,
        });
        const $ = cheerio.load(html);
        const listings = [];
        // === PARSER ===
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const jsonLdRaw = $(el).html();
                if (!jsonLdRaw)
                    return;
                const jsonLd = JSON.parse(jsonLdRaw);
                if (Array.isArray(jsonLd) && jsonLd[0]) {
                    const car = jsonLd[0];
                    const idMatch = (car.url || '').match(/auto-oglasi\/(\d+)/);
                    if (!idMatch)
                        return;
                    const id = idMatch[1];
                    const article = $(`article[data-classifiedid="${id}"]`);
                    if (article.length > 0) {
                        listings.push({
                            id: Number(id),
                            title: car.name?.trim() ?? '',
                            url: `https://www.polovniautomobili.com${car.url.replace('https://www.polovniautomobili.com', '')}`,
                            brand: car.brand?.trim() ?? '',
                            model: car.model?.trim() ?? '',
                            year: car.productionDate ?? '',
                            fuel: car.fuelType ?? '',
                            km: car.mileageFromOdometer ?? '',
                            priceEur: article.find('.price span').first().text().trim(),
                            city: article.find('.city').text().replace(/^.*?\s/i, '').trim(),
                            renewedAt: article.attr('data-renewdate') ?? '',
                            image: car.image ?? '',
                        });
                    }
                }
            }
            catch (parseError) {
                console.error('JSON-LD parse error:', parseError.message);
            }
        });
        const latestListings = listings.slice(-take);
        res.json({
            success: true,
            count: latestListings.length,
            data: latestListings,
        });
    }
    catch (error) {
        console.error('PA scrape error:', error);
        res.status(500).json({ success: false, error: 'Scrape failed' });
    }
}
export async function scrapeLatestMotoPaListings(req, res) {
    const { limit: LimitParam = '20' } = req.query;
    const limit = Number(LimitParam);
    const timeoutMs = 10000;
    const take = Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20;
    try {
        const targetUrl = process.env.PA_LATEST_MOTO_URL ?? 'https://www.polovniautomobili.com/motori/poslednja24h';
        const { data: html } = await axios.get(targetUrl, {
            headers: STEALTH_HEADERS,
            timeout: timeoutMs,
        });
        const $ = cheerio.load(html);
        const listings = [];
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const raw = $(el).html();
                if (!raw)
                    return;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed) || !parsed[0])
                    return;
                const moto = parsed[0];
                if (moto['@type'] !== 'Motorcycle')
                    return;
                const urlStr = String(moto.url || '').trim();
                const idMatch = urlStr.match(/\/motori\/(\d+)\//);
                if (!idMatch)
                    return;
                const id = idMatch[1];
                const article = $(`article.ad-${id}`);
                if (!article.length)
                    return;
                const title = String(moto.name || '').trim();
                const priceEur = article.find('.price span').first().text().replace(/\s+/g, ' ').trim();
                const city = article.find('.city').text().replace(/\s+/g, ' ').trim();
                // === INFO blocks ===
                // setInfo[0]: year (top) + ccm (bottom)
                const set0Top = article.find('.info .setInfo').eq(0).find('.top').attr('title') || '';
                const set0Bottom = article.find('.info .setInfo').eq(0).find('.bottom').attr('title') || '';
                const year = set0Top.replace(/\s+/g, ' ').trim(); // "2005."
                const ccm = set0Bottom.replace(/\s+/g, ' ').trim(); // "1000 cm3"
                // setInfo[1]: km (top) + power (bottom)
                const set1Top = article.find('.info .setInfo').eq(1).find('.top').attr('title') || '';
                const set1Bottom = article.find('.info .setInfo').eq(1).find('.bottom').attr('title') || '';
                const km = set1Top.replace(/\s+/g, ' ').trim(); // "42.000 km"
                const powerText = set1Bottom.replace(/\s+/g, ' ').trim(); // "125kW (170KS)"
                const { powerKw, powerHp } = parsePowerKwHp(powerText);
                // setInfo[2]: type (top)
                const set2Top = article.find('.info .setInfo').eq(2).find('.top').attr('title') || '';
                const motoType = set2Top.replace(/\s+/g, ' ').trim(); // "Sport / Super sport"
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
                    year: year,
                    km,
                    ccm,
                    powerKw,
                    powerHp,
                    motoType,
                    image: String(moto.image || '').trim(),
                    renewedAt: String(article.attr('data-renewdate') || '').trim(),
                });
            }
            catch {
                // ignore parse errors
            }
        });
        const latestListings = listings.slice(0, take);
        res.json({
            success: true,
            count: latestListings.length,
            data: latestListings,
        });
    }
    catch (error) {
        console.error('PA moto scrape error:', error);
        res.status(500).json({ success: false, error: 'Scrape failed' });
    }
}
//# sourceMappingURL=paPages.controller.js.map