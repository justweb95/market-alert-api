const DEFAULT_RSD_TO_EUR_RATE = 117;

export type CurrencyCode = "EUR" | "RSD";

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function detectCurrencyFromText(value: string): CurrencyCode | null {
  const normalized = normalizeText(value);

  if (/(^|\W)(eur|€)(\W|$)/i.test(value) || /(^|\W)evr(a|o)?(\W|$)/.test(normalized)) {
    return "EUR";
  }

  if (/(^|\W)(rsd|din|dinar|dinara)(\W|$)/.test(normalized)) {
    return "RSD";
  }

  return null;
}

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const compact = value.replace(/\u00a0/g, " ").trim();
  if (!compact) return null;

  const match = compact.match(/\d{1,3}(?:[\.\s,]\d{3})+|\d+(?:[\.,]\d+)?/);
  if (!match) return null;

  const token = match[0];
  const normalized = token
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toEur(amount: number, currency: CurrencyCode | null): number {
  if (currency === "RSD") {
    return amount / DEFAULT_RSD_TO_EUR_RATE;
  }

  return amount;
}

export function normalizePriceToEur(input: {
  amount: unknown;
  explicitCurrency?: CurrencyCode | null;
  hints?: Array<string | null | undefined>;
}): number | null {
  const amount = parseAmount(input.amount);
  if (amount === null) return null;

  const currency =
    input.explicitCurrency ??
    input.hints?.map((hint) => detectCurrencyFromText(hint ?? "")).find(Boolean) ??
    null;

  const eur = toEur(amount, currency);
  return Number.isFinite(eur) ? Number(eur.toFixed(2)) : null;
}
