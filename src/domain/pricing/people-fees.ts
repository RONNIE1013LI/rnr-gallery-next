import { InvalidPricingInputError } from "./types";

const PEOPLE_FEES_EX_GST_CENTS = [0, 4_000, 6_000, 8_500, 11_000, 13_000] as const;

export function getPeoplePetsFeeExGstCents(peoplePets: number): number {
  if (!Number.isInteger(peoplePets) || peoplePets < 1) {
    throw new InvalidPricingInputError(
      "The final artwork must include at least one person or pet.",
    );
  }

  if (peoplePets <= 5) {
    return PEOPLE_FEES_EX_GST_CENTS[peoplePets];
  }

  return PEOPLE_FEES_EX_GST_CENTS[5] + (peoplePets - 5) * 2_500;
}
