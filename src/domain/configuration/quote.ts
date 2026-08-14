import { calculateDigitalOilCanvas } from "@/domain/pricing/calculate-canvas";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import {
  addTaxInclusivePriceLine,
  createPriceBreakdown,
  InvalidPricingInputError,
  type PriceBreakdown,
} from "@/domain/pricing/types";
import type { ProductConfigurationSchema } from "./types";
import type { PeoplePetsPricing } from "@/domain/pricing/people-fees";

type QuoteSelection = Readonly<{
  sizeKey: string;
  peoplePets: number;
  urgentFeeInclGstCents?: number;
  sourcePhotoCount?: number;
  extraBackgroundRemovalCount?: number;
}>;

export function quoteConfiguration(
  schema: ProductConfigurationSchema,
  selection: QuoteSelection,
  options: Readonly<{ peoplePetsPricing?: PeoplePetsPricing }> = {},
): PriceBreakdown {
  const size = schema.sizes.find((option) => option.key === selection.sizeKey);
  if (!size) {
    throw new InvalidPricingInputError(
      `Size ${selection.sizeKey} is unavailable for ${schema.productKey}.`,
    );
  }

  let breakdown: PriceBreakdown;
  if (schema.peoplePetsMode === "required") {
    breakdown = calculateDigitalOilCanvas({
      baseExGstCents: size.priceExGstCents,
      peoplePets: selection.peoplePets,
    }, options.peoplePetsPricing);
  } else if (selection.peoplePets !== 0) {
    throw new InvalidPricingInputError(
      `People / pets pricing is unavailable for ${schema.productKey}.`,
    );
  } else {
    breakdown = calculateFixedPackage({ priceExGstCents: size.priceExGstCents });
  }

  const extraPhotoCount = Math.max(
    0,
    (selection.sourcePhotoCount ?? 0) - schema.includedPhotos,
  );
  if (extraPhotoCount > 0 && schema.extraPhotoPriceExGstCents) {
    breakdown = createPriceBreakdown([
      ...breakdown.lines,
      Object.freeze({
        key: "extra-photos",
        label: "Extra photos",
        amountExGstCents: extraPhotoCount * schema.extraPhotoPriceExGstCents,
      }),
    ]);
  }

  const extraBackgroundRemovalCount = selection.extraBackgroundRemovalCount ?? 0;
  if (extraBackgroundRemovalCount > 0 && schema.extraBackgroundRemovalFeeInclGstCents) {
    breakdown = addTaxInclusivePriceLine(breakdown, {
      key: "extra-background-removals",
      label: "Extra background removals",
      amountInclGstCents:
        extraBackgroundRemovalCount * schema.extraBackgroundRemovalFeeInclGstCents,
    });
  }

  if (!selection.urgentFeeInclGstCents) return breakdown;
  return addTaxInclusivePriceLine(breakdown, {
    key: "urgent-service",
    label: "Urgent service",
    amountInclGstCents: selection.urgentFeeInclGstCents,
  });
}
