import axios from 'axios';
import * as cheerio from 'cheerio';
import { toPostedAt } from '../../helpers/kpPages.helper.js';
const STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    DNT: '1',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
};
export async function scrapeKpLatest(opts) {
    const page = opts?.page ?? 1;
    const take = Math.max(1, Math.min(50, Number(opts?.take ?? 20) || 20));
    const targetUrl = `${process.env.KP_LATEST_URL ?? 'https://www.kupujemprodajem.com/najnoviji/'}${page}`;
    const { data: html } = await axios.get(targetUrl, {
        headers: STEALTH_HEADERS,
        timeout: 30_000,
    });
    const $ = cheerio.load(html);
    const nextDataStr = $('#__NEXT_DATA__').first().text().trim();
    if (!nextDataStr)
        return { page, take, listings: [] };
    const nextData = JSON.parse(nextDataStr);
    const newestIds = nextData?.props?.pageProps?.initialReduxState?.search?.newestAdsIds ??
        nextData?.props?.initialReduxState?.search?.newestAdsIds ??
        nextData?.props?.pageProps?.initialReduxState?.searchResult?.adsIds ??
        [];
    const byId = nextData?.props?.pageProps?.initialReduxState?.search?.byId ??
        nextData?.props?.initialReduxState?.search?.byId ??
        nextData?.props?.pageProps?.initialReduxState?.searchResult?.byId ??
        nextData?.props?.pageProps?.initialReduxState?.ad?.byId ??
        {};
    const ids = Array.isArray(newestIds) && newestIds.length > 0 ? newestIds : Object.keys(byId);
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
    return { page, take, listings };
}
//# sourceMappingURL=kpPages.scraper.js.map