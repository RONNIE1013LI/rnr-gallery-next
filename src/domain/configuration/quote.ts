import { calculateDigitalOilCanvas } from "@/domain/pricing/calculate-canvas";
import { calculateFixedPackage } from "@/domain/pricing/calculate-fixed-package";
import {
  InvalidPricingInputError,
  type PriceBreakdown,
} from "@/domain/pricing/types";
import type { ProductConfigurationSchema } from "./types";

type QuoteSelection = Readonly<{
  sizeKey: string;
  peoplePets: number;
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

  if (schema.peoplePetsMode === "required") {
    return calculateDigitalOilCanvas({
      baseExGstCents: size.priceExGstCents,
      peoplePets: selection.peoplePets,
    });
  }

  if (selection.peoplePets !== 0) {
    throw new InvalidPricingInputError(
      `People / pets pricing is unavailable for ${schema.productKey}.`,
    );
  }

  return calculateFixedPackage({ priceExGstCents: size.priceExGstCents });
}
