import { InvalidPricingInputError } from "./types";

export type PeoplePetsPricing = Readonly<{
  peoplePetsFeesExGstCents: readonly number[];
  additionalPeoplePetsEachExGstCents: number;
}>;

export const DEFAULT_PEOPLE_PETS_PRICING: PeoplePetsPricing = Object.freeze({
  peoplePetsFeesExGstCents: Object.freeze([4_000, 6_000, 8_500, 11_000, 13_000]),
  additionalPeoplePetsEachExGstCents: 2_500,
});

export function getPeoplePetsFeeExGstCents(
  peoplePets: number,
  pricing: PeoplePetsPricing = DEFAULT_PEOPLE_PETS_PRICING,
): number {
  if (!Number.isInteger(peoplePets) || peoplePets < 1) {
    throw new InvalidPricingInputError(
      "The final artwork must include at least one person or pet.",
    );
  }

  if (peoplePets <= 5) {
    const fee = pricing.peoplePetsFeesExGstCents[peoplePets - 1];
    if (!Number.isSafeInteger(fee) || fee! < 0) {
      throw new InvalidPricingInputError("People / pets price is invalid.");
    }
    return fee!;
  }

  if (
    !Number.isSafeInteger(pricing.additionalPeoplePetsEachExGstCents) ||
    pricing.additionalPeoplePetsEachExGstCents < 0
  ) {
    throw new InvalidPricingInputError("People / pets price is invalid.");
  }
  const fee = peoplePets * pricing.additionalPeoplePetsEachExGstCents;
  if (!Number.isSafeInteger(fee)) {
    throw new InvalidPricingInputError("People / pets price is invalid.");
  }
  return fee;
}
