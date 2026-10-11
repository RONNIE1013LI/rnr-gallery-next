export const GA4_MEASUREMENT_ID = "G-RE5Z5B58TJ";
export const GOOGLE_ADS_TAG_ID = "AW-592203244";
export const GOOGLE_ADS_PURCHASE_SEND_TO = "AW-592203244/HtL7CMq6qu0bEOybsZoC";
export const META_PIXEL_ID = "608163224977716";
export const GA4_DEBUG_SESSION_KEY = "rnr:analytics:v1:debug";
export const GA4_DISABLE_WINDOW_KEY = `ga-disable-${GA4_MEASUREMENT_ID}`;
export const GA4_SAFE_PURCHASE_PATH = "/";
export const GA4_SAFE_CHECKOUT_PATH = "/checkout";

export function googleTagCommand(...values: unknown[]): IArguments {
  void values;
  // Google Tag consumes the native arguments object produced by window.gtag.
  // eslint-disable-next-line prefer-rest-params
  return arguments;
}

export type Ga4LocationPolicy = "public" | "private" | "private-checkout" | "private-order";

const PRIVATE_PATH_PREFIXES = [
  "/account",
  "/admin",
  "/checkout",
  "/forms",
  "/notification-email",
  "/order-system",
  "/pay",
] as const;

const SENSITIVE_QUERY_KEY = /(?:^|_)(?:access|address|auth|checkout|client_secret|code|email|expires|order|payment|phone|postcode|provider|recipient|secret|session|signature|state|token)(?:_|$)/i;

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_");
  return SENSITIVE_QUERY_KEY.test(normalized);
}

export function classifyGa4Location(
  pathname: string,
  searchParams: URLSearchParams,
): Ga4LocationPolicy {
  if (pathMatchesPrefix(pathname, "/orders")) return "private-order";
  if (pathMatchesPrefix(pathname, "/checkout")) return "private-checkout";
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix))) {
    return "private";
  }
  if ([...searchParams.keys()].some(isSensitiveQueryKey)) {
    return "private";
  }
  return "public";
}

const GA4_CAMPAIGN_PARAMETERS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term",
  "utm_content", "utm_source_platform",
] as const;
const GOOGLE_CLICK_PARAMETERS = ["gclid", "gbraid", "wbraid"] as const;
const GA4_PAGE_LOCATION_MAX_LENGTH = 1000;

export function safeGa4PageLocation(url: URL, advertisingAllowed: boolean): string {
  const policy = classifyGa4Location(url.pathname, url.searchParams);
  const pathname = policy === "public" ? url.pathname
    : policy === "private-checkout" ? GA4_SAFE_CHECKOUT_PATH : GA4_SAFE_PURCHASE_PATH;
  const safe = new URL(pathname, url.origin);
  if (safe.href.length > GA4_PAGE_LOCATION_MAX_LENGTH) safe.pathname = "/";
  if (policy !== "public") return safe.href;

  // Preserve attribution without forwarding arbitrary query values or fragments.
  const parameters: readonly string[] = advertisingAllowed
    ? [...GA4_CAMPAIGN_PARAMETERS, ...GOOGLE_CLICK_PARAMETERS]
    : GA4_CAMPAIGN_PARAMETERS;
  for (const key of parameters) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) continue;
    const value = values[0].trim();
    const pattern = key.startsWith("utm_")
      ? /^[\p{L}\p{N} _.,'()+|&-]+$/u
      : /^[A-Za-z0-9_-]+$/;
    if (value.length > 0 && value.length <= 200 && pattern.test(value)) {
      safe.searchParams.set(key, value);
    }
  }
  // Drop whole lower-priority values rather than truncate a campaign or click ID.
  for (const key of [
    ...[...GA4_CAMPAIGN_PARAMETERS].reverse(), ...[...GOOGLE_CLICK_PARAMETERS].reverse(),
  ]) {
    if (safe.href.length <= GA4_PAGE_LOCATION_MAX_LENGTH) break;
    safe.searchParams.delete(key);
  }
  return safe.href;
}

export function isGa4Production(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
