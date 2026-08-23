import { describe, expect, it, vi } from "vitest";
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
import { AUSTRALIA_FIXED_SHIPPING_RATES } from "./australia-fixed-shipping";
import type { ShippingQuoteProvider, ShippingQuoteRequest } from "./types";

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

function australianFixture(
  input: unknown = cartInput(),
  tax: { registered: boolean; rateBasisPoints: number } = {
    registered: false,
    rateBasisPoints: 1_000,
  },
) {
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
  registry.markets.AU.tax = tax;
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
  it("keeps the complete confirmed Australia fixed-rate table", () => {
    expect(AUSTRALIA_FIXED_SHIPPING_RATES).toEqual({
      canvas: {
        a4: { standard: 4_500, dhlExpress: 6_600 },
        a3: { standard: 4_500, dhlExpress: 6_600 },
        a2: { standard: 4_500, dhlExpress: 6_600 },
        a1: { standard: 5_500, dhlExpress: 7_800 },
        a0: { standard: 12_000, dhlExpress: 18_600 },
      },
      rollUpBanner: { standard: 6_500, dhlExpress: 8_200 },
      wallBanner: {
        "160x80": { standard: 4_000, dhlExpress: 7_800 },
        "200x100": { standard: 4_000, dhlExpress: 7_800 },
        "300x150": { standard: 11_000, dhlExpress: 14_800 },
      },
    });
  });

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

  it("quotes an AU Bundle from the fixed component table without calling a provider", async () => {
    const quoteProvider = provider({
      key: "gosweetspot",
      quote: vi.fn().mockRejectedValue(new Error("GoSweetSpot is unavailable")),
    });
    const fixture = australianFixture(bannerBundleCartInput(2));
    const service = createShippingService({ provider: quoteProvider, now: () => now });

    const result = await service.quotePost(
      fixture.cart,
      fixture.address,
      fixture.registry.markets.AU,
    );

    expect(quoteProvider.availability).not.toHaveBeenCalled();
    expect(quoteProvider.quote).not.toHaveBeenCalled();
    expect(result.option).toMatchObject({
      serviceCode: "au-standard",
      currency: "AUD",
      provenance: "internal-fixed",
      amountInclGstCents: 21_000,
    });
    expect(result.options).toMatchObject([
      { serviceCode: "au-standard", amountInclGstCents: 21_000 },
      { serviceCode: "au-dhl-express", amountInclGstCents: 32_000 },
    ]);
  });

  it("selects DHL Express explicitly while keeping Standard as the default", async () => {
    const fixture = australianFixture();
    const service = createShippingService({ provider: null, now: () => now });

    const standard = await service.quotePost(
      fixture.cart,
      fixture.address,
      fixture.registry.markets.AU,
    );
    const express = await service.quotePost(
      fixture.cart,
      fixture.address,
      fixture.registry.markets.AU,
      "au-dhl-express",
    );

    expect(standard.option).toMatchObject({
      serviceCode: "au-standard",
      amountInclGstCents: 4_500,
    });
    expect(express.option).toMatchObject({
      serviceCode: "au-dhl-express",
      amountInclGstCents: 6_600,
    });
  });

  it("keeps a fixed AUD total when Australian GST is enabled and splits tax from that total", async () => {
    const fixture = australianFixture(cartInput(), {
      registered: true,
      rateBasisPoints: 1_000,
    });

    const result = await createShippingService({ provider: null, now: () => now }).quotePost(
      fixture.cart,
      fixture.address,
      fixture.registry.markets.AU,
    );

    expect(result.option).toMatchObject({
      amountExGstCents: 4_091,
      gstCents: 409,
      amountInclGstCents: 4_500,
      currency: "AUD",
    });
  });

  it("adds the fixed Australia rate once for every physical item", async () => {
    const fixture = australianFixture({
      ...cartInput(),
      items: [{ ...cartInput().items[0], sizeKey: "a1", quantity: 3 }],
    });

    const result = await createShippingService({ provider: null, now: () => now })
      .quotePost(fixture.cart, fixture.address, fixture.registry.markets.AU);

    expect(result.option.amountInclGstCents).toBe(16_500);
    expect(result.options[1].amountInclGstCents).toBe(23_400);
  });

  it.each([
    ["custom-themed-wall-banner", "160x80"],
    ["digital-oil-painting-banner", "160x80"],
    ["grave-cover", "standard"],
  ])("prices %s:%s in the same fixed class as a 200 x 100 Wall Banner", async (
    productKey,
    sizeKey,
  ) => {
    const fixture = australianFixture({
      ...cartInput(),
      items: [{
        ...cartInput().items[0],
        productKey,
        sizeKey,
        orientation: undefined,
        peoplePets: productKey === "digital-oil-painting-banner" ? 1 : 0,
      }],
    });

    const result = await createShippingService({ provider: null, now: () => now })
      .quotePost(fixture.cart, fixture.address, fixture.registry.markets.AU);

    expect(result.options).toMatchObject([
      { serviceCode: "au-standard", amountInclGstCents: 4_000 },
      { serviceCode: "au-dhl-express", amountInclGstCents: 7_800 },
    ]);
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
