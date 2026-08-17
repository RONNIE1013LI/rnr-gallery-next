import { describe, expect, it } from "vitest";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import { buildOrderPricingSnapshot } from "./order-pricing-snapshot";

const unitPrice = {
  market: "AU" as const, currency: "AUD" as const, taxJurisdiction: "AU_GST" as const,
  taxRateBasisPoints: 1_000, discountCents: 0, designSurchargeCents: 0,
  lines: [{ key: "product-size", label: "Product / size price", amountExGstCents: 30_908, amountInclGstCents: 33_999 }],
  subtotalExGstCents: 30_908, gstCents: 3_091, totalInclGstCents: 33_999,
};
const cart = {
  version: 1, market: "AU", currency: "AUD", taxJurisdiction: "AU_GST",
  taxRateBasisPoints: 1_000, priceBookRevision: 9, orderDate: "2026-08-16",
  items: [{
    clientItemId: "10000000-0000-4000-8000-000000000001",
    productKey: "banner-bundle", productSlug: "banner-bundle", productTitle: "Banner Bundle",
    galleryDesign: {
      id: "d".repeat(64), title: "Private inspiration", contentHash: "e".repeat(64),
      productSlug: "banner-bundle", imageUrl: "/gallery-images/private-banner-file.jpg",
    },
    sizeKey: "rollup-wall-200x100",
    sizeLabel: "85 × 200 cm Roll-Up + 200 × 100 cm Wall Banner",
    peoplePets: 0,
    photoSubmissionMethod: "later", designText: "Private bundle wording", notes: "Private bundle note",
    neededDate: "2026-08-24", urgentServiceConfirmed: false,
    urgentService: { workingDays: 5, feeInclGstCents: 0 }, quantity: 1,
    uploadReferences: ["00000000-0000-4000-8000-000000000101"],
    bundleComponents: [{
      componentKey: "roll-up", photoSubmissionMethod: "upload",
      designText: "Private roll-up wording", notes: "Private roll-up note",
      uploadReferences: ["00000000-0000-4000-8000-000000000101"],
      mainPhotoUploadId: "00000000-0000-4000-8000-000000000101",
    }, {
      componentKey: "wall-banner", photoSubmissionMethod: "later",
      designText: "Private wall wording", notes: "Private wall note", uploadReferences: [],
    }],
    unitPrice, lineSubtotalExGstCents: 30_908,
    lineGstCents: 3_091, lineTotalInclGstCents: 33_999,
  }],
  subtotalExGstCents: 30_908, gstCents: 3_091, totalInclGstCents: 33_999,
  discountCents: 0, designSurchargeCents: 0, itemCount: 1, cartDigest: "a".repeat(64),
} as const satisfies RepricedCheckoutCart;

describe("immutable order pricing snapshot", () => {
  it("captures Banner Bundle market, currency, tax and price lines without personal customisation", () => {
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
      productTotalInclTaxCents: 33_999,
      shipping: { currency: "AUD", amountInclTaxCents: 4_500 },
      taxAmountCents: 3_500, finalTotalCents: 38_499,
      items: [{
        productKey: "banner-bundle",
        sizeKey: "rollup-wall-200x100",
        unitPrice: {
          currency: "AUD",
          taxJurisdiction: "AU_GST",
          lines: [{
            key: "product-size",
            amountExGstCents: 30_908,
            amountInclGstCents: 33_999,
          }],
        },
        lineSubtotalExTaxCents: 30_908,
        lineTaxCents: 3_091,
        lineTotalInclTaxCents: 33_999,
      }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /Private|bundleComponents|designText|notes|uploadReferences|mainPhotoUploadId|filename|imageUrl|gallery-images/i,
    );
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
