import type { SupportedCountry } from "@/domain/address/types";

export const MARKETS = ["NZ", "AU"] as const;
export const MARKET_CURRENCIES = ["NZD", "AUD"] as const;

export type Market = (typeof MARKETS)[number];
export type MarketCurrency = (typeof MARKET_CURRENCIES)[number];
export type MarketCountry = SupportedCountry;
export type TaxJurisdiction = "NZ_GST" | "AU_GST" | "NONE";

export type MarketTaxPolicy = Readonly<{
  jurisdiction: TaxJurisdiction;
  registered: boolean;
  rateBasisPoints: number;
}>;

export type TaxInclusiveAmount = Readonly<{
  amountExTaxCents: number;
  taxCents: number;
  amountInclTaxCents: number;
}>;
