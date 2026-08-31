import { describe, expect, it, vi } from "vitest";

import {
  createCachedPublicReviewMediaLookup,
  createAdminReviewMediaHandler,
  createPublicReviewMediaHandler,
} from "./customer-review-media-handler";
import type { cachePublicData } from "@/server/cache/public-cache-tags";

const record = {
  storageKey: "private-uploads/review.bin",
  mimeType: "image/png",
  sha256: "a".repeat(64),
};

describe("customer review media handlers", () => {
  it("serves only current public avatar/Featured media with revocation-safe headers", async () => {
    const handler = createPublicReviewMediaHandler({
      findPublic: vi.fn().mockResolvedValue(record),
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });
    const response = await handler.GET(new Request(
      `https://shop.example.test/review-media/00000000-0000-4000-8000-000000000001/avatar?v=${record.sha256}`,
    ), {
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "avatar",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("ETag")).toBe(`"${record.sha256}"`);
  });

  it("keeps legacy URLs revalidation-safe and rejects a stale immutable version", async () => {
    const handler = createPublicReviewMediaHandler({
      findPublic: vi.fn().mockResolvedValue(record),
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });
    const params = {
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "avatar",
    };

    const legacy = await handler.GET(new Request("https://shop.example.test/review-media/id/avatar"), params);
    const stale = await handler.GET(new Request(
      `https://shop.example.test/review-media/id/avatar?v=${"b".repeat(64)}`,
    ), params);

    expect(legacy.headers.get("Cache-Control")).toContain("must-revalidate");
    expect(legacy.headers.get("Cache-Control")).not.toContain("immutable");
    expect(stale.status).toBe(404);
  });

  it("returns a uniform 404 for invalid IDs, evidence, and non-public reviews", async () => {
    const findPublic = vi.fn().mockResolvedValue(null);
    const handler = createPublicReviewMediaHandler({
      findPublic,
      read: vi.fn(),
    });

    const request = new Request("https://shop.example.test/review-media/test/avatar");
    expect((await handler.GET(request, { reviewId: "not-an-id", kind: "avatar" })).status).toBe(404);
    expect((await handler.GET(request, {
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "permission-evidence",
    })).status).toBe(404);
    expect((await handler.GET(request, {
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "featured-image",
    })).status).toBe(404);
  });

  it("reuses cached public metadata for repeated media requests", async () => {
    const findPublic = vi.fn().mockResolvedValue(record);
    const memoryCache = ((loader: (...args: string[]) => Promise<unknown>) => {
      const values = new Map<string, unknown>();
      return async (...args: string[]) => {
        const key = args.join(":");
        if (values.has(key)) return values.get(key);
        const value = await loader(...args);
        values.set(key, value);
        return value;
      };
    }) as typeof cachePublicData;
    const cachedLookup = createCachedPublicReviewMediaLookup(findPublic, memoryCache);
    const handler = createPublicReviewMediaHandler({
      findPublic: cachedLookup,
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });
    const request = new Request(
      `https://shop.example.test/review-media/id/avatar?v=${record.sha256}`,
    );
    const params = {
      reviewId: "00000000-0000-4000-8000-000000000001",
      kind: "avatar",
    };

    await handler.GET(request, params);
    await handler.GET(request, params);

    expect(findPublic).toHaveBeenCalledOnce();
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
