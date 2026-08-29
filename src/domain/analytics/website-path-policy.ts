const PRIVATE_PATH_PREFIXES = [
  "/account",
  "/admin",
  "/api",
  "/checkout",
  "/feeds",
  "/forms",
  "/gallery-images",
  "/notification-email",
  "/order-system",
  "/orders",
  "/pay",
  "/payment-requests",
  "/reply-assistant",
  "/review-media",
] as const;

const STATIC_PATH_PREFIXES = ["/_next", "/media"] as const;
const STATIC_FILENAMES = new Set(["/favicon.ico", "/robots.txt", "/sitemap.xml"]);
const STATIC_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|webp|woff2?|xml)$/i;

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function normalizeWebsitePathname(input: unknown): string | null {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//")) {
    return null;
  }
  try {
    const pathname = new URL(input, "https://rrgallery.invalid").pathname;
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    return normalized.length >= 1 && normalized.length <= 512 ? normalized : null;
  } catch {
    return null;
  }
}

export function isTrackableWebsitePath(input: unknown): boolean {
  const pathname = normalizeWebsitePathname(input);
  if (!pathname) return false;
  if (STATIC_FILENAMES.has(pathname) || STATIC_EXTENSION.test(pathname)) return false;
  if (PRIVATE_PATH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) return false;
  return !STATIC_PATH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}
