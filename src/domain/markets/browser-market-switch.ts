import { cartToCheckoutInput } from "@/domain/cart/checkout-input";
import type { Cart } from "@/domain/cart/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { MarketSwitchUrgentIssue } from "@/domain/checkout/market-switch-preflight";
import type { Market, MarketCurrency } from "./types";

export type MarketRoutePayload =
  | Readonly<{
      market: Market;
      currency: MarketCurrency;
      cart?: RepricedCheckoutCart;
    }>
  | Readonly<{
      error: string;
      code:
        | "unsupported_market"
        | "market_unavailable"
        | "urgent_confirmation_required"
        | "invalid_cart"
        | "market_switch_failed";
      issues?: readonly MarketSwitchUrgentIssue[];
    }>;

export async function requestMarketSwitch({
  market,
  candidateCart,
  persistPreference,
}: Readonly<{
  market: Market;
  candidateCart: Cart;
  persistPreference: boolean;
}>) {
  const response = await fetch("/api/market", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      market,
      persistPreference,
      ...(candidateCart.items.length > 0
        ? { cart: cartToCheckoutInput(candidateCart) }
        : {}),
    }),
  });
  const payload = await response.json() as MarketRoutePayload;
  if (!response.ok) return { ok: false as const, payload };
  if (candidateCart.items.length > 0 && !("cart" in payload && payload.cart)) {
    return {
      ok: false as const,
      payload: {
        error: "The repriced cart was missing.",
        code: "market_switch_failed" as const,
      },
    };
  }
  return { ok: true as const, payload };
}
