import type { Market } from "@/domain/markets/types";

export function expressCheckoutConfigured(market: Market, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const enabled = market === "AU" ? env.EXPRESS_CHECKOUT_AU : env.EXPRESS_CHECKOUT_NZ;
  return enabled === "true" && (env.VERCEL !== "1" || Boolean(env.EXPRESS_CHECKOUT_GLOBAL_CONFIG));
}

export async function expressCheckoutAvailable(market: Market, env: Readonly<Record<string, string | undefined>> = process.env): Promise<boolean> {
  if (!expressCheckoutConfigured(market, env)) return false;
  if (!env.EXPRESS_CHECKOUT_GLOBAL_CONFIG) return true;
  try {
    const url = new URL(env.EXPRESS_CHECKOUT_GLOBAL_CONFIG);
    const token = url.searchParams.get("token");
    if (url.origin !== "https://global-config.vercel.com" || url.username || url.password ||
        !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) || !token) return false;
    url.pathname += "/item/express_checkout";
    url.search = "";
    url.hash = "";
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(400),
    });
    if (!response.ok) return false;
    const flags: unknown = await response.json();
    return typeof flags === "object" && flags !== null &&
      (flags as Partial<Record<Market, unknown>>)[market] === true;
  } catch {
    return false;
  }
}
