import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalTestShippingProvider } from "./local-test-provider";
import type { ShippingQuoteRequest } from "./types";

const request: ShippingQuoteRequest = {
  market: "NZ",
  currency: "NZD",
  taxPolicy: { jurisdiction: "NZ_GST", registered: true, rateBasisPoints: 1_500 },
  cartValueInclGstCents: 12_075,
  packages: [{
    productKey: "digital-oil-painting-canvas",
    sizeKey: "a4",
    lengthMm: 220,
    widthMm: 300,
    heightMm: 30,
    weightGrams: 500,
    unitPriceInclGstCents: 6_325,
  }],
  destination: {
    contact: "Aroha Smith",
    street: "1 Queen Street",
    suburb: "Auckland Central",
    city: "Auckland",
    postcode: "1010",
    countryCode: "NZ",
  },
};

describe("local test shipping provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a visibly test-only deterministic quote", async () => {
    const provider = createLocalTestShippingProvider({
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });

    await expect(provider.availability()).resolves.toEqual({ available: true });
    await expect(provider.quote(request)).resolves.toMatchObject({
      provider: "local-test",
      serviceCode: "test-post-nz",
      serviceName: "Test Post — not a live carrier rate",
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
      currency: "NZD",
      isTest: true,
    });
  });

  it("returns an AUD zero-tax quote when Australian GST is disabled", async () => {
    const provider = createLocalTestShippingProvider();

    await expect(provider.quote({
      ...request,
      market: "AU",
      currency: "AUD",
      taxPolicy: { jurisdiction: "NONE", registered: false, rateBasisPoints: 1_000 },
      destination: {
        ...request.destination,
        city: "NSW",
        postcode: "2000",
        countryCode: "AU",
      },
    })).resolves.toMatchObject({
      amountExGstCents: 4_500,
      gstCents: 0,
      amountInclGstCents: 4_500,
      currency: "AUD",
    });
  });

  it("cannot be enabled in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createLocalTestShippingProvider())
      .toThrow("production");
  });

  it("cannot bypass the real production environment with a caller override", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createLocalTestShippingProvider({ nodeEnv: "test" } as never))
      .toThrow("production");
  });
});
