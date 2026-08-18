import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminAuditLogs, adminStaffAccess, formUserAccess, user } from "@/server/db/schema";
import {
  AdminUserAuthorizationError,
  AdminUserConflictError,
  createAdminUserService,
  createDrizzleAdminUserRepository,
} from "./admin-user-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const actorId = `access-actor-${suffix}`;
const targetId = `access-target-${suffix}`;
const profileMissingId = `access-profile-missing-${suffix}`;
const replayTargetId = `access-replay-target-${suffix}`;
const customerReplayId = `access-customer-replay-${suffix}`;
const adminReplayId = `access-admin-replay-${suffix}`;
const formStaffReplayId = `access-form-staff-replay-${suffix}`;
const actorEmail = `access-actor-${suffix}@example.test`;

const staffProfile = {
  adminPermissions: ["view_orders", "update_order_status"],
  formPermissions: { access_forms: true, view_jobs: true },
  assignedOnly: true,
} as const;

describe("admin user access persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: actorId, name: "Access Actor", email: actorEmail, role: "admin" },
      { id: targetId, name: "Access Target", email: `access-target-${suffix}@example.test`, role: "customer" },
      {
        id: profileMissingId,
        name: "Profile Missing",
        email: `access-profile-missing-${suffix}@example.test`,
        role: "staff",
      },
      {
        id: replayTargetId,
        name: "Replay Target",
        email: `access-replay-target-${suffix}@example.test`,
        role: "customer",
      },
      { id: customerReplayId, name: "Customer Replay", email: `access-customer-replay-${suffix}@example.test`, role: "customer" },
      { id: adminReplayId, name: "Admin Replay", email: `access-admin-replay-${suffix}@example.test`, role: "customer" },
      { id: formStaffReplayId, name: "Form Replay", email: `access-form-replay-${suffix}@example.test`, role: "customer" },
    ]);
  });

  afterAll(async () => {
    await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
    await database.delete(user).where(eq(user.id, profileMissingId));
    await database.delete(user).where(eq(user.id, replayTargetId));
    await database.delete(user).where(eq(user.id, customerReplayId));
    await database.delete(user).where(eq(user.id, adminReplayId));
    await database.delete(user).where(eq(user.id, formStaffReplayId));
    await database.delete(user).where(eq(user.id, targetId));
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("stores the normalized Staff profile and records an idempotent exact audit summary", async () => {
    const service = createAdminUserService(createDrizzleAdminUserRepository(database));
    const input = {
      targetUserId: targetId,
      role: "staff" as const,
      ...staffProfile,
      idempotencyKey: `employee-access-${suffix}`,
      requestSource: "integration-test",
    };

    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({
        id: targetId,
        role: "staff",
        adminPermissions: ["access_admin", "view_orders", "update_order_status"],
        assignedOnly: true,
        changed: true,
      });
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({ id: targetId, changed: false });
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, {
      ...input,
      assignedOnly: false,
    })).rejects.toBeInstanceOf(AdminUserConflictError);
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, {
      ...input,
      requestSource: "different-integration-source",
    })).resolves.toMatchObject({ id: targetId, role: "staff", changed: false });

    const [storedProfile] = await database.select({
      adminPermissions: adminStaffAccess.adminPermissions,
      formPermissions: adminStaffAccess.formPermissions,
      assignedOnly: adminStaffAccess.assignedOnly,
    }).from(adminStaffAccess).where(eq(adminStaffAccess.userId, targetId));
    const [audit] = await database.select({
      action: adminAuditLogs.action,
      beforeSummary: adminAuditLogs.beforeSummary,
      afterSummary: adminAuditLogs.afterSummary,
      result: adminAuditLogs.result,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.actorUserId, actorId),
      eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
    ));

    expect(storedProfile).toMatchObject({
      adminPermissions: ["access_admin", "view_orders", "update_order_status"],
      formPermissions: expect.objectContaining({ access_forms: true, view_jobs: true }),
      assignedOnly: true,
    });
    expect(audit).toMatchObject({
      action: "user.access.changed",
      beforeSummary: { role: "customer" },
      afterSummary: {
        role: "staff",
        adminPermissions: ["access_admin", "view_orders", "update_order_status"],
        formPermissions: expect.objectContaining({ access_forms: true, view_jobs: true }),
        assignedOnly: true,
      },
      result: "success",
    });
    expect((audit.afterSummary as Record<string, unknown>).responseSnapshot).toEqual({
      role: "staff",
      formPreset: null,
      adminPermissions: ["access_admin", "view_orders", "update_order_status"],
      formPermissions: expect.objectContaining({ access_forms: true, view_jobs: true }),
      assignedOnly: true,
    });
    expect(JSON.stringify(audit.afterSummary)).not.toContain("Access Target");
    expect(JSON.stringify(audit.afterSummary)).not.toContain(`access-target-${suffix}@example.test`);
  });

  it("returns nullable profile fields for a Staff account without a valid profile", async () => {
    const service = createAdminUserService(createDrizzleAdminUserRepository(database));

    await expect(service.getById(profileMissingId)).resolves.toMatchObject({
      id: profileMissingId,
      role: "staff",
      adminPermissions: null,
      formPermissions: null,
      assignedOnly: null,
    });
  });

  it("replays the stored access snapshot after later changes or target deletion", async () => {
    const service = createAdminUserService(createDrizzleAdminUserRepository(database));
    const input = {
      targetUserId: replayTargetId,
      role: "staff" as const,
      ...staffProfile,
      idempotencyKey: `employee-access-replay-${suffix}`,
    };

    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({ id: replayTargetId, role: "staff", changed: true });
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, {
      targetUserId: replayTargetId,
      role: "customer",
      idempotencyKey: `employee-access-replay-later-${suffix}`,
    })).resolves.toMatchObject({ id: replayTargetId, role: "customer", changed: true });

    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({
        id: replayTargetId,
        role: "staff",
        adminPermissions: ["access_admin", "view_orders", "update_order_status"],
        changed: false,
      });
    await database.delete(user).where(eq(user.id, replayTargetId));
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({
        id: replayTargetId,
        role: "staff",
        adminPermissions: ["access_admin", "view_orders", "update_order_status"],
        changed: false,
      });
  });

  it("replays minimal snapshots for Customer, Admin, and form-only Staff after deletion", async () => {
    const service = createAdminUserService(createDrizzleAdminUserRepository(database));
    const customerInput = {
      targetUserId: customerReplayId,
      role: "customer" as const,
      idempotencyKey: `employee-access-customer-replay-${suffix}`,
    };
    const adminInput = {
      targetUserId: adminReplayId,
      role: "admin" as const,
      idempotencyKey: `employee-access-admin-replay-${suffix}`,
    };
    const formStaffInput = {
      targetUserId: formStaffReplayId,
      role: "form_staff" as const,
      formPreset: "artist" as const,
      idempotencyKey: `employee-access-form-staff-replay-${suffix}`,
    };

    await service.updateAccess({ userId: actorId, email: actorEmail }, customerInput);
    await service.updateAccess({ userId: actorId, email: actorEmail }, adminInput);
    await service.updateAccess({ userId: actorId, email: actorEmail }, formStaffInput);
    await database.delete(user).where(eq(user.id, customerReplayId));
    await database.delete(user).where(eq(user.id, adminReplayId));
    await database.delete(user).where(eq(user.id, formStaffReplayId));

    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, customerInput))
      .resolves.toEqual({
        id: customerReplayId,
        role: "customer",
        formPreset: null,
        adminPermissions: null,
        formPermissions: null,
        assignedOnly: null,
        changed: false,
      });
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, adminInput))
      .resolves.toEqual({
        id: adminReplayId,
        role: "admin",
        formPreset: null,
        adminPermissions: null,
        formPermissions: null,
        assignedOnly: null,
        changed: false,
      });
    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, formStaffInput))
      .resolves.toEqual({
        id: formStaffReplayId,
        role: "form_staff",
        formPreset: "artist",
        adminPermissions: null,
        formPermissions: null,
        assignedOnly: null,
        changed: false,
      });
  });

  it("removes the Staff profile for every non-Staff role and keeps the Forms preset", async () => {
    const service = createAdminUserService(createDrizzleAdminUserRepository(database));
    const update = (role: "customer" | "admin" | "form_staff", idempotencyKey: string) => service.updateAccess(
      { userId: actorId, email: actorEmail },
      role === "form_staff"
        ? { targetUserId: targetId, role, formPreset: "finance", idempotencyKey }
        : { targetUserId: targetId, role, idempotencyKey },
    );
    const restoreStaff = (idempotencyKey: string) => service.updateAccess(
      { userId: actorId, email: actorEmail },
      { targetUserId: targetId, role: "staff", ...staffProfile, idempotencyKey },
    );

    await update("customer", `employee-access-customer-${suffix}`);
    expect(await database.select().from(adminStaffAccess).where(eq(adminStaffAccess.userId, targetId))).toEqual([]);
    await restoreStaff(`employee-access-staff-admin-${suffix}`);
    await update("admin", `employee-access-admin-${suffix}`);
    expect(await database.select().from(adminStaffAccess).where(eq(adminStaffAccess.userId, targetId))).toEqual([]);
    await restoreStaff(`employee-access-staff-form-${suffix}`);
    await update("form_staff", `employee-access-form-${suffix}`);

    expect(await database.select().from(adminStaffAccess).where(eq(adminStaffAccess.userId, targetId))).toEqual([]);
    await expect(database.select({ preset: formUserAccess.preset }).from(formUserAccess)
      .where(eq(formUserAccess.userId, targetId))).resolves.toEqual([{ preset: "finance" }]);
  });

  it("rejects a stale actor inside the transaction", async () => {
    const service = createAdminUserService(createDrizzleAdminUserRepository(database));
    await database.update(user).set({ role: "staff" }).where(eq(user.id, actorId));

    await expect(service.updateAccess({ userId: actorId, email: actorEmail }, {
      targetUserId: targetId,
      role: "customer",
      idempotencyKey: `employee-access-stale-${suffix}`,
    })).rejects.toBeInstanceOf(AdminUserAuthorizationError);

    await database.update(user).set({ role: "admin" }).where(eq(user.id, actorId));
  });
});
