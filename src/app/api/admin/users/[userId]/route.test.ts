import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminUserRoute } from "./route-handler";

const origin = "http://localhost:3000";

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/admin/users/user-2`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "Sec-Fetch-Site": requestOrigin === origin ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("admin user access route", () => {
  it("requires role-management permission before reading the request", async () => {
    const updateAccess = vi.fn();
    const route = createAdminUserRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      updateAccess,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ role: "staff", idempotencyKey: "employee-access-0001" }),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(403);
    expect(updateAccess).not.toHaveBeenCalled();
  });

  it("forwards only explicit exact access fields for a same-origin request", async () => {
    const updateAccess = vi.fn().mockResolvedValue({ id: "user-2", role: "staff", changed: true });
    const route = createAdminUserRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      updateAccess,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({
        role: "staff",
        adminPermissions: ["view_orders"],
        formPermissions: { access_forms: true },
        assignedOnly: true,
        formPreset: "ignored",
        idempotencyKey: "employee-access-0002",
        unexpected: "must-not-reach-service",
      }),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { id: "user-2", role: "staff", changed: true },
    });
    expect(updateAccess).toHaveBeenCalledWith(
      { userId: "admin-1", email: "owner@example.test" },
      {
        targetUserId: "user-2",
        role: "staff",
        adminPermissions: ["view_orders"],
        formPermissions: { access_forms: true },
        assignedOnly: true,
        formPreset: "ignored",
        idempotencyKey: "employee-access-0002",
        requestSource: "direct",
      },
    );
  });

  it("forwards the selected form access profile", async () => {
    const updateAccess = vi.fn().mockResolvedValue({
      id: "user-2",
      role: "form_staff",
      formPreset: "finance",
      changed: true,
    });
    const route = createAdminUserRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      updateAccess,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({
        role: "form_staff",
        formPreset: "finance",
        idempotencyKey: "employee-access-0003",
      }),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(200);
    expect(updateAccess).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      role: "form_staff",
      formPreset: "finance",
    }));
  });

  it("rejects cross-origin role changes", async () => {
    const updateAccess = vi.fn();
    const route = createAdminUserRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      updateAccess,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ role: "admin", idempotencyKey: "employee-access-0004" }, "https://attacker.example"),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(403);
    expect(updateAccess).not.toHaveBeenCalled();
  });
});
