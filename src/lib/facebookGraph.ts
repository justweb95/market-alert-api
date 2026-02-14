import "dotenv/config";

const version = process.env.FB_GRAPH_VERSION ?? "v20.0";
const baseUrl = `https://graph.facebook.com/${version}`;

export async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const token = process.env.FB_ACCESS_TOKEN;
  
  if (!token) throw new Error("Facebook access token is not set in environment variables");

  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Facebook Graph API error: ${data.error?.message || response.statusText}`);
  }

  return data;
}