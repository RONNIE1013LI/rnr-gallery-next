import { InvalidPricingInputError } from "./pricing/types";
import type { MarketCurrency } from "./markets/types";

export function formatMarketMoney(
  cents: number,
  currency: MarketCurrency,
): string {
  if (!Number.isSafeInteger(cents)) {
    throw new InvalidPricingInputError("Money must be stored as integer cents.");
  }

  const amount = new Intl.NumberFormat(currency === "NZD" ? "en-NZ" : "en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return currency === "NZD" ? `NZ$${amount}` : `A$${amount} AUD`;
}

export function formatNzd(cents: number): string {
  return formatMarketMoney(cents, "NZD");
}

export function addNzdGst(exGstCents: number): number {
  if (!Number.isSafeInteger(exGstCents) || exGstCents < 0) {
    throw new InvalidPricingInputError("Money must be stored as non-negative integer cents.");
  }
  return Math.round((exGstCents * 115) / 100);
}

export function formatNzdExplicit(cents: number): string {
  return formatNzd(cents);
}
