import { describe, expect, it } from "vitest";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { buildOrderPricingSnapshot } from "./order-pricing-snapshot";

const unitPrice = {
  market: "AU" as const, currency: "AUD" as const, taxJurisdiction: "AU_GST" as const,
  taxRateBasisPoints: 1_000, discountCents: 0, designSurchargeCents: 0,
  lines: [{ key: "product-size", label: "Product / size price", amountExGstCents: 30_000, amountInclGstCents: 33_000 }],
  subtotalExGstCents: 30_000, gstCents: 3_000, totalInclGstCents: 33_000,
};
const cart = {
  version: 1, market: "AU", currency: "AUD", taxJurisdiction: "AU_GST",
  taxRateBasisPoints: 1_000, priceBookRevision: 9, orderDate: "2026-08-16",
  items: [{
    clientItemId: "10000000-0000-4000-8000-000000000001",
    productKey: "roll-up-banner", productSlug: "roll-up-banner", productTitle: "Roll-Up Banner",
    sizeKey: "standard", sizeLabel: "85 × 200 cm", peoplePets: 0,
    photoSubmissionMethod: "later", designText: "Private wording", notes: "Private note",
    neededDate: "2026-08-24", urgentServiceConfirmed: false,
    urgentService: { workingDays: 5, feeInclGstCents: 0 }, quantity: 1,
    uploadReferences: [], unitPrice, lineSubtotalExGstCents: 30_000,
    lineGstCents: 3_000, lineTotalInclGstCents: 33_000,
  }],
  subtotalExGstCents: 30_000, gstCents: 3_000, totalInclGstCents: 33_000,
  discountCents: 0, designSurchargeCents: 0, itemCount: 1, cartDigest: "a".repeat(64),
} as const satisfies RepricedCheckoutCart;

describe("immutable order pricing snapshot", () => {
  it("captures AUD unit, option, tax, shipping and final amounts without private artwork data", () => {
    const snapshot = buildOrderPricingSnapshot(cart, {
      kind: "post",
      quote: {
        provider: "internal-fixed", serviceCode: "au-standard", serviceName: "AU standard",
        currency: "AUD", amountExGstCents: 4_091, gstCents: 409,
        amountInclGstCents: 4_500, providerReference: "fixed-aud-9-test",
        expiresAt: new Date("2026-08-16T01:00:00Z"), rawResponseHash: "b".repeat(64), isTest: false,
      },
    });

    expect(snapshot).toMatchObject({
      market: "AU", currency: "AUD", priceBookRevision: 9,
      taxJurisdiction: "AU_GST", taxRateBasisPoints: 1_000,
      productTotalInclTaxCents: 33_000,
      shipping: { currency: "AUD", amountInclTaxCents: 4_500 },
      taxAmountCents: 3_409, finalTotalCents: 37_500,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/Private wording|Private note|uploadReferences/);
  });

  it("rejects shipping retained from another currency", () => {
    expect(() => buildOrderPricingSnapshot(cart, {
      kind: "post",
      quote: {
        provider: "local-test", serviceCode: "bad", serviceName: "Bad",
        currency: "NZD", amountExGstCents: 2_000, gstCents: 300,
        amountInclGstCents: 2_300, providerReference: "bad",
        expiresAt: new Date("2026-08-16T01:00:00Z"), rawResponseHash: "c".repeat(64), isTest: true,
      },
    })).toThrow("Shipping currency must match");
  });
});
