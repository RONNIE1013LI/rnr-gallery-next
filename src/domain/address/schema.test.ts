import { describe, expect, it } from "vitest";
import { addressInputSchema, normalizeAddress } from "./schema";

const base = {
  fullName: "Alex Morgan",
  building: "",
  street: "12 Queen Street",
  suburb: "Central",
  postcode: "1010",
  email: "alex@example.com",
};

describe("addressInputSchema", () => {
  it("accepts and normalizes a New Zealand address", () => {
    const result = normalizeAddress({
      ...base,
      country: "NZ",
      region: "Auckland",
      phone: "021 123 4567",
    });

    expect(result).toMatchObject({ country: "NZ", postcode: "1010" });
    expect(result.phone).toMatch(/^\+64/);
  });

  it("accepts an Australian state and normalizes its phone", () => {
    const result = normalizeAddress({
      ...base,
      country: "AU",
      region: "NSW",
      postcode: "2000",
      phone: "0412 345 678",
    });

    expect(result).toMatchObject({ country: "AU", region: "NSW" });
    expect(result.phone).toMatch(/^\+61/);
  });

  it("rejects an Australian address with a non-Australian region", () => {
    const result = addressInputSchema.safeParse({
      ...base,
      country: "AU",
      region: "Auckland",
      postcode: "2000",
      phone: "0412 345 678",
    });

    expect(result.success).toBe(false);
  });

  it.each(["123", "12345", "ABCD"])("rejects postcode %s", (postcode) => {
    expect(
      addressInputSchema.safeParse({
        ...base,
        country: "NZ",
        region: "Auckland",
        postcode,
        phone: "021 123 4567",
      }).success,
    ).toBe(false);
  });
});
