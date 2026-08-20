import { describe, expect, it, vi } from "vitest";

import { createAdminCustomerReviewRoute } from "./route-handler";

const origin = "https://shop.example.test";
const reviewId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ reviewId }) };
const access = { user: { id: "admin-1", email: "admin@example.test" } };

function jsonRequest(body: unknown) {
  return new Request(`${origin}/api/admin/customer-reviews/${reviewId}`, {
    method: "PATCH",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Admin customer review item route", () => {
  it("returns a safe 404 for an invalid ID without querying", async () => {
    const get = vi.fn();
    const route = createAdminCustomerReviewRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      get,
      update: vi.fn(),
      archive: vi.fn(),
      origin,
      revalidate: vi.fn(),
    });

    const response = await route.GET({ params: Promise.resolve({ reviewId: "invalid" }) });
    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("archives with manage_reviews and revalidates a previously published review", async () => {
    const requirePermission = vi.fn().mockResolvedValue(access);
    const revalidate = vi.fn();
    const route = createAdminCustomerReviewRoute({
      requirePermission,
      get: vi.fn().mockResolvedValue({ id: reviewId, status: "PUBLISHED" }),
      update: vi.fn(),
      archive: vi.fn().mockResolvedValue({ id: reviewId, status: "ARCHIVED" }),
      origin,
      revalidate,
    });

    const response = await route.PATCH(jsonRequest({ action: "archive" }), context);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("manage_reviews");
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("requires publish_reviews before changing already-published public content", async () => {
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createAdminCustomerReviewRoute({
      requirePermission,
      get: vi.fn().mockResolvedValue({ id: reviewId, status: "PUBLISHED" }),
      update: vi.fn(),
      archive: vi.fn(),
      origin,
      revalidate: vi.fn(),
    });

    const form = new FormData();
    form.set("action", "save_draft");
    const request = new Request(`${origin}/api/admin/customer-reviews/${reviewId}`, {
      method: "PUT",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
      body: form,
    });
    await route.PUT(request, context);

    expect(requirePermission).toHaveBeenCalledWith("publish_reviews");
  });
});
