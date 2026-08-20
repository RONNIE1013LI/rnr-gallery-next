import { describe, expect, it, vi } from "vitest";

import {
  createAdminReviewMediaHandler,
  createPublicReviewMediaHandler,
} from "./customer-review-media-handler";

const record = {
  storageKey: "private-uploads/review.bin",
  mimeType: "image/png",
};

describe("customer review media handlers", () => {
  it("serves only current public avatar/Featured media with revocation-safe headers", async () => {
    const handler = createPublicReviewMediaHandler({
      findPublic: vi.fn().mockResolvedValue(record),
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });
    const response = await handler.GET({
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "avatar",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("must-revalidate");
    expect(response.headers.get("Cache-Control")).not.toContain("immutable");
  });

  it("returns a uniform 404 for invalid IDs, evidence, and non-public reviews", async () => {
    const findPublic = vi.fn().mockResolvedValue(null);
    const handler = createPublicReviewMediaHandler({
      findPublic,
      read: vi.fn(),
    });

    expect((await handler.GET({ reviewId: "not-an-id", kind: "avatar" })).status).toBe(404);
    expect((await handler.GET({
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "permission-evidence",
    })).status).toBe(404);
    expect((await handler.GET({
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "featured-image",
    })).status).toBe(404);
  });

  it("requires manage_reviews before serving private Admin evidence", async () => {
    const requirePermission = vi.fn().mockResolvedValue({});
    const handler = createAdminReviewMediaHandler({
      requirePermission,
      findAdmin: vi.fn().mockResolvedValue(record),
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });

    const response = await handler.GET({
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "permission-evidence",
    });
    expect(requirePermission).toHaveBeenCalledWith("manage_reviews");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
