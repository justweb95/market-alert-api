import { chromium } from 'patchright';
const NAV_TIMEOUT_MS = 30_000;
const ARTICLE_WAIT_MS = 15_000;
// KupujemProdajem prestao je da vraca stvarne oglase plain axios/cheerio zahtevima
// (2026-08-15: __NEXT_DATA__ i dalje postoji, ali props.pageProps je prazan objekat
// — server prepoznaje ne-browser klijenta i vraca "prazan" SSR shell umesto pravog
// sadrzaja; potvrdjeno da isti URL sa pravim Chromium-om vraca pun HTML sa
// oglasima). Isti obrazac kao PA Cloudflare blokada — resenje je isto: pravi headed
// Chromium (Patchright) umesto axios-a. Posebna browser instanca od PA-a da izbegnemo
// deljeno stanje/kontenciju izmedju dva izvora koja se skrejpuju u istom ciklusu.
//
// 2026-08-15 (drugi nalaz istog dana): i pravi headed Chromium je i dalje vracao
// KP-ov "Uskoro cemo ponovo biti dostupni" ekran sa produkcione IP adrese — ovo NIJE
// JS/fingerprint izazov (koji Patchright resava za PA), vec IP-nivo blokada samog
// Lightsail servera. Potvrdjeno: identican kod sa korisnikove lokalne IP radi
// besprekorno. Zato postoji KP_PROXY_SERVER — kad je podesen, sav KP saobracaj ide
// kroz taj proxy umesto direktno sa server IP-a. Namerno env var (ne hardkodovano)
// jer je trenutni proxy besplatan/javan servis bez SLA — moze prestati da radi bilo
// kad, treba moci da se zameni/ugasi bez novog deploy-a.
let browserPromise = null;
let contextPromise = null;
async function getContext() {
    if (!contextPromise) {
        contextPromise = (async () => {
            if (!browserPromise) {
                const proxyServer = process.env.KP_PROXY_SERVER;
                browserPromise = chromium.launch({
                    headless: false,
                    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
                });
            }
            const browser = await browserPromise;
            return browser.newContext();
        })();
    }
    return contextPromise;
}
export function resetKpBrowserContext() {
    const prev = contextPromise;
    contextPromise = null;
    if (prev) {
        prev.then((ctx) => ctx.close()).catch(() => { });
    }
}
async function fetchKpHtmlInner(targetUrl) {
    const context = await getContext();
    const page = await context.newPage();
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        // Oglasi se renderuju server-side ali samo za "pravi" browser zahtev — sacekaj
        // bar jednu karticu pre citanja sadrzaja.
        await page.waitForSelector('article[class*="adHolder"]', { timeout: ARTICLE_WAIT_MS }).catch(() => { });
        return await page.content();
    }
    finally {
        await page.close();
    }
}
export async function fetchKpHtml(targetUrl) {
    try {
        const html = await fetchKpHtmlInner(targetUrl);
        if (!/adHolder/i.test(html)) {
            // Jedan retry na svezoj stranici — isti obrazac kao PA servis, ume da se desi
            // da prvi load stigne pre nego sto se sadrzaj hidrira.
            return await fetchKpHtmlInner(targetUrl);
        }
        return html;
    }
    catch (err) {
        resetKpBrowserContext();
        throw err;
    }
}
// 2026-08-20: kada sam Chromium proces zaglavi (ne baci gresku, samo nikad ne
// odgovori), zatvaranje samo konteksta ne pomaze — sledeci `browser.newContext()`
// visi na istom mrtvom procesu i poison-uje svaki naredni ciklus. Ovo baca i
// kesirani browser, pa sledeci ciklus podize potpuno nov Chromium. Zatvaranje ide
// fire-and-forget jer i sam close() ume da visi na zaglavljenom procesu.
export function killKpBrowser() {
    const prevContext = contextPromise;
    const prevBrowser = browserPromise;
    contextPromise = null;
    browserPromise = null;
    if (prevContext)
        prevContext.then((ctx) => ctx.close()).catch(() => { });
    if (prevBrowser)
        prevBrowser.then((b) => b.close()).catch(() => { });
}
//# sourceMappingURL=kpBrowser.service.js.map