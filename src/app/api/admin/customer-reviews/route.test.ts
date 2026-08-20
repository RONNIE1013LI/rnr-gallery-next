import { describe, expect, it, vi } from "vitest";

import { createAdminCustomerReviewsRoute, reviewMediaFiles } from "./route-handler";

const origin = "https://shop.example.test";
const access = { user: { id: "admin-1", email: "admin@example.test" } };

function reviewForm(action: "save_draft" | "publish") {
  const form = new FormData();
  form.set("action", action);
  form.set("reviewerName", "R&R customer");
  form.set("originalReviewText", "A beautiful canvas.");
  form.set("sourceReviewUrl", "https://www.facebook.com/RandRgallery/reviews/");
  form.set("reviewDate", "2026-08-10");
  form.set("recommendationStatus", "RECOMMENDS");
  form.set("editorialHeadline", "");
  form.set("productKey", "");
  form.set("productDisplayLabel", "");
  form.set("orderContext", "");
  form.set("isHomepageFeatured", "false");
  form.set("displayOrder", "0");
  form.set("permissionStatus", "GRANTED");
  form.set("permissionEvidenceReference", "");
  form.set("permissionNotes", "");
  form.set("lastVerifiedAt", "");
  return form;
}

function request(form: FormData) {
  return new Request(`${origin}/api/admin/customer-reviews`, {
    method: "POST",
    headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
    body: form,
  });
}

describe("Admin customer reviews collection route", () => {
  it("requires manage_reviews to list and create", async () => {
    const requirePermission = vi.fn().mockResolvedValue(access);
    const route = createAdminCustomerReviewsRoute({
      requirePermission,
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "review-1" }),
      origin,
      revalidate: vi.fn(),
    });

    expect((await route.GET()).status).toBe(200);
    expect((await route.POST(request(reviewForm("save_draft")))).status).toBe(201);
    expect(requirePermission).toHaveBeenCalledWith("manage_reviews");
  });

  it("requires publish_reviews and revalidates both homepages only for publication", async () => {
    const requirePermission = vi.fn().mockResolvedValue(access);
    const revalidate = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: "review-1", status: "PUBLISHED" });
    const route = createAdminCustomerReviewsRoute({
      requirePermission,
      list: vi.fn(),
      create,
      origin,
      revalidate,
    });

    expect((await route.POST(request(reviewForm("publish")))).status).toBe(201);
    expect(requirePermission).toHaveBeenNthCalledWith(1, "manage_reviews");
    expect(requirePermission).toHaveBeenNthCalledWith(2, "publish_reviews");
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: "admin-1",
      email: "admin@example.test",
    }), { publish: true, media: [] });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("maps uploaded media into the combined mutation input", () => {
    const avatar = {
      name: "avatar.png",
      type: "image/png",
      size: 6,
      arrayBuffer: async () => new TextEncoder().encode("avatar").buffer,
    };
    const form = {
      get: (field: string) => field === "avatar" ? avatar : null,
    } as unknown as FormData;

    expect(reviewMediaFiles(form)).toEqual([{ kind: "AVATAR", file: avatar }]);
  });

  it("rejects cross-origin multipart mutations before persistence", async () => {
    const create = vi.fn();
    const route = createAdminCustomerReviewsRoute({
      requirePermission: vi.fn().mockResolvedValue(access),
      list: vi.fn(),
      create,
      origin,
      revalidate: vi.fn(),
    });
    const crossOrigin = new Request(`${origin}/api/admin/customer-reviews`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      body: reviewForm("save_draft"),
    });

    expect((await route.POST(crossOrigin)).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
