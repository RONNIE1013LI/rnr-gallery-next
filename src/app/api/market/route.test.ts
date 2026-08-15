import { describe, expect, it, vi } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import { createMarketRoute } from "./route-handler";

const origin = "http://localhost:3000";

function request(market: string, cart?: unknown) {
  return new Request(`${origin}/api/market`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ market, ...(cart ? { cart } : {}) }),
  });
}

describe("market selection route", () => {
  it("persists enabled NZ without identity data", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("NZ"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("rnr-market=NZ");
    expect(response.headers.get("Set-Cookie")).not.toContain("user");
  });

  it("refuses the disabled AU market even when requested directly", async () => {
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 1, registry: defaultProductRegistry }),
      trustedOrigin: origin,
    });
    expect((await route.POST(request("AU"))).status).toBe(409);
  });

  it("returns a full authoritative AUD repricing when changing a non-empty cart", async () => {
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
    const route = createMarketRoute({
      current: vi.fn().mockResolvedValue({ revision: 9, registry: parseProductRegistry(registry) }),
      trustedOrigin: origin,
    });
    const response = await route.POST(request("AU", {
      version: 1,
      items: [{
        clientItemId: "00000000-0000-4000-8000-000000000010",
        productKey: "photo-print-canvas", sizeKey: "a4", orientation: "landscape",
        peoplePets: 0, photoSubmissionMethod: "later", designText: "", notes: "",
        neededDate: "2026-08-24", urgentServiceConfirmed: false, quantity: 1,
        uploadReferences: [],
      }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      market: "AU", currency: "AUD",
      cart: { market: "AU", currency: "AUD", priceBookRevision: 9, totalInclGstCents: 40_000 },
    });
  });
});
