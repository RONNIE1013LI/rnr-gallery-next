import type { SupportedCountry } from "@/domain/address/types";

export type PackageProfile = Readonly<{
  productKey: string;
  sizeKey: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
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
  cartValueInclGstCents: number;
  packages: readonly PackageProfile[];
  destination: ShippingDestination;
}>;

export type ProviderAvailability = Readonly<{
  available: boolean;
  reason?: string;
}>;

export type ProviderShippingQuote = Readonly<{
  provider: "gosweetspot" | "local-test";
  serviceCode: string;
  serviceName: string;
  amountExGstCents: number;
  gstCents: number;
  amountInclGstCents: number;
  currency: "NZD";
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
