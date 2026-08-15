import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { MarketCurrency } from "@/domain/markets/types";
import type { ProviderShippingQuote } from "@/server/shipping/types";

export type OrderPricingSnapshot = Readonly<{
  schemaVersion: 1;
  market: RepricedCheckoutCart["market"];
  currency: RepricedCheckoutCart["currency"];
  priceBookRevision: number;
  taxJurisdiction: RepricedCheckoutCart["taxJurisdiction"];
  taxRateBasisPoints: number;
  items: readonly Readonly<{
    clientItemId: string;
    productKey: string;
    sizeKey: string;
    quantity: number;
    unitPrice: RepricedCheckoutCart["items"][number]["unitPrice"];
    lineSubtotalExTaxCents: number;
    lineTaxCents: number;
    lineTotalInclTaxCents: number;
  }>[];
  productSubtotalExTaxCents: number;
  productTaxCents: number;
  productTotalInclTaxCents: number;
  designSurchargeCents: number;
  discountCents: number;
  shipping: Readonly<{
    method: "pickup" | "post";
    serviceCode: string;
    currency: MarketCurrency;
    amountExTaxCents: number;
    taxCents: number;
    amountInclTaxCents: number;
  }>;
  taxAmountCents: number;
  finalTotalCents: number;
}>;

type ShippingSnapshotInput =
  | Readonly<{ kind: "pickup" }>
  | Readonly<{ kind: "post"; quote: ProviderShippingQuote }>;

export function buildOrderPricingSnapshot(
  cart: RepricedCheckoutCart,
  shipping: ShippingSnapshotInput,
): OrderPricingSnapshot {
  const shippingCurrency = shipping.kind === "pickup" ? cart.currency : shipping.quote.currency;
  if (shippingCurrency !== cart.currency) {
    throw new Error("Shipping currency must match the order currency.");
  }
  const shippingSnapshot = shipping.kind === "pickup"
    ? {
        method: "pickup" as const,
        serviceCode: "pickup",
        currency: cart.currency,
        amountExTaxCents: 0,
        taxCents: 0,
        amountInclTaxCents: 0,
      }
    : {
        method: "post" as const,
        serviceCode: shipping.quote.serviceCode,
        currency: shipping.quote.currency,
        amountExTaxCents: shipping.quote.amountExGstCents,
        taxCents: shipping.quote.gstCents,
        amountInclTaxCents: shipping.quote.amountInclGstCents,
      };
  return Object.freeze({
    schemaVersion: 1 as const,
    market: cart.market,
    currency: cart.currency,
    priceBookRevision: cart.priceBookRevision,
    taxJurisdiction: cart.taxJurisdiction,
    taxRateBasisPoints: cart.taxRateBasisPoints,
    items: Object.freeze(cart.items.map((item) => Object.freeze({
      clientItemId: item.clientItemId,
      productKey: item.productKey,
      sizeKey: item.sizeKey,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineSubtotalExTaxCents: item.lineSubtotalExGstCents,
      lineTaxCents: item.lineGstCents,
      lineTotalInclTaxCents: item.lineTotalInclGstCents,
    }))),
    productSubtotalExTaxCents: cart.subtotalExGstCents,
    productTaxCents: cart.gstCents,
    productTotalInclTaxCents: cart.totalInclGstCents,
    designSurchargeCents: cart.designSurchargeCents,
    discountCents: cart.discountCents,
    shipping: Object.freeze(shippingSnapshot),
    taxAmountCents: cart.gstCents + shippingSnapshot.taxCents,
    finalTotalCents: cart.totalInclGstCents + shippingSnapshot.amountInclTaxCents,
  });
}
