import { describe, expect, it, vi } from "vitest";
import {
  AdminUserConflictError,
  AdminUserNotFoundError,
  AdminUserValidationError,
  createAdminUserRoleService,
  parseAdminUserFilters,
} from "./admin-user-service";

const actor = Object.freeze({ userId: "admin-1", email: "owner@example.test" });

describe("admin user service", () => {
  it("normalizes email, role and page filters", () => {
    expect(parseAdminUserFilters({ q: "  STAFF@Example.Test ", role: "staff", page: "2" })).toEqual({
      query: "staff@example.test",
      role: "staff",
      page: 2,
      pageSize: 30,
    });
    expect(parseAdminUserFilters({ role: "owner", page: "-1" })).toEqual({
      query: "",
      role: undefined,
      page: 1,
      pageSize: 30,
    });
    expect(parseAdminUserFilters({ role: "form_staff" })).toMatchObject({
      role: "form_staff",
    });
  });

  it("changes another user's role through the atomic repository boundary", async () => {
    const repository = {
      changeRole: vi.fn().mockResolvedValue({
        id: "user-2",
        name: "Studio User",
        email: "studio@example.test",
        emailVerified: true,
        role: "staff",
        createdAt: new Date("2026-08-04T00:00:00Z"),
        updatedAt: new Date("2026-08-04T01:00:00Z"),
        changed: true,
      }),
    };
    const service = createAdminUserRoleService(repository);

    await expect(service.changeRole(actor, {
      targetUserId: "user-2",
      role: "staff",
      idempotencyKey: "role-change-0001",
      requestSource: "direct",
    })).resolves.toMatchObject({ id: "user-2", role: "staff", changed: true });
  });

  it("rejects invalid roles and prevents an admin changing their own role", async () => {
    const repository = { changeRole: vi.fn() };
    const service = createAdminUserRoleService(repository);

    await expect(service.changeRole(actor, {
      targetUserId: "user-2",
      role: "owner",
      idempotencyKey: "role-change-0002",
    })).rejects.toBeInstanceOf(AdminUserValidationError);
    await expect(service.changeRole(actor, {
      targetUserId: "admin-1",
      role: "customer",
      idempotencyKey: "role-change-0003",
    })).rejects.toBeInstanceOf(AdminUserConflictError);
    expect(repository.changeRole).not.toHaveBeenCalled();
  });

  it("requires and forwards a valid access preset for form-only staff", async () => {
    const repository = {
      changeRole: vi.fn().mockResolvedValue({
        id: "user-2",
        name: "Studio User",
        email: "studio@example.test",
        emailVerified: true,
        role: "form_staff",
        formPreset: "artist",
        createdAt: new Date("2026-08-04T00:00:00Z"),
        updatedAt: new Date("2026-08-04T01:00:00Z"),
        changed: true,
      }),
    };
    const service = createAdminUserRoleService(repository);

    await expect(service.changeRole(actor, {
      targetUserId: "user-2",
      role: "form_staff",
      formPreset: "artist",
      idempotencyKey: "role-change-form-staff-0001",
    })).resolves.toMatchObject({ role: "form_staff", formPreset: "artist" });
    expect(repository.changeRole).toHaveBeenCalledWith(actor, expect.objectContaining({
      role: "form_staff",
      formPreset: "artist",
    }));

    await expect(service.changeRole(actor, {
      targetUserId: "user-2",
      role: "form_staff",
      idempotencyKey: "role-change-form-staff-0002",
    })).rejects.toBeInstanceOf(AdminUserValidationError);
  });

  it("reports a missing target user", async () => {
    const service = createAdminUserRoleService({ changeRole: vi.fn().mockResolvedValue(null) });
    await expect(service.changeRole(actor, {
      targetUserId: "missing-user",
      role: "staff",
      idempotencyKey: "role-change-0004",
    })).rejects.toBeInstanceOf(AdminUserNotFoundError);
  });
});
