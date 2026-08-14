import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import {
  AUSTRALIAN_REGIONS,
  SUPPORTED_COUNTRIES,
  type NormalizedAddress,
} from "./types";

export const ADDRESS_FIELD_LIMITS = Object.freeze({
  fullName: 120,
  building: 100,
  street: 180,
  suburb: 100,
  region: 100,
  phone: 32,
  email: 254,
});

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);

function parsePhoneForCountry(
  value: string,
  country: (typeof SUPPORTED_COUNTRIES)[number],
) {
  const phone = parsePhoneNumberFromString(value, country);
  return phone?.isValid() && phone.country === country ? phone : undefined;
}

export const addressInputSchema = z
  .object({
    country: z.enum(SUPPORTED_COUNTRIES),
    fullName: requiredText(ADDRESS_FIELD_LIMITS.fullName),
    building: z.string().trim().max(ADDRESS_FIELD_LIMITS.building),
    street: requiredText(ADDRESS_FIELD_LIMITS.street),
    suburb: requiredText(ADDRESS_FIELD_LIMITS.suburb),
    region: requiredText(ADDRESS_FIELD_LIMITS.region),
    postcode: z.string().trim().regex(/^\d{4}$/),
    phone: requiredText(ADDRESS_FIELD_LIMITS.phone),
    email: z.string().trim().max(ADDRESS_FIELD_LIMITS.email).email(),
  })
  .superRefine((address, context) => {
    if (
      address.country === "AU" &&
      !AUSTRALIAN_REGIONS.includes(
        address.region as (typeof AUSTRALIAN_REGIONS)[number],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["region"],
        message: "Australian region must be a valid state or territory",
      });
    }

    if (!parsePhoneForCountry(address.phone, address.country)) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Phone number is invalid for the selected country",
      });
    }
  });

export function normalizeAddress(input: unknown): NormalizedAddress {
  const parsed = addressInputSchema.parse(input);
  const phone = parsePhoneForCountry(parsed.phone, parsed.country);
  if (!phone) {
    throw new Error("Phone number is invalid for the selected country");
  }

  return Object.freeze({ ...parsed, phone: phone.number });
}
