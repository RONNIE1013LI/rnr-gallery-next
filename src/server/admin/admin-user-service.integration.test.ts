import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminAuditLogs, user } from "@/server/db/schema";
import {
  createAdminUserRoleService,
  createDrizzleAdminUserRoleRepository,
} from "./admin-user-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const actorId = `role-actor-${suffix}`;
const targetId = `role-target-${suffix}`;
const actorEmail = `role-actor-${suffix}@example.test`;

describe("admin user role persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: actorId, name: "Role Actor", email: actorEmail, role: "admin" },
      { id: targetId, name: "Role Target", email: `role-target-${suffix}@example.test`, role: "customer" },
    ]);
  });

  afterAll(async () => {
    await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
    await database.delete(user).where(eq(user.id, targetId));
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("updates the role and appends one idempotent audit record atomically", async () => {
    const service = createAdminUserRoleService(createDrizzleAdminUserRoleRepository(database));
    const input = {
      targetUserId: targetId,
      role: "staff",
      idempotencyKey: `role-change-${suffix}`,
      requestSource: "integration-test",
    } as const;

    await expect(service.changeRole({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({ id: targetId, role: "staff", changed: true });
    await expect(service.changeRole({ userId: actorId, email: actorEmail }, input))
      .resolves.toMatchObject({ id: targetId, role: "staff", changed: false });

    const [updated] = await database.select({ role: user.role }).from(user).where(eq(user.id, targetId));
    const audit = await database.select({
      action: adminAuditLogs.action,
      resourceType: adminAuditLogs.resourceType,
      resourceId: adminAuditLogs.resourceId,
      beforeSummary: adminAuditLogs.beforeSummary,
      afterSummary: adminAuditLogs.afterSummary,
      result: adminAuditLogs.result,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.actorUserId, actorId),
      eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
    ));

    expect(updated).toEqual({ role: "staff" });
    expect(audit).toEqual([{
      action: "user.role.changed",
      resourceType: "user",
      resourceId: targetId,
      beforeSummary: { role: "customer" },
      afterSummary: { role: "staff" },
      result: "success",
    }]);
  });
});
