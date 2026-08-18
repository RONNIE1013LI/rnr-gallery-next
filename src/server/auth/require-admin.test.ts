import { describe, expect, it, vi } from "vitest";
import { requireAdminFrom, requireAdminPermissionFrom } from "./require-admin";
import { normalizeStaffAccessProfile } from "./staff-access-profile";

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
