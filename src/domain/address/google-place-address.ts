import {
  AUSTRALIAN_REGIONS,
  type AddressInput,
  type SupportedCountry,
} from "./types";

export type GoogleAddressComponent = Readonly<{
  longText: string;
  shortText: string;
  types: readonly string[];
}>;

export function mergeGooglePlaceAddress(
  current: AddressInput,
  components: readonly GoogleAddressComponent[],
): AddressInput | null {
  const component = (...types: string[]) =>
    components.find((candidate) =>
      types.some((type) => candidate.types.includes(type)),
    );

  const countryCode = component("country")?.shortText.toUpperCase();
  if (countryCode && countryCode !== "NZ" && countryCode !== "AU") return null;
  const country = (countryCode ?? current.country) as SupportedCountry;
  const streetAddress = component("street_address")?.longText.trim();
  const streetNumber = component("street_number")?.longText.trim();
  const route = component("route")?.longText.trim();
  const street = streetAddress || [streetNumber, route].filter(Boolean).join(" ");
  const locality = component("locality", "postal_town")?.longText.trim();
  const explicitSuburb = component(
    "sublocality_level_1",
    "sublocality",
    "neighborhood",
  )?.longText.trim();
  const suburb = explicitSuburb || (street ? locality : undefined) || current.suburb || locality;
  const administrativeArea = component("administrative_area_level_1");
  const region = country === "AU"
    ? administrativeArea?.shortText.toUpperCase()
    : locality || administrativeArea?.longText.trim();
  const validRegion = country !== "AU" || !region || AUSTRALIAN_REGIONS.includes(
    region as (typeof AUSTRALIAN_REGIONS)[number],
  );

  return {
    ...current,
    country,
    building: component("subpremise")?.longText.trim() || current.building,
    street: street || current.street,
    suburb: suburb || current.suburb,
    region: validRegion && region ? region : current.region,
    postcode: component("postal_code")?.longText.trim() || current.postcode,
  };
}
