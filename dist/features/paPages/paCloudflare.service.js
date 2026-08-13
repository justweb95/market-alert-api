import { chromium } from 'patchright';
const CHALLENGE_WAIT_MS = 20_000;
const NAV_TIMEOUT_MS = 30_000;
let browserPromise = null;
let contextPromise = null;
async function getContext() {
    if (!contextPromise) {
        contextPromise = (async () => {
            if (!browserPromise) {
                // headless: true gets stuck on PA's Cloudflare managed challenge
                // indefinitely (verified: 20s+ stuck on "Just a moment..."), even
                // with Patchright's anti-detection patches. headless: false passes
                // reliably (verified on both Windows and native Linux). On a server
                // with no real display this needs a virtual one - `npm run start`
                // wraps the process with `xvfb-run`; the host needs the `xvfb`
                // apt package installed.
                browserPromise = chromium.launch({ headless: false });
            }
            const browser = await browserPromise;
            return browser.newContext();
        })();
    }
    return contextPromise;
}
export function resetPaBrowserContext() {
    const prev = contextPromise;
    contextPromise = null;
    if (prev) {
        prev.then((ctx) => ctx.close()).catch(() => { });
    }
}
async function fetchPaHtmlInner(targetUrl) {
    const context = await getContext();
    const page = await context.newPage();
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        const deadline = Date.now() + CHALLENGE_WAIT_MS;
        while (Date.now() < deadline && /just a moment/i.test(await page.title())) {
            await page.waitForTimeout(1000);
        }
        if (/just a moment/i.test(await page.title())) {
            throw new Error('Cloudflare challenge did not resolve in time');
        }
        // Listing pages hydrate their <article> cards client-side after the
        // initial HTML lands, so wait for at least one before reading content.
        await page.waitForSelector('article', { timeout: 15_000 }).catch(() => { });
        return await page.content();
    }
    finally {
        await page.close();
    }
}
export async function fetchPaHtml(targetUrl) {
    try {
        const html = await fetchPaHtmlInner(targetUrl);
        // The listing grid occasionally comes back empty on the first load
        // (observed even after the CF challenge cleared) - one retry on a
        // fresh page is enough to get real content back.
        if (!/<article/i.test(html)) {
            return await fetchPaHtmlInner(targetUrl);
        }
        return html;
    }
    catch (err) {
        resetPaBrowserContext();
        throw err;
    }
}
//# sourceMappingURL=paCloudflare.service.js.map