import type {
  Market,
  MarketCountry,
  MarketCurrency,
  MarketTaxPolicy,
  TaxInclusiveAmount,
} from "./types";

const NZ_TAX_RATE_BASIS_POINTS = 1_500;
const DEFAULT_AU_TAX_RATE_BASIS_POINTS = 1_000;
const MAX_TAX_RATE_BASIS_POINTS = 10_000;

export class InvalidMarketValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMarketValueError";
  }
}

function assertRateBasisPoints(rateBasisPoints: number): void {
  if (
    !Number.isSafeInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > MAX_TAX_RATE_BASIS_POINTS
  ) {
    throw new InvalidMarketValueError(
      "Tax rate must be safe integer basis points between 0 and 10000.",
    );
  }
}

export function marketForCountry(country: MarketCountry): Market {
  if (country === "NZ" || country === "AU") return country;
  throw new InvalidMarketValueError("The shipping country is unsupported.");
}

export function currencyForMarket(market: Market): MarketCurrency {
  if (market === "NZ") return "NZD";
  if (market === "AU") return "AUD";
  throw new InvalidMarketValueError("The market is unsupported.");
}

export function marketTaxPolicy(
  market: Market,
  australia: Readonly<{
    registered: boolean;
    rateBasisPoints: number;
  }> = {
    registered: false,
    rateBasisPoints: DEFAULT_AU_TAX_RATE_BASIS_POINTS,
  },
): MarketTaxPolicy {
  if (market === "NZ") {
    return Object.freeze({
      jurisdiction: "NZ_GST" as const,
      registered: true,
      rateBasisPoints: NZ_TAX_RATE_BASIS_POINTS,
    });
  }
  if (market !== "AU") {
    throw new InvalidMarketValueError("The market is unsupported.");
  }
  assertRateBasisPoints(australia.rateBasisPoints);
  return Object.freeze({
    jurisdiction: australia.registered ? "AU_GST" as const : "NONE" as const,
    registered: australia.registered,
    rateBasisPoints: australia.rateBasisPoints,
  });
}

export function includedTaxFromGross(
  amountInclTaxCents: number,
  policy: MarketTaxPolicy,
): TaxInclusiveAmount {
  if (!Number.isSafeInteger(amountInclTaxCents) || amountInclTaxCents < 0) {
    throw new InvalidMarketValueError(
      "Amount must use non-negative safe integer cents.",
    );
  }
  assertRateBasisPoints(policy.rateBasisPoints);
  if (!policy.registered || policy.rateBasisPoints === 0) {
    return Object.freeze({
      amountExTaxCents: amountInclTaxCents,
      taxCents: 0,
      amountInclTaxCents,
    });
  }

  const amountExTaxCents = Math.round(
    (amountInclTaxCents * 10_000) / (10_000 + policy.rateBasisPoints),
  );
  return Object.freeze({
    amountExTaxCents,
    taxCents: amountInclTaxCents - amountExTaxCents,
    amountInclTaxCents,
  });
}
