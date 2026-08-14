import { describe, expect, it, vi } from "vitest";
import { createCustomerProofReviewRoute } from "./route-handler";

const context = { params: Promise.resolve({ orderNumber: "RNR-2026-ABC123" }) };
const body = {
  fileId: "10000000-0000-4000-8000-000000000001",
  decision: "approved",
  notes: "",
  idempotencyKey: "customer-review-123",
};

describe("customer proof review route", () => {
  it("fails closed when neither order ownership nor a signed proof link is valid", async () => {
    const route = createCustomerProofReviewRoute({
      resolveAccess: vi.fn().mockResolvedValue(null),
      recordReview: vi.fn(),
      trustedOrigin: "https://shop.example",
    });

    const response = await route.POST(new Request("https://shop.example/api/orders/RNR-2026-ABC123/proof-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://shop.example" },
      body: JSON.stringify(body),
    }), context);

    expect(response.status).toBe(404);
  });

  it("records one same-origin customer decision with the verified access scope", async () => {
    const recordReview = vi.fn().mockResolvedValue({ result: "created", review: { id: "review-1" } });
    const route = createCustomerProofReviewRoute({
      resolveAccess: vi.fn().mockResolvedValue({ kind: "signed", fileId: body.fileId }),
      recordReview,
      trustedOrigin: "https://shop.example",
    });

    const response = await route.POST(new Request("https://shop.example/api/orders/RNR-2026-ABC123/proof-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://shop.example" },
      body: JSON.stringify({ ...body, expires: "1900000000", signature: "a".repeat(64) }),
    }), context);

    expect(response.status).toBe(201);
    expect(recordReview).toHaveBeenCalledWith(
      "RNR-2026-ABC123",
      { kind: "signed", fileId: body.fileId },
      body,
    );
  });
});
