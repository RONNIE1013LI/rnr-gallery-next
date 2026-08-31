import { describe, expect, it, vi } from "vitest";
import { createAdminPricingPolicyRoute } from "./route-handler";

const origin = "http://localhost:3000";

describe("admin pricing policy route", () => {
  it("publishes only through a trusted same-origin administrator request", async () => {
    const publishPricing = vi.fn().mockResolvedValue({ result: "published", revision: 2 });
    const revalidatePublic = vi.fn();
    const route = createAdminPricingPolicyRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
      }),
      publishPricing,
      trustedOrigin: origin,
      revalidatePublic,
    });
    const response = await route.PATCH(new Request(`${origin}/api/admin/products/pricing-policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({
        expectedRevision: 1,
        idempotencyKey: "pricing-route-0001",
        peoplePetsFeesExGstCents: [4_000, 6_000, 8_500, 11_000, 13_000],
        additionalPeoplePetsEachExGstCents: 2_500,
        urgentServiceFeesInclGstCents: [8_000, 7_000, 6_000, 5_000],
      }),
    }));

    expect(response.status).toBe(200);
    expect(publishPricing).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      expect.objectContaining({ expectedRevision: 1, requestSource: "direct" }),
    );
    expect(revalidatePublic).toHaveBeenCalledOnce();
  });
});
