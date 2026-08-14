import { describe, expect, it, vi } from "vitest";
import { createProductionProofReviewsRoute } from "./route-handler";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";

describe("production proof review route", () => {
  it("records a same-origin immutable decision as the current staff member", async () => {
    const recordReview = vi.fn().mockResolvedValue({ result: "created", review: { id: "review-1" } });
    const route = createProductionProofReviewsRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "staff-1", email: "staff@example.com" }, adminRole: "staff" }),
      recordReview,
      trustedOrigin: "https://shop.example.test",
    });
    const response = await route.POST(new Request(`https://shop.example.test/api/admin/jobs/${jobId}/proof-reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://shop.example.test", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ fileId: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819", decision: "approved", notes: "Ready", idempotencyKey: "review-request-1" }),
    }), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(201);
    expect(recordReview).toHaveBeenCalledWith(
      { userId: "staff-1", email: "staff@example.com" }, jobId,
      { fileId: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819", decision: "approved", notes: "Ready", idempotencyKey: "review-request-1" },
    );
  });
});
