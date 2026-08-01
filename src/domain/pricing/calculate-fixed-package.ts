import {
  assertIntegerCents,
  createPriceBreakdown,
  type PriceBreakdown,
} from "./types";

type FixedPackageInput = Readonly<{
  priceExGstCents: number;
}>;

export function calculateFixedPackage(
  input: FixedPackageInput,
): PriceBreakdown {
  assertIntegerCents(input.priceExGstCents, "Fixed package price");

  return createPriceBreakdown([
    Object.freeze({
      key: "product-size",
      label: "Product / size price",
      amountExGstCents: input.priceExGstCents,
    }),
  ]);
}
