import type { SupportedCountry } from "@/domain/address/types";
import type { Market, MarketCurrency, MarketTaxPolicy } from "@/domain/markets/types";

export type PackageProfile = Readonly<{
  productKey: string;
  sizeKey: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
}>;

export type ShippingPackage = Readonly<PackageProfile & {
  unitPriceInclGstCents: number;
}>;

export type ShippingDestination = Readonly<{
  contact: string;
  street: string;
  suburb: string;
  city: string;
  postcode: string;
  countryCode: SupportedCountry;
}>;

export type ShippingQuoteRequest = Readonly<{
  market: Market;
  currency: MarketCurrency;
  taxPolicy: MarketTaxPolicy;
  cartValueInclGstCents: number;
  packages: readonly ShippingPackage[];
  destination: ShippingDestination;
}>;

export type ProviderAvailability = Readonly<{
  available: boolean;
  reason?: string;
}>;

export type ProviderShippingQuote = Readonly<{
  provider: "gosweetspot" | "local-test" | "internal-fixed";
  serviceCode: string;
  serviceName: string;
  amountExGstCents: number;
  gstCents: number;
  amountInclGstCents: number;
  currency: MarketCurrency;
  providerReference: string;
  expiresAt: Date;
  rawResponseHash: string;
  isTest: boolean;
}>;

export interface ShippingQuoteProvider {
  readonly key: ProviderShippingQuote["provider"];
  availability(): Promise<ProviderAvailability>;
  quote(request: ShippingQuoteRequest): Promise<ProviderShippingQuote>;
}

export class ShippingProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ShippingProviderError";
  }
}
