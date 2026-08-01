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
