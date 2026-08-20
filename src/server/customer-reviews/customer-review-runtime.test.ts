import { describe, expect, it } from "vitest";

import { getSafePublicCustomerReviewSection } from "./customer-review-runtime";

describe("customer review public runtime", () => {
  it("fails closed to a hidden section when persistence is unavailable", async () => {
    await expect(getSafePublicCustomerReviewSection({
      getSafePublicSection: async () => {
        throw new Error("database unavailable");
      },
    })).resolves.toBeNull();
  });

  it("returns the service DTO unchanged on success", async () => {
    const section = {
      summary: null,
      featured: { id: "review-1" },
      reviews: [],
    } as never;
    await expect(getSafePublicCustomerReviewSection({
      getSafePublicSection: async () => section,
    })).resolves.toBe(section);
  });
});
