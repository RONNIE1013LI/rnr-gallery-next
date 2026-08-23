import { afterEach, describe, expect, it, vi } from "vitest";
import { repriceCart } from "@/domain/checkout/reprice-cart";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import type { NormalizedAddress } from "@/domain/address/types";
import { includedTaxFromGross } from "@/domain/markets/market";
import {
  createShippingService,
  selectShippingProvider,
  ShippingUnavailableError,
} from "./shipping-service";
import type { ShippingQuoteProvider, ShippingQuoteRequest } from "./types";

const now = new Date("2026-08-02T12:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});
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
    quote: vi.fn().mockImplementation((request: ShippingQuoteRequest) => {
      const amountInclGstCents = request.market === "AU" ? 3_000 : 2_300;
      const tax = includedTaxFromGross(amountInclGstCents, request.taxPolicy);
      return Promise.resolve({
        provider: "local-test" as const,
        serviceCode: `test-post-${request.market.toLowerCase()}`,
        serviceName: "Test Post — not a live carrier rate",
        amountExGstCents: tax.amountExTaxCents,
        gstCents: tax.taxCents,
        amountInclGstCents: tax.amountInclTaxCents,
        currency: request.currency,
        providerReference: "test-ref",
        expiresAt: new Date("2026-08-02T12:15:00.000Z"),
        rawResponseHash: "a".repeat(64),
        isTest: true,
      });
    }),
    ...overrides,
  };
}

function australianFixture(input: unknown = cartInput()) {
  const registry = structuredClone(defaultProductRegistry);
  for (const product of registry.markets.AU.products) {
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents = 3_000;
  }
  for (const fee of registry.markets.AU.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6_000;
  registry.markets.AU.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of registry.markets.AU.urgentServiceFees) fee.amountInclTaxCents = 10_000;
  for (const shipping of registry.markets.AU.shippingMethods) shipping.amountInclTaxCents = 4_500;
  registry.markets.AU.enabled = true;
  const parsed = parseProductRegistry(registry);
  return {
    registry: parsed,
    cart: repriceCart(input, { now, registry: parsed, market: "AU", registryRevision: 9 }),
    address: { ...address, country: "AU" as const, region: "NSW", phone: "+61412345678" },
  };
}

function cartInput() {
  return {
    version: 1 as const,
    items: [{
      clientItemId: "00000000-0000-4000-8000-000000000010",
      productKey: "photo-print-canvas",
      sizeKey: "a4",
      orientation: "landscape" as const,
      peoplePets: 0,
      photoSubmissionMethod: "later" as const,
      designText: "Family portrait",
      notes: "Warm colours",
      neededDate: "2026-08-10",
      urgentServiceConfirmed: false,
      quantity: 1,
      uploadReferences: [],
    }],
  };
}

function bannerBundleCartInput(quantity = 1, sizeKey = "rollup-wall-200x100") {
  return {
    version: 1 as const,
    items: [{
      clientItemId: "00000000-0000-4000-8000-000000000010",
      productKey: "banner-bundle",
      sizeKey,
      peoplePets: 0,
      photoSubmissionMethod: "later" as const,
      designText: "",
      notes: "",
      neededDate: "2026-08-10",
      urgentServiceConfirmed: false,
      quantity,
      uploadReferences: [],
      bundleComponents: [
        {
          componentKey: "roll-up" as const,
          photoSubmissionMethod: "later" as const,
          designText: "Roll-Up wording",
          notes: "Roll-Up instructions",
          uploadReferences: [],
        },
        {
          componentKey: "wall-banner" as const,
          photoSubmissionMethod: "later" as const,
          designText: "Wall Banner wording",
          notes: "Wall Banner instructions",
          uploadReferences: [],
        },
      ],
    }],
  };
}

function bannerBundleCart(quantity = 1, sizeKey = "rollup-wall-200x100") {
  return repriceCart(bannerBundleCartInput(quantity, sizeKey), { now });
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
        expect.objectContaining({
          productKey: "photo-print-canvas",
          sizeKey: "a4",
          unitPriceInclGstCents: 7_475,
        }),
        expect.objectContaining({
          productKey: "photo-print-canvas",
          sizeKey: "a4",
          unitPriceInclGstCents: 7_475,
        }),
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

  it("sends one Roll-Up and one Wall Banner package per Bundle quantity", async () => {
    const quoteProvider = provider();
    const service = createShippingService({ provider: quoteProvider, now: () => now });

    await service.quotePost(bannerBundleCart(2), address);

    expect(quoteProvider.quote).toHaveBeenCalledWith(expect.objectContaining({
      cartValueInclGstCents: 71_998,
      packages: [
        expect.objectContaining({
          productKey: "roll-up-banner",
          sizeKey: "standard",
          lengthMm: 900,
          weightGrams: 3_000,
          unitPriceInclGstCents: 27_000,
        }),
        expect.objectContaining({
          productKey: "custom-themed-wall-banner",
          sizeKey: "200x100",
          lengthMm: 1_040,
          weightGrams: 1_000,
          unitPriceInclGstCents: 8_999,
        }),
        expect.objectContaining({
          productKey: "roll-up-banner",
          sizeKey: "standard",
          unitPriceInclGstCents: 27_000,
        }),
        expect.objectContaining({
          productKey: "custom-themed-wall-banner",
          sizeKey: "200x100",
          unitPriceInclGstCents: 8_999,
        }),
      ],
    }));
    const sentPackages = vi.mocked(quoteProvider.quote).mock.calls[0][0].packages;
    expect([
      sentPackages.slice(0, 2).reduce((sum, item) => sum + item.unitPriceInclGstCents, 0),
      sentPackages.slice(2, 4).reduce((sum, item) => sum + item.unitPriceInclGstCents, 0),
    ]).toEqual([35_999, 35_999]);
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

  it("quotes an AU Bundle from carrier packages", async () => {
    const quoteProvider = provider({
      key: "gosweetspot",
      quote: vi.fn().mockImplementation((request: ShippingQuoteRequest) => {
        const tax = includedTaxFromGross(3_000, request.taxPolicy);
        return Promise.resolve({
          provider: "gosweetspot" as const,
          serviceCode: "au-standard",
          serviceName: "AU standard",
          amountExGstCents: tax.amountExTaxCents,
          gstCents: tax.taxCents,
          amountInclGstCents: tax.amountInclTaxCents,
          currency: request.currency,
          providerReference: "gosweetspot-au-ref",
          expiresAt: new Date("2026-08-02T12:15:00.000Z"),
          rawResponseHash: "h".repeat(64),
          isTest: false,
        });
      }),
    });
    const fixture = australianFixture(bannerBundleCartInput(2));
    const service = createShippingService({ provider: quoteProvider, now: () => now });

    const result = await service.quotePost(
      fixture.cart,
      fixture.address,
      fixture.registry.markets.AU,
    );

    expect(quoteProvider.quote).toHaveBeenCalledWith(expect.objectContaining({
      market: "AU",
      currency: "AUD",
      taxPolicy: {
        jurisdiction: "NONE",
        registered: false,
        rateBasisPoints: 1_000,
      },
      destination: expect.objectContaining({ countryCode: "AU", city: "NSW" }),
    }));
    expect(vi.mocked(quoteProvider.quote).mock.calls[0][0].packages).toHaveLength(4);
    expect(result.option).toMatchObject({
      currency: "AUD",
      provenance: "gosweetspot",
      amountInclGstCents: 3_000,
    });
  });

  it.each([
    ["a missing provider", null],
    ["a NZD quote", provider({ quote: vi.fn().mockResolvedValue({
      provider: "local-test", serviceCode: "wrong-currency", serviceName: "Wrong currency",
      amountExGstCents: 3_000, gstCents: 0, amountInclGstCents: 3_000, currency: "NZD",
      providerReference: "wrong-currency", expiresAt: new Date("2026-08-02T12:15:00.000Z"),
      rawResponseHash: "e".repeat(64), isTest: true,
    }) })],
    ["an expired AUD quote", provider({ quote: vi.fn().mockResolvedValue({
      provider: "local-test", serviceCode: "expired", serviceName: "Expired",
      amountExGstCents: 3_000, gstCents: 0, amountInclGstCents: 3_000, currency: "AUD",
      providerReference: "expired", expiresAt: now,
      rawResponseHash: "f".repeat(64), isTest: true,
    }) })],
    ["a non-positive AUD quote", provider({ quote: vi.fn().mockResolvedValue({
      provider: "local-test", serviceCode: "free", serviceName: "Free",
      amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, currency: "AUD",
      providerReference: "free", expiresAt: new Date("2026-08-02T12:15:00.000Z"),
      rawResponseHash: "g".repeat(64), isTest: true,
    }) })],
  ])("does not fall back to fixed AU shipping for %s", async (_name, quoteProvider) => {
    const fixture = australianFixture();

    await expect(
      createShippingService({ provider: quoteProvider, now: () => now })
        .quotePost(fixture.cart, fixture.address, fixture.registry.markets.AU),
    ).rejects.toBeInstanceOf(ShippingUnavailableError);
  });

  it("rejects a destination whose country does not match the repriced cart market", async () => {
    await expect(
      createShippingService({ provider: provider(), now: () => now })
        .quotePost(cart(), { ...address, country: "AU", region: "NSW", phone: "+61412345678" }),
    ).rejects.toThrow("destination does not match");
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
  it("passes an explicit staging environment to GoSweetSpot", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      rates: [{ description: "Test Shipping", shortCode: "TEST", rate: 5 }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const selected = selectShippingProvider({
      GOSWEETSPOT_APP_ID: "staging-app",
      GOSWEETSPOT_HMAC_SECRET: "staging-secret",
      GOSWEETSPOT_RATE_TAX_MODE: "incl_gst",
      GOSWEETSPOT_ENVIRONMENT: "staging",
    });

    await createShippingService({ provider: selected, now: () => now }).quotePost(cart(), address);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://stg-checkout.gosweetspot.com/CustomApi/Rates/staging-app",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects an unknown GoSweetSpot environment", () => {
    expect(selectShippingProvider({
      GOSWEETSPOT_APP_ID: "app",
      GOSWEETSPOT_HMAC_SECRET: "secret",
      GOSWEETSPOT_RATE_TAX_MODE: "incl_gst",
      GOSWEETSPOT_ENVIRONMENT: "typo",
    })).toBeNull();
  });

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
