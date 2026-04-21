import { graphGet } from "../../lib/facebookGraph.js";

type NormalizedFacebookListing = {
  id: string;
  title: string;
  url: string;
  price: number | null;
  locationText: string | null;
  image: string | null;
  raw: unknown;
};

type FacebookGraphPost = {
  id: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
  place?: { name?: string };
  attachments?: {
    data?: Array<{
      media?: { image?: { src?: string } };
      target?: { url?: string };
      url?: string;
    }>;
  };
};

type GraphFeedResponse = {
  data?: FacebookGraphPost[];
};

type MarketplaceApiItem = {
  id: string | number;
  title?: string;
  url?: string;
  price?: number | string | null;
  location?: string | null;
  image?: string | null;
  raw?: unknown;
};

type MarketplaceApiResponse = {
  data?: MarketplaceApiItem[];
  listings?: MarketplaceApiItem[];
};

function normalizeMarketplaceItem(
  item: MarketplaceApiItem,
): NormalizedFacebookListing | null {
  const id = String(item.id || "").trim();
  const title = item.title?.trim();
  const url = item.url?.trim();

  if (!id || !title || !url) return null;

  return {
    id,
    title,
    url,
    price: parsePrice(item.price),
    locationText: item.location?.trim() || null,
    image: item.image?.trim() || null,
    raw: item.raw ?? (item as unknown),
  };
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const normalized = value.replace(/\./g, "").replace(/,/g, ".");
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractImageFromPost(post: FacebookGraphPost): string | null {
  const firstAttachment = post.attachments?.data?.[0];
  const src = firstAttachment?.media?.image?.src;
  if (typeof src === "string" && src.trim().length > 0) return src;

  const targetUrl = firstAttachment?.target?.url;
  if (typeof targetUrl === "string" && targetUrl.trim().length > 0) return targetUrl;

  const url = firstAttachment?.url;
  if (typeof url === "string" && url.trim().length > 0) return url;

  return null;
}

function normalizeGroupPost(groupId: string, post: FacebookGraphPost): NormalizedFacebookListing | null {
  const title = post.message?.trim();
  const url = post.permalink_url?.trim();

  if (!title || !url) return null;

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

export async function scrapeFacebookGroupsLatest(input: {
  take: number;
}): Promise<{ listings: NormalizedFacebookListing[] }> {
  const groupIds = (process.env.FB_GROUP_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (groupIds.length === 0) {
    return { listings: [] };
  }

  const allListings: NormalizedFacebookListing[] = [];

  for (const groupId of groupIds) {
    try {
      const feed = await graphGet<GraphFeedResponse>(`/${groupId}/feed`, {
        fields:
          "id,message,created_time,permalink_url,place{name},attachments{media,target,url}",
        limit: String(input.take),
      });

      const normalized = (feed.data || [])
        .map((post) => normalizeGroupPost(groupId, post))
        .filter((item): item is NormalizedFacebookListing => item !== null);

      allListings.push(...normalized);
    } catch (error) {
      console.error("[fb-groups] scrape failed", { groupId, error });
    }
  }

  return { listings: allListings.slice(0, input.take) };
}

export async function scrapeFacebookMarketplaceLatest(input: {
  take: number;
}): Promise<{ listings: NormalizedFacebookListing[] }> {
  const endpoint = process.env.FB_MARKETPLACE_API_URL?.trim();
  if (!endpoint) {
    return { listings: [] };
  }

  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set("take", String(input.take));

  const apiKey = process.env.FB_MARKETPLACE_API_KEY?.trim();
  const requestInit: RequestInit = {};
  if (apiKey) {
    requestInit.headers = { Authorization: `Bearer ${apiKey}` };
  }

  const response = await fetch(requestUrl, requestInit);

  if (!response.ok) {
    throw new Error(`[fb-marketplace] API ${response.status}: ${response.statusText}`);
  }

  const payload = (await response.json()) as MarketplaceApiResponse | MarketplaceApiItem[];
  const items = Array.isArray(payload)
    ? payload
    : payload.listings || payload.data || [];

  const listings: NormalizedFacebookListing[] = items
    .map(normalizeMarketplaceItem)
    .filter((item): item is NormalizedFacebookListing => item !== null)
    .slice(0, input.take);

  return { listings };
}
