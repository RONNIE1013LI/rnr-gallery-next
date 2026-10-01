export type FlikEligibilityOrder = Readonly<{
  market: string | null | undefined;
  currency: string | null | undefined;
  amountCents: number;
  billingCountry?: string | null;
  deliveryCountry?: string | null;
}>;

export type FlikEligibilityResult =
  | Readonly<{ available: true }>
  | Readonly<{ available: false; reason: "configuration" | "country" | "currency" | "amount" }>;

// This pure rule is shared with Checkout. Server callers must supply stored order data.
export function flikEligibility(
  order: FlikEligibilityOrder,
  availability: Readonly<{ enabled: boolean; configured: boolean }>,
): FlikEligibilityResult {
  if (!availability.enabled || !availability.configured) return { available: false, reason: "configuration" };
  if (order.market !== "NZ" || order.billingCountry !== "NZ" || order.deliveryCountry !== "NZ") {
    return { available: false, reason: "country" };
  }
  if (order.currency !== "NZD") return { available: false, reason: "currency" };
  if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0 || order.amountCents > 1_000_000) {
    return { available: false, reason: "amount" };
  }
  return { available: true };
}
