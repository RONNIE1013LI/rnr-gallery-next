import { describe, expect, it } from "vitest";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import { normalizeAddress } from "@/domain/address/schema";
import { createShippingService } from "./shipping-service";
import type { ShippingQuoteProvider, ShippingQuoteRequest } from "./types";

const productId = "00000000-0000-4000-8000-000000000002";
const snapshot = { productId, variantId: null, title: "Synthetic stand", slug: "synthetic-stand", sku: "TEST-STAND", variantLabel: "Standard", unitPriceCents: 1150, trackInventory: true, stockQuantity: 20, weightGrams: 1100, packedLengthMm: 910, packedWidthMm: 130, packedHeightMm: 125, pickupAllowed: true, shippingAllowed: true };
const supply = { kind: "supply", clientItemId: "00000000-0000-4000-8000-000000000001", supplyProductId: productId, quantity: 2 };
const custom = { clientItemId: "00000000-0000-4000-8000-000000000003", productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape", peoplePets: 0, photoSubmissionMethod: "later", designText: "", notes: "", neededDate: "2026-11-20", quantity: 1, uploadReferences: [] };
const address = normalizeAddress({ country: "NZ", fullName: "Synthetic Customer", building: "", street: "12 Queen Street", suburb: "Auckland Central", region: "Auckland", postcode: "1010", phone: "0211234567", email: "synthetic@example.test" });
const now = new Date("2026-10-13T00:00:00Z");
function setup() {
  let request: ShippingQuoteRequest | null = null;
  const provider: ShippingQuoteProvider = { key: "gosweetspot", availability: async () => ({ available: true }), quote: async (input) => {
    request = input;
    return { provider: "gosweetspot", serviceCode: "actual-test-fixture", serviceName: "Fixture carrier response", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, currency: "NZD", providerReference: "fixture", expiresAt: new Date(now.getTime() + 60000), rawResponseHash: "a".repeat(64), isTest: false };
  } };
  return { service: createShippingService({ provider, now: () => now }), request: () => request };
}

describe("supply packages in shared shipping", () => {
  it("sends each measured supply package and the unchanged custom package to the carrier", async () => {
    const fixture = setup();
    const cart = repriceCart({ version: 1, items: [supply, custom] }, { now, supplies: new Map([[productId, snapshot]]) });
    await fixture.service.quotePost(cart, address);
    expect(fixture.request()?.packages).toEqual([
      { productKey: `supply:${productId}`, sizeKey: "standard", weightGrams: 1100, lengthMm: 910, widthMm: 130, heightMm: 125, unitPriceInclGstCents: 1150 },
      { productKey: `supply:${productId}`, sizeKey: "standard", weightGrams: 1100, lengthMm: 910, widthMm: 130, heightMm: 125, unitPriceInclGstCents: 1150 },
      { productKey: "photo-print-canvas", sizeKey: "a4", lengthMm: 220, widthMm: 300, heightMm: 30, weightGrams: 500, unitPriceInclGstCents: 7475 },
    ]);
  });
  it("blocks missing measured dimensions without asking the provider for a guessed rate", async () => {
    const fixture = setup();
    const cart = repriceCart({ version: 1, items: [supply] }, { now, supplies: new Map([[productId, { ...snapshot, packedLengthMm: null }]]) });
    await expect(fixture.service.quotePost(cart, address)).rejects.toThrow(/dimensions/);
    expect(fixture.request()).toBeNull();
  });
});
