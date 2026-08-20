import { describe, expect, it, vi } from "vitest";

import { createAdminCustomerReviewSettingsRoute } from "./route-handler";

const origin = "https://shop.example.test";
const access = { user: { id: "admin-1", email: "admin@example.test" } };
const input = {
  action: "publish",
  facebookRating: 5,
  facebookRecommendationCount: 285,
  facebookCountIsApproximate: true,
  facebookReviewsPageUrl: "https://www.facebook.com/RandRgallery/reviews/",
  facebookLastVerifiedAt: "2026-08-20",
};

describe("Admin customer review settings route", () => {
  it("separates manage and publish permissions and revalidates published settings", async () => {
    const requirePermission = vi.fn().mockResolvedValue(access);
    const save = vi.fn().mockResolvedValue({ draft: input, published: input });
    const revalidate = vi.fn();
    const route = createAdminCustomerReviewSettingsRoute({
      requirePermission,
      get: vi.fn().mockResolvedValue({ draft: null, published: null }),
      save,
      origin,
      revalidate,
    });
    const response = await route.PATCH(new Request(
      `${origin}/api/admin/customer-reviews/settings`,
      {
        method: "PATCH",
        headers: {
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    ));

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenNthCalledWith(1, "manage_reviews");
    expect(requirePermission).toHaveBeenNthCalledWith(2, "publish_reviews");
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.anything(), { publish: true });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});
