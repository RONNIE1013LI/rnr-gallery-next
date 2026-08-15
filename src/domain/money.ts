import { InvalidPricingInputError } from "./pricing/types";

export function formatNzd(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new InvalidPricingInputError("Money must be stored as integer cents.");
  }

  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    currencyDisplay: "narrowSymbol",
  }).format(cents / 100);
}

export function addNzdGst(exGstCents: number): number {
  if (!Number.isSafeInteger(exGstCents) || exGstCents < 0) {
    throw new InvalidPricingInputError("Money must be stored as non-negative integer cents.");
  }
  return Math.round((exGstCents * 115) / 100);
}

export function formatNzdExplicit(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new InvalidPricingInputError("Money must be stored as integer cents.");
  }
  return `NZ$${new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)}`;
}
