import type { SupplyCartItem } from "./types";

/** Browser display snapshot only. Checkout always reloads price and eligibility. */
export function createSupplyCartItem(input: Readonly<{
  id: string;
  productId: string;
  variantId?: string;
  title: string;
  slug: string;
  sku: string;
  variantLabel?: string;
  imageSrc: string;
  unitPriceCents: number;
  quantity: number;
  deliveryPreference?: "pickup" | "post";
}>): SupplyCartItem {
  if (!Number.isSafeInteger(input.unitPriceCents) || input.unitPriceCents <= 0 ||
      !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) {
    throw new RangeError("Supply price and quantity are invalid.");
  }
  const subtotalExGstCents = Math.round(input.unitPriceCents * 100 / 115);
  return Object.freeze({ kind: "supply", id: input.id, supplyProductId: input.productId,
    ...(input.variantId ? { supplyVariantId: input.variantId } : {}),
    productKey: `supply:${input.productId}`, productSlug: input.slug, productTitle: input.title,
    sku: input.sku, sizeKey: input.variantId ?? "standard", sizeLabel: input.variantLabel || "Standard supply",
    imageSrc: input.imageSrc, quantity: input.quantity, deliveryPreference: input.deliveryPreference ?? "post",
    price: Object.freeze({ market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST", taxRateBasisPoints: 1500,
      subtotalExGstCents, gstCents: input.unitPriceCents - subtotalExGstCents, totalInclGstCents: input.unitPriceCents,
      discountCents: 0, designSurchargeCents: 0, lines: Object.freeze([Object.freeze({ key: "supply", label: input.title,
        amountExGstCents: subtotalExGstCents, amountInclGstCents: input.unitPriceCents })]),
    }),
  });
}
