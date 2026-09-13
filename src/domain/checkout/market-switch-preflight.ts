import type { MarketCurrency } from "@/domain/markets/types";
import { parseCheckoutCartInput } from "./input-schema";
import { repriceCart, type RepriceCartOptions } from "./reprice-cart";
import { InvalidCheckoutCartError, type RepricedCheckoutCart } from "./types";

const urgentConfirmationMessage = "Urgent service must be confirmed.";

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

function isUrgentConfirmationRequired(error: unknown): boolean {
  return error instanceof InvalidCheckoutCartError && error.message === urgentConfirmationMessage;
}

export function preflightMarketSwitch(
  value: unknown,
  options: RepriceCartOptions,
): MarketSwitchPreflightResult {
  const input = parseCheckoutCartInput(value);
  try {
    return Object.freeze({ result: "ready" as const, cart: repriceCart(value, options) });
  } catch (error) {
    if (!isUrgentConfirmationRequired(error)) throw error;
  }

  const issues = input.items.flatMap((item) => {
    const oneItemCart = { version: 1 as const, items: [item] };
    try {
      repriceCart(oneItemCart, options);
      return [];
    } catch (error) {
      if (!isUrgentConfirmationRequired(error)) throw error;
    }

    const preview = repriceCart({
      version: 1 as const,
      items: [{ ...item, urgentServiceConfirmed: true }],
    }, options);
    const repricedItem = preview.items[0];
    return [Object.freeze({
      clientItemId: repricedItem.clientItemId,
      productTitle: repricedItem.productTitle,
      neededDate: repricedItem.neededDate,
      urgentWorkingDays: repricedItem.urgentService.workingDays,
      urgentFeeInclGstCents: repricedItem.urgentService.feeInclGstCents,
      currency: preview.currency,
    })];
  });

  return Object.freeze({
    result: "urgent_confirmation_required" as const,
    issues: Object.freeze(issues),
  });
}
