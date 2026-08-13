import { graphGet } from "../../lib/facebookGraph.js";
function getStringFromUnknown(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function getIdFromApifyItem(item) {
    const candidates = [
        item.id,
        item.listingId,
        item.listing_id,
        item.itemId,
        item.postId,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            return String(candidate);
        }
        const value = getStringFromUnknown(candidate);
        if (value)
            return value;
    }
    const fallbackUrl = getStringFromUnknown(item.url) || getStringFromUnknown(item.listingUrl);
    if (fallbackUrl)
        return fallbackUrl;
    return null;
}
function normalizeApifyMarketplaceItem(item) {
    const id = getIdFromApifyItem(item);
    const title = getStringFromUnknown(item.title) ||
        getStringFromUnknown(item.name) ||
        getStringFromUnknown(item.description);
    const url = getStringFromUnknown(item.url) ||
        getStringFromUnknown(item.listingUrl) ||
        getStringFromUnknown(item.permalink);
    if (!id || !title || !url)
        return null;
    const location = getStringFromUnknown(item.location) ||
        getStringFromUnknown(item.city) ||
        getStringFromUnknown(item.marketplaceRegion);
    const image = getStringFromUnknown(item.image) ||
        getStringFromUnknown(item.primaryListingPhotoUri) ||
        getStringFromUnknown(item.primaryPhoto);
    return {
        id,
        title,
        url,
        price: parsePrice(item.price),
        locationText: location,
        image,
        raw: item,
    };
}
async function scrapeFacebookMarketplaceViaApify(input) {
    const token = process.env.APIFY_TOKEN?.trim();
    const urls = (process.env.FB_MARKETPLACE_URLS || "")
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);
    if (!token || urls.length === 0) {
        return { listings: [] };
    }
    const actorId = process.env.FB_MARKETPLACE_APIFY_ACTOR_ID?.trim() ||
        "curious_coder/facebook-marketplace";
    const inputPayload = {
        urls,
        cookies: process.env.FB_MARKETPLACE_COOKIES || "",
        getListingDetails: false,
        getAllListingPhotos: false,
        strictFiltering: true,
        maxPagesPerUrl: Number(process.env.FB_MARKETPLACE_MAX_PAGES || 1),
    };
    const proxyCountry = process.env.FB_MARKETPLACE_PROXY_COUNTRY?.trim().toUpperCase() || "RS";
    if (proxyCountry) {
        inputPayload.proxy = { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: proxyCountry };
    }
    const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputPayload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[fb-marketplace] Apify ${response.status}: ${errorText || response.statusText}`);
    }
    const payload = (await response.json());
    const listings = payload
        .map(normalizeApifyMarketplaceItem)
        .filter((item) => item !== null)
        .slice(0, input.take);
    return { listings };
}
function normalizeMarketplaceItem(item) {
    const id = String(item.id || "").trim();
    const title = item.title?.trim();
    const url = item.url?.trim();
    if (!id || !title || !url)
        return null;
    return {
        id,
        title,
        url,
        price: parsePrice(item.price),
        locationText: item.location?.trim() || null,
        image: item.image?.trim() || null,
        raw: item.raw ?? item,
    };
}
function parsePrice(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return null;
    const normalized = value.replace(/\./g, "").replace(/,/g, ".");
    const match = normalized.match(/(\d+(?:\.\d+)?)/);
    if (!match)
        return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function extractImageFromPost(post) {
    const firstAttachment = post.attachments?.data?.[0];
    const src = firstAttachment?.media?.image?.src;
    if (typeof src === "string" && src.trim().length > 0)
        return src;
    const targetUrl = firstAttachment?.target?.url;
    if (typeof targetUrl === "string" && targetUrl.trim().length > 0)
        return targetUrl;
    const url = firstAttachment?.url;
    if (typeof url === "string" && url.trim().length > 0)
        return url;
    return null;
}
function normalizeGroupPost(groupId, post) {
    const title = post.message?.trim();
    const url = post.permalink_url?.trim();
    if (!title || !url)
        return null;
    return {
        id: post.id,
        title,
        url,
        price: parsePrice(post.message),
        locationText: post.place?.name?.trim() || null,
        image: extractImageFromPost(post),
        raw: {
            groupId,
            ...post,
            image: extractImageFromPost(post),
        },
    };
}
export async function scrapeFacebookGroupsLatest(input) {
    const groupIds = (process.env.FB_GROUP_IDS || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    if (groupIds.length === 0) {
        return { listings: [] };
    }
    const allListings = [];
    for (const groupId of groupIds) {
        try {
            const feed = await graphGet(`/${groupId}/feed`, {
                fields: "id,message,created_time,permalink_url,place{name},attachments{media,target,url}",
                limit: String(input.take),
            });
            const normalized = (feed.data || [])
                .map((post) => normalizeGroupPost(groupId, post))
                .filter((item) => item !== null);
            allListings.push(...normalized);
        }
        catch (error) {
            console.error("[fb-groups] scrape failed", { groupId, error });
        }
    }
    return { listings: allListings.slice(0, input.take) };
}
export async function scrapeFacebookMarketplaceLatest(input) {
    const apifyListings = await scrapeFacebookMarketplaceViaApify(input);
    if (apifyListings.listings.length > 0) {
        return apifyListings;
    }
    const endpoint = process.env.FB_MARKETPLACE_API_URL?.trim();
    if (!endpoint) {
        return { listings: [] };
    }
    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set("take", String(input.take));
    requestUrl.searchParams.set("country", "RS");
    const apiKey = process.env.FB_MARKETPLACE_API_KEY?.trim();
    const requestInit = {};
    if (apiKey) {
        requestInit.headers = { Authorization: `Bearer ${apiKey}` };
    }
    const response = await fetch(requestUrl, requestInit);
    if (!response.ok) {
        throw new Error(`[fb-marketplace] API ${response.status}: ${response.statusText}`);
    }
    const payload = (await response.json());
    const items = Array.isArray(payload)
        ? payload
        : payload.listings || payload.data || [];
    const listings = items
        .map(normalizeMarketplaceItem)
        .filter((item) => item !== null)
        .slice(0, input.take);
    return { listings };
}
//# sourceMappingURL=facebookSources.scraper.js.map