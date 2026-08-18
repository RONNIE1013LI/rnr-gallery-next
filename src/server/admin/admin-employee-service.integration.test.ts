import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { account, adminAuditLogs, adminStaffAccess, session, user } from "@/server/db/schema";
import {
  AdminEmployeeAuthorizationError,
  AdminEmployeeConflictError,
  createAdminEmployeeService,
  createDrizzleAdminEmployeeRepository,
} from "./admin-employee-service";
import { createAdminUserService, createDrizzleAdminUserRepository } from "./admin-user-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const actorId = `employee-actor-${suffix}`;
const employeeEmail = `employee-${suffix}@example.test`;
const actorEmail = `employee-actor-${suffix}@example.test`;
const demoterId = `employee-demoter-${suffix}`;
const demoterEmail = `employee-demoter-${suffix}@example.test`;
const initialPassword = "long-lived-password";
const passwordHash = `test-only-hash-${randomUUID()}`;
const rollbackEmail = `employee-rollback-${suffix}@example.test`;
const revokedEmployeeEmail = `employee-revoked-${suffix}@example.test`;

async function waitForQueuedAccessChange() {
  await vi.waitFor(async () => {
    const locks = await database.execute(sql`
      select 1
      from pg_locks
      where locktype = 'advisory'
        and not granted
        and objid::bigint = (hashtext('rnr_admin_user_access_change')::bigint & 4294967295)
      limit 1
    `);
    expect(locks.rows).toHaveLength(1);
  });
}

describe("admin employee persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Employee Actor",
      email: actorEmail,
      role: "admin",
    });
    await database.insert(user).values({
      id: demoterId,
      name: "Employee Demoter",
      email: demoterEmail,
      role: "admin",
    });
  });

  afterAll(async () => {
    await database.delete(user).where(eq(user.email, employeeEmail));
    await database.delete(user).where(eq(user.email, revokedEmployeeEmail));
    await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
    await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, demoterId));
    await database.delete(user).where(eq(user.id, demoterId));
    await database.delete(user).where(eq(user.id, actorId));
  });

  it("creates the user, credential, profile, and redacted audit atomically without a session", async () => {
    const service = createAdminEmployeeService({
      hashPassword: async () => passwordHash,
      verifyPassword: async ({ hash, password }) => hash === passwordHash && password === initialPassword,
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create: createDrizzleAdminEmployeeRepository(database).create,
    });
    const input = {
      name: "Studio Artist",
      email: employeeEmail.toUpperCase(),
      initialPassword,
      adminPermissions: ["view_orders"],
      formPermissions: { access_forms: true, view_jobs: true },
      assignedOnly: true,
      idempotencyKey: `employee-create-${suffix}`,
      requestSource: "integration-test",
    } as const;

    const created = await service.createEmployee({ userId: actorId, email: actorEmail }, input);
    const replay = await service.createEmployee({ userId: actorId, email: actorEmail }, input);
    await expect(service.createEmployee({ userId: actorId, email: actorEmail }, {
      ...input,
      initialPassword: "different-long-lived-password",
    })).rejects.toBeInstanceOf(AdminEmployeeConflictError);

    const [storedUser] = await database.select({
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
    }).from(user).where(eq(user.id, created.id));
    const [credential] = await database.select({
      accountId: account.accountId,
      providerId: account.providerId,
      password: account.password,
    }).from(account).where(eq(account.userId, created.id));
    const [profile] = await database.select({
      adminPermissions: adminStaffAccess.adminPermissions,
      formPermissions: adminStaffAccess.formPermissions,
      assignedOnly: adminStaffAccess.assignedOnly,
    }).from(adminStaffAccess).where(eq(adminStaffAccess.userId, created.id));
    const sessions = await database.select({ id: session.id }).from(session).where(eq(session.userId, created.id));
    const [audit] = await database.select({
      afterSummary: adminAuditLogs.afterSummary,
      requestSource: adminAuditLogs.requestSource,
      result: adminAuditLogs.result,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.actorUserId, actorId),
      eq(adminAuditLogs.action, "user.employee.created"),
      eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
    ));

    expect(created).toMatchObject({ email: employeeEmail, role: "staff", created: true });
    expect(replay).toMatchObject({ id: created.id, email: employeeEmail, role: "staff", created: false });
    expect(storedUser).toMatchObject({ email: employeeEmail, role: "staff", emailVerified: false });
    expect(credential).toEqual({ accountId: created.id, providerId: "credential", password: passwordHash });
    expect(credential?.password).not.toBe(initialPassword);
    expect(profile).toMatchObject({
      adminPermissions: ["access_admin", "view_orders"],
      assignedOnly: true,
      formPermissions: expect.objectContaining({ access_forms: true, view_jobs: true }),
    });
    expect(sessions).toEqual([]);
    expect(audit).toMatchObject({ requestSource: "integration-test", result: "success" });
    expect(JSON.stringify(audit)).not.toContain(initialPassword);
    expect(JSON.stringify(audit)).not.toContain(passwordHash);
  });

  it("rolls back user, credential, and profile when the final audit insert fails", async () => {
    const idempotencyKey = `employee-rollback-${suffix}`;
    await database.insert(adminAuditLogs).values({
      actorUserId: actorId,
      actorEmail,
      action: "user.employee.created",
      resourceType: "user",
      afterSummary: { errorType: "ForcedAuditFailure" },
      result: "failure",
      idempotencyKey,
    });
    const service = createAdminEmployeeService({
      hashPassword: async () => passwordHash,
      verifyPassword: async ({ hash, password }) => hash === passwordHash && password === initialPassword,
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create: createDrizzleAdminEmployeeRepository(database).create,
    });

    await expect(service.createEmployee({ userId: actorId, email: actorEmail }, {
      name: "Rollback Artist",
      email: rollbackEmail,
      initialPassword,
      adminPermissions: ["view_orders"],
      formPermissions: { access_forms: true, view_jobs: true },
      assignedOnly: false,
      idempotencyKey,
      requestSource: "integration-test",
    })).rejects.toThrow();

    const users = await database.select({ id: user.id }).from(user).where(eq(user.email, rollbackEmail));
    const credentials = await database.select({ id: account.id })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(eq(user.email, rollbackEmail));
    const profiles = await database.select({ userId: adminStaffAccess.userId })
      .from(adminStaffAccess)
      .innerJoin(user, eq(user.id, adminStaffAccess.userId))
      .where(eq(user.email, rollbackEmail));

    expect(users).toEqual([]);
    expect(credentials).toEqual([]);
    expect(profiles).toEqual([]);
  });

  it("does not complete employee creation after another administrator concurrently revokes the actor", async () => {
    const userService = createAdminUserService(createDrizzleAdminUserRepository(database));
    const employeeService = createAdminEmployeeService({
      hashPassword: async () => passwordHash,
      verifyPassword: async ({ hash, password }) => hash === passwordHash && password === initialPassword,
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create: createDrizzleAdminEmployeeRepository(database).create,
    });
    let releaseLock!: () => void;
    let lockAcquired!: () => void;
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const acquired = new Promise<void>((resolve) => { lockAcquired = resolve; });
    const gate = database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_access_change'))`);
      lockAcquired();
      await release;
    });

    await acquired;
    const demotion = userService.updateAccess({ userId: demoterId, email: demoterEmail }, {
      targetUserId: actorId,
      role: "customer",
      idempotencyKey: `employee-actor-demotion-${suffix}`,
    });
    await waitForQueuedAccessChange();
    const creation = employeeService.createEmployee({ userId: actorId, email: actorEmail }, {
      name: "Revoked Actor Employee",
      email: revokedEmployeeEmail,
      initialPassword,
      adminPermissions: ["view_orders"],
      formPermissions: { access_forms: true, view_jobs: true },
      assignedOnly: false,
      idempotencyKey: `employee-revoked-create-${suffix}`,
    });

    releaseLock();
    await gate;
    await expect(demotion).resolves.toMatchObject({ id: actorId, role: "customer" });
    await expect(creation).rejects.toBeInstanceOf(AdminEmployeeAuthorizationError);
    await expect(database.select({ id: user.id }).from(user).where(eq(user.email, revokedEmployeeEmail)))
      .resolves.toEqual([]);
    await database.update(user).set({ role: "admin" }).where(eq(user.id, actorId));
  });
});
