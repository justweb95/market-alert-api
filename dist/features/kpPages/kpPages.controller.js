import axios from 'axios';
import * as cheerio from 'cheerio';
import { getAdIdFromUrl, stripHtmlTags, toPostedAt } from '../../helpers/kpPages.helper.js';
const STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
};
export async function scrapeLatestKpListings(req, res) {
    const { page: pageParam = '1', limit: limitParam = '20' } = req.query;
    const page = Number(pageParam);
    const limit = Number(limitParam);
    const take = Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : 20;
    if (Number.isNaN(page) || page < 1) {
        res.status(400).json({ success: false, error: 'Invalid page number' });
        return;
    }
    try {
        const targetUrl = `${process.env.KP_LATEST_URL ?? 'https://www.kupujemprodajem.com/najnoviji/'}${page}`;
        const { data: html } = await axios.get(targetUrl, {
            headers: STEALTH_HEADERS,
            timeout: 30000,
        });
        const $ = cheerio.load(html);
        const nextDataStr = $('#__NEXT_DATA__').first().text().trim();
        if (!nextDataStr) {
            res.status(500).json({ success: false, error: 'Missing __NEXT_DATA__ on latest page' });
            return;
        }
        const nextData = JSON.parse(nextDataStr);
        // 1) pokušaj da nađeš newest ids
        const newestIds = nextData?.props?.pageProps?.initialReduxState?.search?.newestAdsIds ??
            nextData?.props?.initialReduxState?.search?.newestAdsIds ??
            nextData?.props?.pageProps?.initialReduxState?.searchResult?.adsIds ??
            [];
        // 2) pokušaj da nađeš byId mapu
        const byId = nextData?.props?.pageProps?.initialReduxState?.search?.byId ??
            nextData?.props?.initialReduxState?.search?.byId ??
            nextData?.props?.pageProps?.initialReduxState?.searchResult?.byId ??
            nextData?.props?.pageProps?.initialReduxState?.ad?.byId ??
            {};
        // Fallback: ako nema newestIds, uzmi ključeve byId
        const ids = (Array.isArray(newestIds) && newestIds.length > 0)
            ? newestIds
            : Object.keys(byId);
        const listings = ids.slice(0, take).map((idStr) => {
            const item = byId[idStr];
            const urlPath = String(item?.adUrl ?? '');
            const absoluteUrl = urlPath.startsWith('http')
                ? urlPath
                : `https://www.kupujemprodajem.com${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
            return {
                id: Number(item?.id ?? idStr),
                title: String(item?.name ?? ''),
                url: absoluteUrl,
                desc: String(item?.descriptionSnippetDecoded ?? item?.description ?? ''),
                location: String(item?.location ?? ''),
                categoryId: Number(item?.categoryId ?? 0),
                categoryName: String(item?.categoryName ?? ''),
                groupId: Number(item?.groupId ?? 0),
                groupName: String(item?.groupName ?? ''),
                priceNumber: typeof item?.priceNumber === 'number' ? item.priceNumber : null,
                priceText: String(item?.priceText ?? ''),
                currency: String(item?.currency ?? ''),
                currencyAcronym: String(item?.currencyAcronym ?? ''),
                postedRaw: String(item?.postedRaw ?? ''),
                postedAt: toPostedAt(String(item?.postedRaw ?? '')),
                validUntil: String(item?.adValidUntil ?? ''),
                image: String(item?.image ?? item?.smallImage ?? ''),
            };
        });
        res.json({
            success: true,
            page,
            take,
            count: listings.length,
            listings,
        });
    }
    catch (error) {
        console.error('Error scraping KP:', error.message);
        res.status(500).json({ success: false, error: 'Failed to scrape KP listings' });
    }
}
export async function scrapeOglasHtml(req, res) {
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
    }
    catch (error) {
        console.error('Error fetching KP oglas html:', error?.message ?? error);
        res.status(500).json({ error: 'Failed to fetch oglas html' });
    }
}
//# sourceMappingURL=kpPages.controller.js.map