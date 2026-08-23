import type { MarketCurrency } from "@/domain/markets/types";
import { parseCheckoutCartInput } from "./input-schema";
import { repriceCart, type RepriceCartOptions } from "./reprice-cart";
import type { RepricedCheckoutCart } from "./types";

export type MarketSwitchUrgentIssue = Readonly<{
  clientItemId: string;
  productTitle: string;
  neededDate: string;
  urgentWorkingDays: number;
  urgentFeeInclGstCents: number;
  currency: MarketCurrency;
}>;

export type MarketSwitchPreflightResult =
  | Readonly<{ result: "ready"; cart: RepricedCheckoutCart }>
  | Readonly<{
      result: "urgent_confirmation_required";
      issues: readonly MarketSwitchUrgentIssue[];
    }>;

export function preflightMarketSwitch(
  value: unknown,
  options: RepriceCartOptions,
): MarketSwitchPreflightResult {
  const input = parseCheckoutCartInput(value);
  const assumedConfirmed = {
    version: 1 as const,
    items: input.items.map((item) => ({ ...item, urgentServiceConfirmed: true })),
  };
  const preview = repriceCart(assumedConfirmed, options);
  const originalById = new Map(input.items.map((item) => [item.clientItemId, item]));
  const issues = preview.items
    .filter((item) => (
      originalById.get(item.clientItemId)?.urgentServiceConfirmed !== true &&
      item.urgentService.feeInclGstCents > 0
    ))
    .map((item) => Object.freeze({
      clientItemId: item.clientItemId,
      productTitle: item.productTitle,
      neededDate: item.neededDate,
      urgentWorkingDays: item.urgentService.workingDays,
      urgentFeeInclGstCents: item.urgentService.feeInclGstCents,
      currency: preview.currency,
    }));
  return issues.length > 0
    ? Object.freeze({
        result: "urgent_confirmation_required" as const,
        issues: Object.freeze(issues),
      })
    : Object.freeze({ result: "ready" as const, cart: repriceCart(value, options) });
}
