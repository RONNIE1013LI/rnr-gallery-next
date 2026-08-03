import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminGalleryCollectionRoute } from "./route";

describe("admin gallery collection route", () => {
  it("returns 401/403 before reading gallery data", async () => {
    for (const status of [401, 403]) {
      const list = vi.fn();
      const route = createAdminGalleryCollectionRoute({
        requireAdmin: vi.fn().mockRejectedValue(new HttpError("Denied", status)),
        list,
        create: vi.fn(),
        trustedOrigin: "http://localhost:3000",
      });
      const response = await route.GET(new Request("http://localhost:3000/api/admin/design-gallery"));
      expect(response.status).toBe(status);
      expect(list).not.toHaveBeenCalled();
    }
  });

  it("rejects a cross-origin multipart mutation", async () => {
    const create = vi.fn();
    const route = createAdminGalleryCollectionRoute({
      requireAdmin: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
      list: vi.fn(), create, trustedOrigin: "http://localhost:3000",
    });
    const response = await route.POST(new Request("http://localhost:3000/api/admin/design-gallery", {
      method: "POST", headers: { Origin: "https://evil.test" }, body: new FormData(),
    }));
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
