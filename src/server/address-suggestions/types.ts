import type { SupportedCountry } from "@/domain/address/types";

export type AddressSuggestionQuery = Readonly<{
  countryCode: SupportedCountry;
  query: string;
}>;

export type AddressSuggestion = Readonly<{
  id: string;
  label: string;
  address: Readonly<{
    country: SupportedCountry;
    building: string;
    street: string;
    suburb: string;
    region: string;
    postcode: string;
  }>;
}>;

export interface AddressSuggestionProvider {
  availability(): Promise<Readonly<{ available: boolean; reason?: string }>>;
  suggest(query: AddressSuggestionQuery): Promise<readonly AddressSuggestion[]>;
}
