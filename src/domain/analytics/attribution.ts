import type { AdvertisingConsent } from "@/domain/consent/advertising-consent";

export const ATTRIBUTION_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
] as const;

export type AttributionField = typeof ATTRIBUTION_FIELDS[number];
export type OrderAttribution = Readonly<Partial<Record<AttributionField, string>>>;
export type StoredOrderAttribution = OrderAttribution & Readonly<{
  measurement?: Readonly<{
    version: 1;
    advertisingConsent: boolean;
    decidedAt: string;
    fbp?: string;
    fbc?: string;
  }>;
}>;

const PREFIX = "rnr:analytics:v1";
const MAX_VALUE_LENGTH = 200;
const META_COOKIE_PATTERN = /^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,200}$/;

export function buildStoredOrderAttribution(
  attribution: OrderAttribution | null,
  consent: AdvertisingConsent | null,
  identifiers: Readonly<{ fbp?: string; fbc?: string }>,
): StoredOrderAttribution | null {
  const { fbclid, ...nonMetaCampaign } = attribution ?? {};
  const campaign = consent?.advertising && fbclid
    ? { ...nonMetaCampaign, fbclid }
    : nonMetaCampaign;
  if (!consent) {
    return Object.keys(campaign).length ? Object.freeze(campaign) : null;
  }
  const measurement = {
    version: 1 as const,
    advertisingConsent: consent.advertising,
    decidedAt: consent.decidedAt,
    ...(consent.advertising && identifiers.fbp && META_COOKIE_PATTERN.test(identifiers.fbp)
      ? { fbp: identifiers.fbp }
      : {}),
    ...(consent.advertising && identifiers.fbc && META_COOKIE_PATTERN.test(identifiers.fbc)
      ? { fbc: identifiers.fbc }
      : {}),
  };
  return Object.freeze({ ...campaign, measurement: Object.freeze(measurement) });
}

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

export type AttributionHandoffResult = "empty" | "invalid" | "kept_existing" | "transferred";

export function handoffGuestAttribution(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  customerId: string,
): AttributionHandoffResult {
  const stableCustomerId = customerId.trim();
  if (!stableCustomerId) throw new Error("Authenticated customer ID is required");
  const guestKey = getAttributionStorageKey(null);
  const rawGuest = storage.getItem(guestKey);
  if (rawGuest === null) return "empty";

  let guest: unknown;
  try {
    guest = JSON.parse(rawGuest);
  } catch {
    storage.removeItem(guestKey);
    return "invalid";
  }
  if (!isOrderAttribution(guest)) {
    storage.removeItem(guestKey);
    return "invalid";
  }

  const existing = readAttribution(storage, stableCustomerId);
  storage.removeItem(guestKey);
  if (existing) return "kept_existing";
  saveAttribution(storage, stableCustomerId, guest);
  return "transferred";
}
