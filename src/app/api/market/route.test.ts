import { describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import { createMarketRoute } from "./route-handler";

const origin = "http://localhost:3000";

function request(market: string, cart?: unknown, headers: HeadersInit = {}) {
  return new Request(`${origin}/api/market`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify({ market, ...(cart ? { cart } : {}) }),
  });
}

function enabledAuRegistry(urgentServiceFee = 10_000) {
  const registry = structuredClone(defaultProductRegistry);
  const australia = registry.markets.AU;
  for (const product of australia.products) {
    for (const size of product.sizes) size.amountInclTaxCents = 40_000;
    for (const charge of product.charges) charge.amountInclTaxCents = 3_000;
  }
  for (const fee of australia.peoplePets.fees) fee.amountInclTaxCents = fee.count * 6_000;
  australia.peoplePets.additionalEachInclTaxCents = 4_000;
  for (const fee of australia.urgentServiceFees) fee.amountInclTaxCents = urgentServiceFee;
  for (const shipping of australia.shippingMethods) shipping.amountInclTaxCents = 4_500;
  australia.enabled = true;
  return parseProductRegistry(registry);
}

function urgentCart() {
  return {
    version: 1,
    items: [{
      clientItemId: "00000000-0000-4000-8000-000000000010",
      productKey: "custom-themed-canvas", sizeKey: "a3", orientation: "landscape",
      peoplePets: 0, photoSubmissionMethod: "upload", designText: "Family portrait",
      notes: "Warm colours", neededDate: "2026-08-28", urgentServiceConfirmed: false,
      quantity: 1, uploadReferences: ["00000000-0000-4000-8000-000000000001"],
    }],
  };
}

describe("market selection route", () => {
  it("persists the unchanged enabled-market success payload without identity data", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("NZ"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("rnr-market=NZ");
    expect(response.headers.get("Set-Cookie")).not.toContain("user");
    expect(await response.json()).toEqual({ market: "NZ", currency: "NZD" });
  });

  it("returns a stable unavailable-market failure without setting a cookie", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("AU"));

    expect(response.status).toBe(409);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "This market is not available yet.",
      code: "market_unavailable",
    });
  });

  it("returns a stable unsupported-market failure without setting a cookie", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("US"));

    expect(response.status).toBe(422);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "Choose a supported market.",
      code: "unsupported_market",
    });
  });

  it("returns a safe invalid-cart failure without setting a cookie", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("NZ", { version: 1, items: [] }));

    expect(response.status).toBe(409);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "The cart could not be repriced for this market.",
      code: "invalid_cart",
    });
  });

  it("returns actionable target-market urgent issues without setting a cookie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 9, registry: enabledAuRegistry() }),
      trustedOrigin: origin,
    });

    try {
      const response = await route.POST(request("AU", urgentCart()));

      expect(response.status).toBe(409);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await response.json()).toEqual({
        error: "Confirm urgent service or choose another completion date.",
        code: "urgent_confirmation_required",
        issues: expect.arrayContaining([
          expect.objectContaining({
            clientItemId: "00000000-0000-4000-8000-000000000010",
            currency: "AUD",
          }),
        ]),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expose unknown runtime details", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockRejectedValue(new Error("registry internals leaked")),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("NZ"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "The market could not be changed.",
      code: "market_switch_failed",
    });
  });

  it("keeps trusted-origin failures safe and structured", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("NZ", undefined, {
      Origin: "https://untrusted.example",
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "The market could not be changed.",
      code: "market_switch_failed",
    });
  });

  it("returns ready for an authoritative AUD cart beyond the urgent fee bands", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 9, registry: enabledAuRegistry() }),
      trustedOrigin: origin,
    });
    try {
      const response = await route.POST(request("AU", {
        version: 1,
        items: [{
          clientItemId: "00000000-0000-4000-8000-000000000010",
          productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape",
          peoplePets: 0, photoSubmissionMethod: "later", designText: "", notes: "",
          neededDate: "2026-09-24", urgentServiceConfirmed: false, quantity: 1,
          uploadReferences: [],
        }],
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        market: "AU", currency: "AUD",
        cart: { market: "AU", currency: "AUD", priceBookRevision: 9, totalInclGstCents: 40_000 },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
