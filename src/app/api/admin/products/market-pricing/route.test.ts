import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { createAdminMarketPricingRoute } from "./route-handler";

const origin = "http://localhost:3000";

describe("admin market pricing route", () => {
  it("publishes the AUD price book only through a trusted administrator request", async () => {
    const publishMarket = vi.fn().mockResolvedValue({ result: "published", revision: 2 });
    const revalidatePublic = vi.fn();
    const route = createAdminMarketPricingRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
      }),
      publishMarket,
      trustedOrigin: origin,
      revalidatePublic,
    });
    const response = await route.PATCH(new Request(
      `${origin}/api/admin/products/market-pricing`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({
          expectedRevision: 1,
          idempotencyKey: "market-pricing-route-0001",
          priceBook: defaultProductRegistry.markets.AU,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(publishMarket).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      expect.objectContaining({
        expectedRevision: 1,
        priceBook: expect.objectContaining({ market: "AU", currency: "AUD" }),
        requestSource: "direct",
      }),
    );
    expect(revalidatePublic).toHaveBeenCalledOnce();
  });
});
