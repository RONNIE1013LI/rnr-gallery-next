// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAdminUserRoute } from "./route-handler";
import { StaffSecurityError } from "@/server/auth/staff-security-runtime";
import { HttpError } from "@/server/auth/require-session";

const origin = "https://isolated.example.test";
function request() {
  return new Request(`${origin}/api/admin/users/employee-1`, {
    method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "customer", idempotencyKey: "access-change-1" }),
  });
}
function setup(error?: Error) {
  const requirePermission = vi.fn(async () => {
    if (error) throw error;
    return { user: { id: "admin-1", email: "admin@example.test" } };
  });
  const updateAccess = vi.fn(async () => ({ id: "employee-1", role: "customer" as const, changed: true, formPreset: null, adminPermissions: null, formPermissions: null, assignedOnly: null }));
  const recordFailure = vi.fn();
  return { requirePermission, updateAccess, recordFailure, route: createAdminUserRoute({ requirePermission, updateAccess, recordFailure, trustedOrigin: origin }) };
}
const context = { params: Promise.resolve({ userId: "employee-1" }) };

describe("admin user access PATCH", () => {
  it.each(["mfa_required", "step_up_required"] as const)("returns a safe %s code without saving stale verification", async (reason) => {
    const error = Object.assign(new StaffSecurityError(reason), { sessionId: "private-session", secret: "private-factor" });
    const { route, requirePermission, updateAccess } = setup(error);
    const response = await route.PATCH(request(), context);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: error.message, code: reason });
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(updateAccess).not.toHaveBeenCalled();
  });

  it.each([new HttpError("Unauthorized", 401), new StaffSecurityError("expired"), new StaffSecurityError("disabled")])("keeps ordinary authentication failures free of verification codes", async (error) => {
    const { route, updateAccess } = setup(error);
    const response = await route.PATCH(request(), context);
    expect(response.status).toBe(error.status);
    expect(await response.json()).toEqual({ error: error.message });
    expect(updateAccess).not.toHaveBeenCalled();
  });

  it("saves only after manage_roles authorization and binds the actor server-side", async () => {
    const { route, requirePermission, updateAccess } = setup();
    const response = await route.PATCH(request(), context);
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("manage_roles");
    expect(updateAccess).toHaveBeenCalledWith({ userId: "admin-1", email: "admin@example.test" }, {
      targetUserId: "employee-1", role: "customer", idempotencyKey: "access-change-1", requestSource: "direct",
    });
  });

  it("preserves failure auditing and hides unexpected service details", async () => {
    const { route, updateAccess, recordFailure } = setup();
    const error = new Error("private database details");
    updateAccess.mockRejectedValueOnce(error);
    const response = await route.PATCH(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The user access could not be updated." });
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: "admin-1", email: "admin@example.test" }, action: "user.access.change.failed",
      resourceId: "employee-1", idempotencyKey: "access-change-1", error,
    }));
  });
});
