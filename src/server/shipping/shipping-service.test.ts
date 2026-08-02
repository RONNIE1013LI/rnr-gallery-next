import { describe, expect, it, vi } from "vitest";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import type { NormalizedAddress } from "@/domain/address/types";
import {
  createShippingService,
  selectShippingProvider,
  ShippingUnavailableError,
} from "./shipping-service";
import type { ShippingQuoteProvider } from "./types";

const now = new Date("2026-08-02T12:00:00.000Z");
const address: NormalizedAddress = {
  country: "NZ",
  fullName: "Aroha Ngata",
  building: "Unit 4",
  street: "12 Queen Street",
  suburb: "Auckland Central",
  region: "Auckland",
  postcode: "1010",
  phone: "+64211234567",
  email: "aroha@example.test",
};

function cart(overrides: Record<string, unknown> = {}) {
  return repriceCart({
    version: 1,
    items: [{
      clientItemId: "00000000-0000-4000-8000-000000000010",
      productKey: "photo-print-canvas",
      sizeKey: "a4",
      orientation: "landscape",
      peoplePets: 0,
      photoSubmissionMethod: "later",
      designText: "Family portrait",
      notes: "Warm colours",
      neededDate: "2026-08-10",
      urgentServiceConfirmed: false,
      quantity: 1,
      uploadReferences: [],
      ...overrides,
    }],
  }, { now });
}

function provider(overrides: Partial<ShippingQuoteProvider> = {}): ShippingQuoteProvider {
  return {
    key: "local-test",
    availability: vi.fn().mockResolvedValue({ available: true }),
    quote: vi.fn().mockResolvedValue({
      provider: "local-test",
      serviceCode: "test-post-nz",
      serviceName: "Test Post — not a live carrier rate",
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
      currency: "NZD",
      providerReference: "test-ref",
      expiresAt: new Date("2026-08-02T12:15:00.000Z"),
      rawResponseHash: "a".repeat(64),
      isTest: true,
    }),
    ...overrides,
  };
}

describe("shipping service", () => {
  it("returns explicit internal NZ$0 Pickup without calling a provider", async () => {
    const quoteProvider = provider();
    const service = createShippingService({ provider: quoteProvider, now: () => now });

    await expect(service.pickup()).resolves.toEqual({
      method: "pickup",
      serviceCode: "pickup",
      serviceName: "Pickup",
      amountExGstCents: 0,
      gstCents: 0,
      amountInclGstCents: 0,
      currency: "NZD",
      provenance: "internal",
      isTest: false,
    });
    expect(quoteProvider.quote).not.toHaveBeenCalled();
  });

  it("builds packages server-side and returns a positive current Post quote", async () => {
    const quoteProvider = provider();
    const service = createShippingService({ provider: quoteProvider, now: () => now });

    const result = await service.quotePost(cart({ quantity: 2 }), address);

    expect(quoteProvider.quote).toHaveBeenCalledWith(expect.objectContaining({
      cartValueInclGstCents: 14_950,
      destination: {
        contact: "Aroha Ngata",
        street: "Unit 4, 12 Queen Street",
        suburb: "Auckland Central",
        city: "Auckland",
        postcode: "1010",
        countryCode: "NZ",
      },
      packages: [
        expect.objectContaining({ productKey: "photo-print-canvas", sizeKey: "a4" }),
        expect.objectContaining({ productKey: "photo-print-canvas", sizeKey: "a4" }),
      ],
    }));
    expect(result).toMatchObject({
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      option: {
        method: "post",
        amountInclGstCents: 2_300,
        provenance: "local-test",
        isTest: true,
      },
    });
  });

  it("invalidates the request digest when cart, destination or package profiles change", async () => {
    const service = createShippingService({ provider: provider(), now: () => now });
    const base = await service.quotePost(cart(), address);
    const changedCart = await service.quotePost(cart({ sizeKey: "a3" }), address);
    const changedDestination = await service.quotePost(cart(), {
      ...address,
      postcode: "6011",
      suburb: "Te Aro",
      region: "Wellington",
    });

    expect(new Set([
      base.requestDigest,
      changedCart.requestDigest,
      changedDestination.requestDigest,
    ]).size).toBe(3);
  });

  it.each([
    ["an unavailable provider", provider({ availability: vi.fn().mockResolvedValue({ available: false }) })],
    ["provider availability failure", provider({ availability: vi.fn().mockRejectedValue(new Error("availability down")) })],
    ["provider failure", provider({ quote: vi.fn().mockRejectedValue(new Error("carrier down")) })],
    ["a free Post quote", provider({ quote: vi.fn().mockResolvedValue({
      provider: "local-test", serviceCode: "bad", serviceName: "Bad",
      amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "NZD",
      providerReference: "bad", expiresAt: new Date("2026-08-02T12:15:00.000Z"),
      rawResponseHash: "b".repeat(64), isTest: true,
    }) })],
    ["an expired quote", provider({ quote: vi.fn().mockResolvedValue({
      provider: "local-test", serviceCode: "old", serviceName: "Old",
      amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300, currency: "NZD",
      providerReference: "old", expiresAt: now,
      rawResponseHash: "c".repeat(64), isTest: true,
    }) })],
    ["an invalid expiry", provider({ quote: vi.fn().mockResolvedValue({
      provider: "local-test", serviceCode: "invalid-date", serviceName: "Invalid date",
      amountExGstCents: 2_000, gstCents: 300, amountInclGstCents: 2_300, currency: "NZD",
      providerReference: "invalid-date", expiresAt: new Date(Number.NaN),
      rawResponseHash: "d".repeat(64), isTest: true,
    }) })],
  ])("fails closed for %s", async (_name, quoteProvider) => {
    await expect(
      createShippingService({ provider: quoteProvider, now: () => now })
        .quotePost(cart(), address),
    ).rejects.toBeInstanceOf(ShippingUnavailableError);
  });
});

describe("shipping provider selection", () => {
  it("selects GoSweetSpot only with complete credentials and tax mode", () => {
    expect(selectShippingProvider({
      GOSWEETSPOT_APP_ID: "app",
      GOSWEETSPOT_HMAC_SECRET: "secret",
      GOSWEETSPOT_RATE_TAX_MODE: "incl_gst",
    })?.key).toBe("gosweetspot");
    expect(selectShippingProvider({ GOSWEETSPOT_APP_ID: "app" })).toBeNull();
  });

  it("selects local test rates only when explicitly enabled outside production", () => {
    expect(selectShippingProvider({
      ENABLE_LOCAL_TEST_SHIPPING: "true",
      NODE_ENV: "test",
    })?.key).toBe("local-test");
    expect(selectShippingProvider({
      ENABLE_LOCAL_TEST_SHIPPING: "true",
      NODE_ENV: "production",
    })).toBeNull();
  });
});
