import { describe, expect, it, vi } from "vitest";
import {
  AdminUserConflictError,
  AdminUserNotFoundError,
  AdminUserValidationError,
  createAdminUserService,
  parseAdminUserFilters,
} from "./admin-user-service";

const actor = Object.freeze({ userId: "admin-1", email: "owner@example.test" });
const staffInput = Object.freeze({
  targetUserId: "employee-1",
  role: "staff" as const,
  adminPermissions: ["view_orders", "update_order_status"],
  formPermissions: { access_forms: true, view_jobs: true },
  assignedOnly: true,
  idempotencyKey: "employee-access-0001",
  requestSource: "direct",
});

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
  });

  it("normalizes and forwards an exact Staff access profile", async () => {
    const repository = {
      getById: vi.fn(),
      updateAccess: vi.fn().mockResolvedValue({
        id: "employee-1",
        name: "Studio User",
        email: "studio@example.test",
        emailVerified: true,
        role: "staff",
        adminPermissions: ["access_admin", "view_orders", "update_order_status"],
        formPermissions: { access_forms: true, view_jobs: true },
        assignedOnly: true,
        formPreset: null,
        createdAt: new Date("2026-08-04T00:00:00Z"),
        updatedAt: new Date("2026-08-04T01:00:00Z"),
        changed: true,
      }),
    };
    const service = createAdminUserService(repository);

    await expect(service.updateAccess(actor, staffInput)).resolves.toMatchObject({
      id: "employee-1",
      role: "staff",
      adminPermissions: ["access_admin", "view_orders", "update_order_status"],
      changed: true,
    });
    expect(repository.updateAccess).toHaveBeenCalledWith(actor, expect.objectContaining({
      targetUserId: "employee-1",
      role: "staff",
      profile: {
        adminPermissions: ["access_admin", "view_orders", "update_order_status"],
        formPermissions: expect.objectContaining({ access_forms: true, view_jobs: true }),
        assignedOnly: true,
      },
    }));
  });

  it("rejects missing or privileged Staff profiles before the repository", async () => {
    const repository = { getById: vi.fn(), updateAccess: vi.fn() };
    const service = createAdminUserService(repository);

    await expect(service.updateAccess(actor, {
      ...staffInput,
      adminPermissions: ["manage_roles"],
      idempotencyKey: "employee-access-0002",
    })).rejects.toBeInstanceOf(AdminUserValidationError);
    await expect(service.updateAccess(actor, {
      targetUserId: "employee-2",
      role: "staff",
      idempotencyKey: "employee-access-0003",
    })).rejects.toBeInstanceOf(AdminUserValidationError);
    expect(repository.updateAccess).not.toHaveBeenCalled();
  });

  it("prevents an administrator from changing their own role or access", async () => {
    const repository = { getById: vi.fn(), updateAccess: vi.fn() };
    const service = createAdminUserService(repository);

    await expect(service.updateAccess(actor, {
      ...staffInput,
      targetUserId: actor.userId,
      idempotencyKey: "employee-access-0004",
    })).rejects.toBeInstanceOf(AdminUserConflictError);
    expect(repository.updateAccess).not.toHaveBeenCalled();
  });

  it("requires and forwards a valid Forms preset for form-only staff", async () => {
    const repository = {
      getById: vi.fn(),
      updateAccess: vi.fn().mockResolvedValue({
        id: "employee-1",
        role: "form_staff",
        formPreset: "artist",
        adminPermissions: null,
        formPermissions: null,
        assignedOnly: null,
        changed: true,
      }),
    };
    const service = createAdminUserService(repository);

    await expect(service.updateAccess(actor, {
      targetUserId: "employee-1",
      role: "form_staff",
      formPreset: "artist",
      idempotencyKey: "employee-access-0005",
    })).resolves.toMatchObject({ role: "form_staff", formPreset: "artist" });
    expect(repository.updateAccess).toHaveBeenCalledWith(actor, expect.objectContaining({
      role: "form_staff",
      formPreset: "artist",
      profile: null,
    }));

    await expect(service.updateAccess(actor, {
      targetUserId: "employee-1",
      role: "form_staff",
      idempotencyKey: "employee-access-0006",
    })).rejects.toBeInstanceOf(AdminUserValidationError);
  });

  it("reports a missing target user and exposes a safe detail lookup", async () => {
    const service = createAdminUserService({
      getById: vi.fn().mockResolvedValue(null),
      updateAccess: vi.fn().mockResolvedValue(null),
    });

    await expect(service.getById("missing-user")).resolves.toBeNull();
    await expect(service.updateAccess(actor, staffInput)).rejects.toBeInstanceOf(AdminUserNotFoundError);
  });
});
