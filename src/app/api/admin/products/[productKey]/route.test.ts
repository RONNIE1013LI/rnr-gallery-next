import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { ProductRegistryConflictError } from "@/server/admin/product-registry-service";
import { createAdminProductRoute } from "./route-handler";

const origin = "http://localhost:3000";
function request(body: unknown) {
  return new Request(`${origin}/api/admin/products/roll-up-banner`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify(body),
  });
}

describe("admin product publication route", () => {
  it("requires price permission before reading or publishing", async () => {
    const publishProduct = vi.fn();
    const route = createAdminProductRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Denied", 403)),
      publishProduct,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(request({}), {
      params: Promise.resolve({ productKey: "roll-up-banner" }),
    });

    expect(response.status).toBe(403);
    expect(publishProduct).not.toHaveBeenCalled();
  });

  it("publishes the route product key with the authenticated actor", async () => {
    const publishProduct = vi.fn().mockResolvedValue({ result: "published", revision: 4 });
    const route = createAdminProductRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
      }),
      publishProduct,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(request({
      expectedRevision: 3,
      idempotencyKey: "product-route-0001",
      title: "Roll-Up Banner",
    }), { params: Promise.resolve({ productKey: "roll-up-banner" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "published", revision: 4 });
    expect(publishProduct).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      expect.objectContaining({ productKey: "roll-up-banner", expectedRevision: 3 }),
    );
  });

  it("returns conflict instead of overwriting a newer publication", async () => {
    const route = createAdminProductRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
      }),
      publishProduct: vi.fn().mockRejectedValue(new ProductRegistryConflictError("Refresh")),
      trustedOrigin: origin,
    });
    const response = await route.PATCH(request({ idempotencyKey: "product-route-0002" }), {
      params: Promise.resolve({ productKey: "roll-up-banner" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Refresh" });
  });
});
