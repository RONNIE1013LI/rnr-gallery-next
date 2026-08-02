import { calculateDigitalOilCanvas } from "@/domain/pricing/calculate-canvas";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import {
  addTaxInclusivePriceLine,
  InvalidPricingInputError,
  type PriceBreakdown,
} from "@/domain/pricing/types";
import type { ProductConfigurationSchema } from "./types";

type QuoteSelection = Readonly<{
  sizeKey: string;
  peoplePets: number;
  urgentFeeInclGstCents?: number;
}>;

export function quoteConfiguration(
  schema: ProductConfigurationSchema,
  selection: QuoteSelection,
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
    });
  } else if (selection.peoplePets !== 0) {
    throw new InvalidPricingInputError(
      `People / pets pricing is unavailable for ${schema.productKey}.`,
    );
  } else {
    breakdown = calculateFixedPackage({ priceExGstCents: size.priceExGstCents });
  }

  if (!selection.urgentFeeInclGstCents) return breakdown;
  return addTaxInclusivePriceLine(breakdown, {
    key: "urgent-service",
    label: "Urgent service",
    amountInclGstCents: selection.urgentFeeInclGstCents,
  });
}
