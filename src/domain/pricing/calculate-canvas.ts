import { getPeoplePetsFeeExGstCents } from "./people-fees";
import {
  assertIntegerCents,
  createPriceBreakdown,
  type PriceBreakdown,
} from "./types";

type DigitalOilCanvasInput = Readonly<{
  baseExGstCents: number;
  peoplePets: number;
}>;

export function calculateDigitalOilCanvas(
  input: DigitalOilCanvasInput,
): PriceBreakdown {
  assertIntegerCents(input.baseExGstCents, "Canvas base price");

  return createPriceBreakdown([
    Object.freeze({
      key: "product-size",
      label: "Product / size price",
      amountExGstCents: input.baseExGstCents,
    }),
    Object.freeze({
      key: "people-pets",
      label: "People / pets fee",
      amountExGstCents: getPeoplePetsFeeExGstCents(input.peoplePets),
    }),
  ]);
}
