import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/server/auth/require-session";
import { createAdminUserRoleRoute } from "./route-handler";

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

describe("admin user role route", () => {
  it("requires role-management permission before reading the request", async () => {
    const changeRole = vi.fn();
    const route = createAdminUserRoleRoute({
      requirePermission: vi.fn().mockRejectedValue(new HttpError("Forbidden", 403)),
      changeRole,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ role: "staff", idempotencyKey: "role-change-0001" }),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(403);
    expect(changeRole).not.toHaveBeenCalled();
  });

  it("updates a role for a same-origin admin request", async () => {
    const changeRole = vi.fn().mockResolvedValue({ id: "user-2", role: "staff", changed: true });
    const route = createAdminUserRoleRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      changeRole,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ role: "staff", idempotencyKey: "role-change-0002" }),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { id: "user-2", role: "staff", changed: true },
    });
  });

  it("forwards the selected form access profile", async () => {
    const changeRole = vi.fn().mockResolvedValue({
      id: "user-2",
      role: "form_staff",
      formPreset: "finance",
      changed: true,
    });
    const route = createAdminUserRoleRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      changeRole,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({
        role: "form_staff",
        formPreset: "finance",
        idempotencyKey: "role-change-form-staff-0001",
      }),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(200);
    expect(changeRole).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: "form_staff", formPreset: "finance" }),
    );
  });

  it("rejects cross-origin role changes", async () => {
    const changeRole = vi.fn();
    const route = createAdminUserRoleRoute({
      requirePermission: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "owner@example.test" },
        adminRole: "admin",
      }),
      changeRole,
      trustedOrigin: origin,
    });
    const response = await route.PATCH(
      request({ role: "admin", idempotencyKey: "role-change-0003" }, "https://attacker.example"),
      { params: Promise.resolve({ userId: "user-2" }) },
    );
    expect(response.status).toBe(403);
    expect(changeRole).not.toHaveBeenCalled();
  });
});
