export function getAdIdFromUrl(url: string): string {
  const m = url.match(/\/oglas\/(\d+)/);
  return m?.[1] ?? '';
}

export function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

export function toPostedAt(postedRaw: string): string {
  // "2026-02-14 22:38:40" -> "2026-02-14T22:38:40"
  return postedRaw ? postedRaw.replace(' ', 'T') : '';
}
