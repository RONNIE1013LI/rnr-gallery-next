import { repriceCart, type RepriceCartOptions } from "./reprice-cart";
import { type RepricedCheckoutCart } from "./types";

export type MarketSwitchPreflightResult = Readonly<{ result: "ready"; cart: RepricedCheckoutCart }>;

export function preflightMarketSwitch(
  value: unknown,
  options: RepriceCartOptions,
): MarketSwitchPreflightResult {
  return Object.freeze({ result: "ready" as const, cart: repriceCart(value, options) });
}
