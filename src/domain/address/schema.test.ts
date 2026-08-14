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

  it.each([
    ["NZ", "Auckland", "1010", "+64211234567"],
    ["AU", "NSW", "2000", "+61412345678"],
  ] as const)(
    "preserves a valid %s E.164 phone",
    (country, region, postcode, phone) => {
      expect(
        normalizeAddress({
          ...base,
          country,
          region,
          postcode,
          phone,
        }).phone,
      ).toBe(phone);
    },
  );

  it.each([
    ["NZ", "Auckland", "1010", "+61 412 345 678"],
    ["AU", "NSW", "2000", "+64 21 123 4567"],
  ] as const)(
    "rejects a valid international phone from another country for %s",
    (country, region, postcode, phone) => {
      const result = addressInputSchema.safeParse({
        ...base,
        country,
        region,
        postcode,
        phone,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.phone).toContain(
          "Phone number is invalid for the selected country",
        );
      }
    },
  );

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

  it.each([
    ["fullName", 121],
    ["building", 101],
    ["street", 181],
    ["suburb", 101],
    ["region", 101],
    ["phone", 33],
    ["email", 255],
  ] as const)("rejects an oversized %s field", (field, length) => {
    const result = addressInputSchema.safeParse({
      ...base,
      country: "NZ",
      region: "Auckland",
      phone: "021 123 4567",
      [field]: "a".repeat(length),
    });

    expect(result.success).toBe(false);
  });
});
