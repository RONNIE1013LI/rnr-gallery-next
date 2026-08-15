export const ATTRIBUTION_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
] as const;

export type AttributionField = typeof ATTRIBUTION_FIELDS[number];
export type OrderAttribution = Readonly<Partial<Record<AttributionField, string>>>;

const PREFIX = "rnr:analytics:v1";
const MAX_VALUE_LENGTH = 200;

function namespace(customerId: string | null) {
  return customerId === null ? "guest" : `user:${encodeURIComponent(customerId)}`;
}

export function getAttributionStorageKey(customerId: string | null) {
  return `${PREFIX}:${namespace(customerId)}:attribution`;
}

export function parseAttribution(params: Pick<URLSearchParams, "get">): OrderAttribution | null {
  const attribution: Partial<Record<AttributionField, string>> = {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = params.get(field)?.trim();
    if (value && value.length <= MAX_VALUE_LENGTH) attribution[field] = value;
  }
  return Object.keys(attribution).length > 0 ? Object.freeze(attribution) : null;
}

export function isOrderAttribution(value: unknown): value is OrderAttribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([field, fieldValue]) =>
    ATTRIBUTION_FIELDS.includes(field as AttributionField) &&
    typeof fieldValue === "string" && fieldValue.length > 0 && fieldValue.length <= MAX_VALUE_LENGTH,
  );
}

export function saveAttribution(storage: Pick<Storage, "setItem">, customerId: string | null, attribution: OrderAttribution) {
  if (!isOrderAttribution(attribution)) return;
  storage.setItem(getAttributionStorageKey(customerId), JSON.stringify(attribution));
}

export function readAttribution(storage: Pick<Storage, "getItem">, customerId: string | null): OrderAttribution | null {
  try {
    const value = JSON.parse(storage.getItem(getAttributionStorageKey(customerId)) ?? "null");
    return isOrderAttribution(value) ? Object.freeze(value) : null;
  } catch {
    return null;
  }
}

export function clearAttribution(storage: Pick<Storage, "removeItem">, customerId: string | null) {
  storage.removeItem(getAttributionStorageKey(customerId));
}
