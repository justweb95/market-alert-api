import "dotenv/config";

const version = process.env.FB_GRAPH_VERSION ?? "v20.0";
const baseUrl = `https://graph.facebook.com/${version}`;

type GraphErrorPayload = {
  error?: {
    message?: string;
  };
};

export async function graphGet<T = unknown>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const token = process.env.FB_ACCESS_TOKEN;
  
  if (!token) throw new Error("Facebook access token is not set in environment variables");

  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    const errorData = data as GraphErrorPayload;
    throw new Error(
      `Facebook Graph API error: ${errorData.error?.message || response.statusText}`,
    );
  }

  return data as T;
}