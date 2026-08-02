export const SUPPORTED_COUNTRIES = ["NZ", "AU"] as const;

export const AUSTRALIAN_REGIONS = [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
] as const;

export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

export type AddressInput = Readonly<{
  country: SupportedCountry;
  fullName: string;
  building: string;
  street: string;
  suburb: string;
  region: string;
  postcode: string;
  phone: string;
  email: string;
}>;

export type NormalizedAddress = AddressInput;
