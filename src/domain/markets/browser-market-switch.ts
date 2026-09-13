import type { Market, MarketCurrency } from "./types";

export type MarketRoutePayload =
  | Readonly<{ market: Market; currency: MarketCurrency }>
  | Readonly<{ error: string; code: string }>;

// A country preference must never send configured items through repricing.
export async function requestMarketSwitch({
  market,
  persistPreference,
}: Readonly<{
  market: Market;
  persistPreference: boolean;
}>) {
  const response = await fetch("/api/market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market, persistPreference }),
  });
  const payload = await response.json() as MarketRoutePayload;
  return { ok: response.ok, payload };
}
