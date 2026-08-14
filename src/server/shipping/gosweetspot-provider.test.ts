import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGoSweetSpotShippingProvider } from "./gosweetspot-provider";
import type { ShippingQuoteRequest } from "./types";

const request: ShippingQuoteRequest = {
  cartValueInclGstCents: 12_075,
  packages: [
    {
      productKey: "digital-oil-painting-canvas",
      sizeKey: "a4",
      lengthMm: 220,
      widthMm: 300,
      heightMm: 30,
      weightGrams: 500,
      unitPriceInclGstCents: 6_325,
    },
    {
      productKey: "photo-print-canvas",
      sizeKey: "a3",
      lengthMm: 300,
      widthMm: 430,
      heightMm: 30,
      weightGrams: 1_000,
      unitPriceInclGstCents: 5_750,
    },
  ],
  destination: {
    contact: "Aroha Smith",
    street: "1 Queen Street",
    suburb: "Auckland Central",
    city: "Auckland",
    postcode: "1010",
    countryCode: "NZ",
  },
};

describe("GoSweetSpot shipping provider", () => {
  it("signs the exact raw request and returns the cheapest positive rate", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body);
      expect(JSON.parse(body)).toEqual({
        weight: 1.5,
        cartvalue: 120.75,
        destination: {
          Contact: "Aroha Smith",
          street: "1 Queen Street",
          suburb: "Auckland Central",
          city: "Auckland",
          Country: "NZ",
          Postcode: "1010",
        },
        Products: [
          {
            Quantity: 1,
            UnitWeightKg: 0.5,
            UnitPrice: 63.25,
            UnitLengthCm: 22,
            UnitWidthCm: 30,
            UnitHeightCm: 3,
          },
          {
            Quantity: 1,
            UnitWeightKg: 1,
            UnitPrice: 57.5,
            UnitLengthCm: 30,
            UnitWidthCm: 43,
            UnitHeightCm: 3,
          },
        ],
      });
      expect(new Headers(init?.headers).get("X-GSS-Hmac-Sha256")).toBe(
        createHmac("sha256", "test-secret").update(body).digest("hex"),
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify([
        { description: "Express", shortcode: "EXP", rate: 34.5 },
        { description: "Standard", shortcode: "STD", rate: 23 },
        { description: "Invalid", shortcode: "ZERO", rate: 0 },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = createGoSweetSpotShippingProvider({
      appId: "app/id",
      secret: "test-secret",
      rateTaxMode: "incl_gst",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });

    await expect(provider.availability()).resolves.toEqual({ available: true });
    await expect(provider.quote(request)).resolves.toMatchObject({
      provider: "gosweetspot",
      serviceCode: "STD",
      serviceName: "Standard",
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
      currency: "NZD",
      isTest: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://checkout.gosweetspot.com/CustomApi/Rates/app%2Fid",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("normalizes non-ASCII destination text before signing the GoSweetSpot request", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).destination).toEqual({
        Contact: "Gloria Su'a",
        street: "5, 33 Wrights Road",
        suburb: "Addington",
        city: "Christchurch",
        Country: "NZ",
        Postcode: "8024",
      });
      return new Response(JSON.stringify({
        rates: [
          { description: "South Island", shortCode: null, rate: 36 },
        ],
      }), { status: 200 });
    });
    const provider = createGoSweetSpotShippingProvider({
      appId: "app",
      secret: "secret",
      rateTaxMode: "incl_gst",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const destination = {
      ...request.destination,
      contact: "Gloria Su’a",
      street: "5, 33 Wrights Road",
      suburb: "Addington",
      city: "Christchurch",
      postcode: "8024",
    };

    await expect(provider.quote({ ...request, destination })).resolves.toMatchObject({
      serviceName: "South Island",
      amountInclGstCents: 3_600,
    });
    expect(destination.contact).toBe("Gloria Su’a");
  });

  it("accepts the account Custom API response wrapper and camel-case short code", async () => {
    const provider = createGoSweetSpotShippingProvider({
      appId: "app",
      secret: "secret",
      rateTaxMode: "incl_gst",
      fetchImpl: (async () => new Response(JSON.stringify({
        rates: [
          { description: "Standard Shipping", shortCode: "SD", rate: 5 },
        ],
      }), { status: 200 })) as typeof fetch,
    });

    await expect(provider.quote(request)).resolves.toMatchObject({
      serviceCode: "SD",
      serviceName: "Standard Shipping",
      amountExGstCents: 435,
      gstCents: 65,
      amountInclGstCents: 500,
    });
  });

  it("creates a stable service code when GoSweetSpot returns a null short code", async () => {
    const provider = createGoSweetSpotShippingProvider({
      appId: "app",
      secret: "secret",
      rateTaxMode: "incl_gst",
      fetchImpl: (async () => new Response(JSON.stringify({
        rates: [
          { description: "Standard Shipping", shortCode: null, rate: 5 },
        ],
      }), { status: 200 })) as typeof fetch,
    });

    await expect(provider.quote(request)).resolves.toMatchObject({
      serviceCode: "gss-c0c654766304",
      serviceName: "Standard Shipping",
      amountInclGstCents: 500,
    });
  });

  it("adds GST only when the configured account rate is ex GST", async () => {
    const provider = createGoSweetSpotShippingProvider({
      appId: "app",
      secret: "secret",
      rateTaxMode: "ex_gst",
      fetchImpl: (async () => new Response(JSON.stringify([
        { description: "Standard", shortcode: "STD", rate: 20 },
      ]), { status: 200 })) as typeof fetch,
    });

    await expect(provider.quote(request)).resolves.toMatchObject({
      amountExGstCents: 2_000,
      gstCents: 300,
      amountInclGstCents: 2_300,
    });
  });

  it.each([
    ["missing app id", { appId: "", secret: "secret", rateTaxMode: "incl_gst" as const }],
    ["missing secret", { appId: "app", secret: "", rateTaxMode: "incl_gst" as const }],
    ["missing tax mode", { appId: "app", secret: "", rateTaxMode: undefined }],
  ])("is unavailable for %s", async (_label, config) => {
    const provider = createGoSweetSpotShippingProvider(config);
    await expect(provider.availability()).resolves.toMatchObject({ available: false });
    await expect(provider.quote(request)).rejects.toThrow("unavailable");
  });

  it.each([
    ["HTTP failure", new Response("no", { status: 500 })],
    ["malformed response", new Response(JSON.stringify({ rate: 23 }), { status: 200 })],
    ["no positive rate", new Response(JSON.stringify([
      { description: "None", shortcode: "NONE", rate: 0 },
    ]), { status: 200 })],
  ])("fails closed for %s", async (_label, response) => {
    const provider = createGoSweetSpotShippingProvider({
      appId: "app",
      secret: "secret",
      rateTaxMode: "incl_gst",
      fetchImpl: (async () => response) as typeof fetch,
    });
    await expect(provider.quote(request)).rejects.toThrow();
  });
});
