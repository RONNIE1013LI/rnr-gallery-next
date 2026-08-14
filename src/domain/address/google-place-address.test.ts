import { describe, expect, it } from "vitest";
import type { AddressInput } from "./types";
import { mergeGooglePlaceAddress } from "./google-place-address";

const existing: AddressInput = {
  country: "NZ",
  fullName: "Ronnie Lee",
  building: "",
  street: "",
  suburb: "",
  region: "",
  postcode: "",
  phone: "+642102348948",
  email: "ronnie@example.test",
};

describe("mergeGooglePlaceAddress", () => {
  it("maps a New Zealand prediction without replacing customer contact details", () => {
    const result = mergeGooglePlaceAddress(existing, [
      { longText: "4", shortText: "4", types: ["subpremise"] },
      { longText: "11", shortText: "11", types: ["street_number"] },
      { longText: "Para Close", shortText: "Para Close", types: ["route"] },
      { longText: "Fairview Heights", shortText: "Fairview Heights", types: ["sublocality_level_1"] },
      { longText: "Auckland", shortText: "Auckland", types: ["locality"] },
      { longText: "0632", shortText: "0632", types: ["postal_code"] },
      { longText: "New Zealand", shortText: "NZ", types: ["country"] },
    ]);

    expect(result).toEqual({
      ...existing,
      country: "NZ",
      building: "4",
      street: "11 Para Close",
      suburb: "Fairview Heights",
      region: "Auckland",
      postcode: "0632",
    });
  });

  it("uses the canonical Australian state code and locality", () => {
    const result = mergeGooglePlaceAddress(existing, [
      { longText: "Level 8", shortText: "Level 8", types: ["subpremise"] },
      { longText: "200", shortText: "200", types: ["street_number"] },
      { longText: "George Street", shortText: "George St", types: ["route"] },
      { longText: "Sydney", shortText: "Sydney", types: ["locality"] },
      { longText: "New South Wales", shortText: "NSW", types: ["administrative_area_level_1"] },
      { longText: "2000", shortText: "2000", types: ["postal_code"] },
      { longText: "Australia", shortText: "AU", types: ["country"] },
    ]);

    expect(result).toEqual({
      ...existing,
      country: "AU",
      building: "Level 8",
      street: "200 George Street",
      suburb: "Sydney",
      region: "NSW",
      postcode: "2000",
    });
  });

  it("replaces the previous suburb when a newly selected street uses locality as its suburb", () => {
    const previousAddress: AddressInput = {
      ...existing,
      country: "AU",
      street: "200 George Street",
      suburb: "Sydney",
      region: "NSW",
      postcode: "2000",
    };

    const result = mergeGooglePlaceAddress(previousAddress, [
      { longText: "678", shortText: "678", types: ["street_number"] },
      { longText: "Kororoit Creek Road", shortText: "Kororoit Creek Rd", types: ["route"] },
      { longText: "Altona North", shortText: "Altona North", types: ["locality"] },
      { longText: "Victoria", shortText: "VIC", types: ["administrative_area_level_1"] },
      { longText: "3025", shortText: "3025", types: ["postal_code"] },
      { longText: "Australia", shortText: "AU", types: ["country"] },
    ]);

    expect(result).toMatchObject({
      street: "678 Kororoit Creek Road",
      suburb: "Altona North",
      region: "VIC",
      postcode: "3025",
    });
  });

  it("rejects an address outside the supported countries", () => {
    expect(mergeGooglePlaceAddress(existing, [
      { longText: "United States", shortText: "US", types: ["country"] },
    ])).toBeNull();
  });

  it("keeps manually entered values when a prediction omits an address component", () => {
    const current = {
      ...existing,
      street: "Manual street",
      suburb: "Manual suburb",
      postcode: "1010",
    };

    expect(mergeGooglePlaceAddress(current, [
      { longText: "Auckland", shortText: "Auckland", types: ["locality"] },
      { longText: "New Zealand", shortText: "NZ", types: ["country"] },
    ])).toEqual({
      ...current,
      region: "Auckland",
    });
  });
});
