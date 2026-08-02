import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import {
  AUSTRALIAN_REGIONS,
  SUPPORTED_COUNTRIES,
  type NormalizedAddress,
} from "./types";

const requiredText = z.string().trim().min(1);

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
    fullName: requiredText,
    building: z.string().trim(),
    street: requiredText,
    suburb: requiredText,
    region: requiredText,
    postcode: z.string().trim().regex(/^\d{4}$/),
    phone: requiredText,
    email: z.string().trim().email(),
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
