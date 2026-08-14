import { describe, expect, it, vi } from "vitest";
import { createFormsProofReviewsRoute } from "./route-handler";

const jobId = "de31f47e-0fb9-438e-bef6-6bc45556d3bb";

describe("forms proof review route", () => {
  it("records a trusted decision after production-status and scope checks", async () => {
    const access = {
      user: { id: "staff-1", email: "staff@example.test" }, formRole: "form_staff" as const,
      formProfile: { preset: "manager" as const, assignedOnly: false, permissions: { update_production_status: true } as never },
    };
    const assertScope = vi.fn().mockResolvedValue(undefined);
    const recordReview = vi.fn().mockResolvedValue({ result: "created", review: { id: "review-1" } });
    const route = createFormsProofReviewsRoute({
      requirePermission: vi.fn().mockResolvedValue(access), assertScope, recordReview,
      trustedOrigin: "https://shop.example.test",
    });
    const body = { fileId: "e23a9f59-bf54-4bb6-a7d0-9239c14cf819", decision: "approved", notes: "Ready", idempotencyKey: "review-request-1" };
    const response = await route.POST(new Request(`https://shop.example.test/api/forms/jobs/${jobId}/proof-reviews`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shop.example.test" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(201);
    expect(assertScope).toHaveBeenCalledWith(access, jobId);
    expect(recordReview).toHaveBeenCalledWith({ userId: "staff-1", email: "staff@example.test" }, jobId, body);
  });
});
