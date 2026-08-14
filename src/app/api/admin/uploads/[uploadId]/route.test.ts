import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminUploadRoute } from "./route-handler";

describe("admin upload route", () => {
  const uploadId = "00000000-0000-4000-8000-000000000000";
  it("authenticates before looking up private upload storage", async () => {
    const find = vi.fn();
    const route = createAdminUploadRoute({ requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)), find, read: vi.fn() });
    const response = await route.GET(new Request(`http://localhost/api/admin/uploads/${uploadId}`), { params: Promise.resolve({ uploadId }) });
    expect(response.status).toBe(403);
    expect(find).not.toHaveBeenCalled();
  });

  it("streams only the resolved private upload with safe headers", async () => {
    const route = createAdminUploadRoute({
      requirePermission: vi.fn().mockResolvedValue({ user: { id: "admin" } }),
      find: vi.fn().mockResolvedValue({ storageKey: "00000000-0000-4000-8000-000000000000.bin", mediaType: "image/png", originalName: "customer photo.png" }),
      read: vi.fn().mockResolvedValue(Buffer.from("image")),
    });
    const response = await route.GET(new Request(`http://localhost/api/admin/uploads/${uploadId}?download=1`), { params: Promise.resolve({ uploadId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
