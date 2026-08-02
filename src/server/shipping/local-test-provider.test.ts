import { describe, expect, it } from "vitest";
import { createLocalTestShippingProvider } from "./local-test-provider";
import type { ShippingQuoteRequest } from "./types";

const request: ShippingQuoteRequest = {
  cartValueInclGstCents: 12_075,
  packages: [{
    productKey: "digital-oil-painting-canvas",
    sizeKey: "a4",
    lengthMm: 220,
    widthMm: 300,
    heightMm: 30,
    weightGrams: 500,
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
  it("returns a visibly test-only deterministic quote", async () => {
    const provider = createLocalTestShippingProvider({
      nodeEnv: "test",
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

  it("cannot be enabled in production", () => {
    expect(() => createLocalTestShippingProvider({ nodeEnv: "production" }))
      .toThrow("production");
  });
});
