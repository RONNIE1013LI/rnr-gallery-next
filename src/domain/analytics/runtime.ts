export const GA4_MEASUREMENT_ID = "G-RE5Z5B58TJ";
export const GA4_DEBUG_SESSION_KEY = "rnr:analytics:v1:debug";
export const GA4_DISABLE_WINDOW_KEY = `ga-disable-${GA4_MEASUREMENT_ID}`;
export const GA4_SAFE_PURCHASE_PATH = "/";
export const GA4_SAFE_CHECKOUT_PATH = "/checkout";

export type Ga4LocationPolicy = "public" | "private" | "private-checkout" | "private-order";

const PRIVATE_PATH_PREFIXES = [
  "/account",
  "/admin",
  "/checkout",
  "/forms",
  "/order-system",
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

export function isGa4Production(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}
