import { describe, expect, it, vi } from "vitest";
import { requireAdminFrom, requireAdminPermissionFrom, requireAdminPermission } from "./require-admin";
import { normalizeStaffAccessProfile } from "./staff-access-profile";

const securityGate = vi.hoisted(() => vi.fn());
vi.mock("./staff-security-runtime", () => ({ assertStaffSecurity: securityGate }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => session } } }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => ({
  select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ role: "admin" }] }) }) }) }),
}) }));

const session = { user: { id: "user-1", email: "owner@example.test" }, session: {} };

describe("requireAdminFrom", () => {
  it("rejects an unauthenticated request with 401", async () => {
    await expect(requireAdminFrom(
      vi.fn().mockResolvedValue(null),
      vi.fn(),
      new Headers(),
    )).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a customer with 403 and accepts only a database admin role", async () => {
    await expect(requireAdminFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue("customer"),
      new Headers(),
    )).rejects.toMatchObject({ status: 403 });

    await expect(requireAdminFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue("admin"),
      new Headers(),
    )).resolves.toBe(session);
  });

  it("fails closed for a missing or unknown database role", async () => {
    for (const role of [null, "owner", "form_staff"]) {
      await expect(requireAdminFrom(
        vi.fn().mockResolvedValue(session),
        vi.fn().mockResolvedValue(role),
        new Headers(),
      )).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe("requireAdminPermissionFrom", () => {
  it("fails closed when a staff account has no stored access profile", async () => {
    await expect(requireAdminPermissionFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue({ role: "staff", profile: null }),
      new Headers(),
      "view_orders",
    )).rejects.toMatchObject({ status: 403 });
  });

  it("fails closed when a staff account has an invalid stored access profile", async () => {
    await expect(requireAdminPermissionFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue({
        role: "staff",
        profile: {
          adminPermissions: ["view_orders"],
          formPermissions: {},
          assignedOnly: false,
        },
      }),
      new Headers(),
      "view_orders",
    )).rejects.toMatchObject({ status: 403 });
  });

  it("returns only the current staff profile grants", async () => {
    await expect(requireAdminPermissionFrom(
      vi.fn().mockResolvedValue(session),
      vi.fn().mockResolvedValue({
        role: "staff",
        profile: normalizeStaffAccessProfile({
          adminPermissions: ["view_orders"],
          formPermissions: {},
          assignedOnly: false,
        }),
      }),
      new Headers(),
      "view_orders",
    )).resolves.toMatchObject({
      adminRole: "staff",
      adminPermissions: expect.arrayContaining(["view_orders"]),
    });
  });
});

describe("strong staff session gate", () => {
  it("denies a password-only admin session before any admin permission is returned", async () => {
    await expect(requireAdminPermissionFrom(
      async () => ({ user: { id: "staff-security-test" } }),
      async () => ({ role: "admin", profile: null }),
      new Headers(),
      "access_admin",
      async () => { throw new Error("MFA required"); },
    )).rejects.toThrow("MFA required");
  });
});

describe("public admin authorization mode", () => {
  it("forwards the requested permission in explicit read mode", async () => {
    securityGate.mockResolvedValue("owner");
    await requireAdminPermission("manage_roles", { readOnly: true });
    expect(securityGate).toHaveBeenLastCalledWith(session, "manage_roles", "read-only");
  });
  it("still denies staff without the stored requested grant after security verification", async () => {
    await expect(requireAdminPermissionFrom(
      async () => session,
      async () => ({ role: "staff", profile: normalizeStaffAccessProfile({ adminPermissions: ["view_orders"], formPermissions: {}, assignedOnly: false }) }),
      new Headers(),
      "manage_roles",
      async () => "owner",
    )).rejects.toMatchObject({ status: 403 });
  });
  it("keeps omitted and false options in action mode", async () => {
    securityGate.mockResolvedValue("owner");
    for (const options of [undefined, { readOnly: false }]) {
      await requireAdminPermission("manage_roles", options);
      expect(securityGate).toHaveBeenLastCalledWith(session, "manage_roles", false);
    }
  });
  it("does not return access when the security gate rejects a sensitive write", async () => {
    securityGate.mockRejectedValueOnce(new Error("step_up_required"));
    await expect(requireAdminPermission("manage_roles")).rejects.toThrow("step_up_required");
  });
});
