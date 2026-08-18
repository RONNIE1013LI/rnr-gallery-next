import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminAuditLogs,
  adminStaffAccess,
  formUserAccess,
  productionJobs,
  user,
} from "@/server/db/schema";
import { POST as createPaymentRequest } from "@/app/api/admin/payment-requests/route-handler";
import { GET as getFormsJob } from "@/app/api/forms/jobs/[jobId]/route-handler";
import {
  createAdminEmployeeService,
  createDrizzleAdminEmployeeRepository,
} from "@/server/admin/admin-employee-service";
import {
  createAdminUserService,
  createDrizzleAdminUserRepository,
} from "@/server/admin/admin-user-service";
import { recordAdminFailure } from "@/server/admin/admin-failure-audit";
import { requireAdminPermissionFrom } from "./require-admin";
import { normalizeStaffAccessProfile, isStaffAccessProfile } from "./staff-access-profile";
import { requireFormPermissionFrom } from "@/server/forms/require-forms";
import { buildFormAccessProfile, isFormAccessProfile } from "@/server/forms/forms-permissions";

const activeSession = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: async () => activeSession.userId
        ? { user: { id: activeSession.userId, email: `${activeSession.userId}@example.test` } }
        : null,
    },
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = testDatabaseUrl;
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3000";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-with-sufficient-entropy-0123456789";

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const assignedJobId = randomUUID();
const auditPlaintextPassword = `plain-boundary-password-${suffix}`;
const auditPasswordHash = `stored-boundary-password-hash-${suffix}`;
const ids = {
  admin: `boundary-admin-${suffix}`,
  orderViewer: `boundary-orders-${suffix}`,
  paymentOperator: `boundary-payments-${suffix}`,
  assignedArtist: `boundary-artist-${suffix}`,
  contentEditor: `boundary-content-${suffix}`,
  missingProfile: `boundary-missing-${suffix}`,
  unknownKeyProfile: `boundary-unknown-${suffix}`,
  malformedProfile: `boundary-malformed-${suffix}`,
  formStaff: `boundary-form-staff-${suffix}`,
} as const;
type UserInsert = typeof user.$inferInsert;
type StaffAccessInsert = typeof adminStaffAccess.$inferInsert;
let createdEmployeeId: string | null = null;

function sessionFor(id: string) {
  return { user: { id, email: `${id}@example.test` } };
}

function authenticateAs(userId: string | null) {
  activeSession.userId = userId;
}

function appOrigin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new Error("BETTER_AUTH_URL is required");
  return new URL(value).origin;
}

function paymentRequest(body: unknown) {
  const origin = appOrigin();
  return new Request(`${origin}/api/admin/payment-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function auditStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(auditStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(auditStrings);
  return [];
}

function expectNoAuditSecret(value: unknown, secret: string) {
  expect(JSON.stringify(value)).not.toContain(secret);
  for (const text of auditStrings(value)) expect(text).not.toContain(secret);
}

async function findAdminAccess(userId: string) {
  const [record] = await database
    .select({
      role: user.role,
      adminPermissions: adminStaffAccess.adminPermissions,
      formPermissions: adminStaffAccess.formPermissions,
      assignedOnly: adminStaffAccess.assignedOnly,
    })
    .from(user)
    .leftJoin(adminStaffAccess, eq(adminStaffAccess.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  const profile = record?.adminPermissions && record.formPermissions
    ? {
        adminPermissions: record.adminPermissions,
        formPermissions: record.formPermissions,
        assignedOnly: record.assignedOnly ?? false,
      }
    : null;
  return { role: record?.role ?? null, profile: isStaffAccessProfile(profile) ? profile : null };
}

async function findFormAccess(userId: string) {
  const [record] = await database
    .select({
      role: user.role,
      preset: formUserAccess.preset,
      presetAssignedOnly: formUserAccess.assignedOnly,
      presetPermissions: formUserAccess.permissions,
      adminPermissions: adminStaffAccess.adminPermissions,
      staffFormPermissions: adminStaffAccess.formPermissions,
      staffAssignedOnly: adminStaffAccess.assignedOnly,
    })
    .from(user)
    .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
    .leftJoin(adminStaffAccess, eq(adminStaffAccess.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  const staffProfile = record?.adminPermissions && record.staffFormPermissions
    ? {
        adminPermissions: record.adminPermissions,
        formPermissions: record.staffFormPermissions,
        assignedOnly: record.staffAssignedOnly ?? false,
      }
    : null;
  const presetProfile = record?.preset && record.presetPermissions
    ? {
        preset: record.preset,
        assignedOnly: record.presetAssignedOnly ?? false,
        permissions: record.presetPermissions,
      }
    : null;
  const profile = record?.role === "staff"
    ? (isStaffAccessProfile(staffProfile) ? staffProfile : null)
    : (isFormAccessProfile(presetProfile) ? presetProfile : null);
  return { role: record?.role ?? null, profile };
}

function requireAdmin(id: string, permission: Parameters<typeof requireAdminPermissionFrom>[3]) {
  return requireAdminPermissionFrom(
    async () => sessionFor(id),
    findAdminAccess,
    new Headers(),
    permission,
  );
}

function requireForm(id: string, permission: Parameters<typeof requireFormPermissionFrom>[3]) {
  return requireFormPermissionFrom(
    async () => sessionFor(id),
    findFormAccess,
    new Headers(),
    permission,
  );
}

describe("stored staff permission boundaries", () => {
  beforeAll(async () => {
    const users: UserInsert[] = [
      ...Object.entries(ids).map(([name, id]) => ({
        id,
        name,
        email: `${id}@example.test`,
        role: (name === "admin" ? "admin" : name === "formStaff" ? "form_staff" : "staff") as UserInsert["role"],
      })),
    ];
    const profiles: StaffAccessInsert[] = [
      {
        userId: ids.orderViewer,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: ["access_admin", "view_orders"],
          formPermissions: {},
          assignedOnly: false,
        })),
      },
      {
        userId: ids.paymentOperator,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: ["access_admin", "view_orders", "manage_payment"],
          formPermissions: {},
          assignedOnly: false,
        })),
      },
      {
        userId: ids.assignedArtist,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: [],
          formPermissions: { access_forms: true, view_jobs: true, view_files: true },
          assignedOnly: true,
        })),
      },
      {
        userId: ids.contentEditor,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: ["access_admin", "manage_content"],
          formPermissions: {},
          assignedOnly: false,
        })),
      },
      {
        userId: ids.unknownKeyProfile,
        adminPermissions: ["unknown_permission"] as never,
        formPermissions: {} as never,
        assignedOnly: false,
      },
      {
        userId: ids.malformedProfile,
        adminPermissions: [],
        formPermissions: { access_forms: "yes" } as never,
        assignedOnly: false,
      },
    ];
    await database.insert(user).values(users);
    await database.insert(adminStaffAccess).values(profiles);
    const artistProfile = buildFormAccessProfile("artist");
    await database.insert(formUserAccess).values({
      userId: ids.formStaff,
      preset: "artist",
      assignedOnly: artistProfile.assignedOnly,
      permissions: { ...artistProfile.permissions },
    });
    await database.insert(productionJobs).values({
      id: assignedJobId,
      jobNumber: `BOUNDARY-${suffix}`,
      source: "manual",
      idempotencyKey: `boundary-job-${suffix}`,
      requestDigest: `boundary-digest-${suffix}`,
      customerName: "Boundary Customer",
      customerEmail: "boundary.customer@example.test",
      customerPhone: "0210000000",
      customerSource: "other",
      manualStatus: "new",
      manualPaymentStatus: "awaiting_payment",
      neededDate: "2026-08-18",
      deliveryMethod: "post",
      assignedUserId: ids.assignedArtist,
      amountPayableCents: 0,
      amountPaidCents: 0,
      artistFeeCents: 0,
      materialCostCents: 0,
      createdByUserId: ids.admin,
    });
  });

  afterAll(async () => {
    authenticateAs(null);
    await database.delete(productionJobs).where(eq(productionJobs.id, assignedJobId));
    await database.delete(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, ids.admin));
    if (createdEmployeeId) await database.delete(user).where(eq(user.id, createdEmployeeId));
    await database.delete(user).where(eq(user.id, ids.admin));
    await database.delete(user).where(eq(user.id, ids.orderViewer));
    await database.delete(user).where(eq(user.id, ids.paymentOperator));
    await database.delete(user).where(eq(user.id, ids.assignedArtist));
    await database.delete(user).where(eq(user.id, ids.contentEditor));
    await database.delete(user).where(eq(user.id, ids.missingProfile));
    await database.delete(user).where(eq(user.id, ids.unknownKeyProfile));
    await database.delete(user).where(eq(user.id, ids.malformedProfile));
    await database.delete(user).where(eq(user.id, ids.formStaff));
  });

  it("grants an order viewer only its stored order profile", async () => {
    await expect(requireAdmin(ids.orderViewer, "view_orders")).resolves.toMatchObject({
      adminRole: "staff",
      adminPermissions: ["access_admin", "view_orders"],
    });
    for (const permission of ["manage_payment", "record_refund", "view_production_finance", "view_audit", "manage_roles"] as const) {
      await expect(requireAdmin(ids.orderViewer, permission)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("allows Payment Requests only for the payment operator profile", async () => {
    await expect(requireAdmin(ids.paymentOperator, "manage_payment")).resolves.toMatchObject({
      adminPermissions: ["access_admin", "view_orders", "manage_payment"],
    });
    for (const permission of ["update_payment_status", "record_refund", "view_audit", "manage_roles"] as const) {
      await expect(requireAdmin(ids.paymentOperator, permission)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("keeps assigned artists scoped to non-financial, non-contact Forms access", async () => {
    await expect(requireForm(ids.assignedArtist, "view_jobs")).resolves.toMatchObject({
      formRole: "staff",
      formProfile: expect.objectContaining({ assignedOnly: true }),
    });
    await expect(requireForm(ids.assignedArtist, "view_files")).resolves.toMatchObject({ formRole: "staff" });
    for (const permission of ["view_customer_contact", "view_finance", "update_finance"] as const) {
      await expect(requireForm(ids.assignedArtist, permission)).rejects.toMatchObject({ status: 403 });
    }
    await expect(requireAdmin(ids.assignedArtist, "view_production_finance")).rejects.toMatchObject({ status: 403 });
  });

  it("does not turn content editing into publishing or other Admin powers", async () => {
    await expect(requireAdmin(ids.contentEditor, "manage_content")).resolves.toMatchObject({
      adminPermissions: ["access_admin", "manage_content"],
    });
    for (const permission of ["publish_content", "manage_payment", "view_audit", "manage_roles"] as const) {
      await expect(requireAdmin(ids.contentEditor, permission)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("fails closed for missing, unknown-key, or malformed Staff profiles", async () => {
    for (const id of [ids.missingProfile, ids.unknownKeyProfile, ids.malformedProfile]) {
      await expect(requireAdmin(id, "view_orders")).rejects.toMatchObject({ status: 403 });
      await expect(requireForm(id, "view_jobs")).rejects.toMatchObject({ status: 403 });
    }
  });

  it("preserves database-admin and form_staff compatibility without delegating roles", async () => {
    await expect(requireAdmin(ids.admin, "manage_roles")).resolves.toMatchObject({ adminRole: "admin" });
    await expect(requireForm(ids.admin, "update_finance")).resolves.toMatchObject({ formRole: "admin" });
    await expect(requireForm(ids.formStaff, "view_jobs")).resolves.toMatchObject({ formRole: "form_staff" });
    await expect(requireAdmin(ids.formStaff, "view_orders")).rejects.toMatchObject({ status: 403 });
  });

  it("uses the default Admin route resolver against the stored payment profile", async () => {
    authenticateAs(ids.orderViewer);
    expect((await createPaymentRequest(paymentRequest({}))).status).toBe(403);

    authenticateAs(ids.missingProfile);
    expect((await createPaymentRequest(paymentRequest({}))).status).toBe(403);

    authenticateAs(ids.paymentOperator);
    expect((await createPaymentRequest(paymentRequest({}))).status).toBe(422);
  });

  it("uses the default Forms route resolver for access and assigned-only scope", async () => {
    const context = { params: Promise.resolve({ jobId: assignedJobId }) };
    const request = new Request(`${appOrigin()}/api/forms/jobs/${assignedJobId}`);

    authenticateAs(ids.assignedArtist);
    expect((await getFormsJob(request, context)).status).toBe(200);

    authenticateAs(ids.missingProfile);
    expect((await getFormsJob(request, context)).status).toBe(403);

    await database.update(productionJobs).set({ assignedUserId: ids.formStaff }).where(eq(productionJobs.id, assignedJobId));
    authenticateAs(ids.assignedArtist);
    expect((await getFormsJob(request, context)).status).toBe(404);
  });

  it("persists redacted employee, access-change, and failure audit records", async () => {
    const employeeService = createAdminEmployeeService({
      hashPassword: async () => auditPasswordHash,
      verifyPassword: async ({ password, hash }) => password === auditPlaintextPassword && hash === auditPasswordHash,
      passwordPolicy: { minPasswordLength: 8, maxPasswordLength: 128 },
      create: createDrizzleAdminEmployeeRepository(database).create,
    });
    const created = await employeeService.createEmployee(
      { userId: ids.admin, email: `${ids.admin}@example.test` },
      {
        name: "Boundary Audit Employee",
        email: `boundary-audit-${suffix}@example.test`,
        initialPassword: auditPlaintextPassword,
        adminPermissions: ["view_orders"],
        formPermissions: { access_forms: true, view_jobs: true },
        assignedOnly: false,
        idempotencyKey: `boundary-audit-create-${suffix}`,
        requestSource: "integration-test",
      },
    );
    createdEmployeeId = created.id;
    const userService = createAdminUserService(createDrizzleAdminUserRepository(database));
    await userService.updateAccess(
      { userId: ids.admin, email: `${ids.admin}@example.test` },
      {
        targetUserId: created.id,
        role: "staff",
        adminPermissions: ["manage_content"],
        formPermissions: { access_forms: true, view_jobs: true },
        assignedOnly: false,
        idempotencyKey: `boundary-audit-access-${suffix}`,
        requestSource: "integration-test",
      },
    );
    await recordAdminFailure({
      actor: { userId: ids.admin, email: `${ids.admin}@example.test` },
      action: "user.access.change.failed",
      resourceType: "user",
      resourceId: created.id,
      requestSource: "integration-test",
      idempotencyKey: `boundary-audit-failure-${suffix}`,
      error: new Error("intentional test failure"),
    });

    const audits = await database.select({
      action: adminAuditLogs.action,
      beforeSummary: adminAuditLogs.beforeSummary,
      afterSummary: adminAuditLogs.afterSummary,
      result: adminAuditLogs.result,
    }).from(adminAuditLogs).where(and(
      eq(adminAuditLogs.actorUserId, ids.admin),
      inArray(adminAuditLogs.action, [
        "user.employee.created",
        "user.access.changed",
        "user.access.change.failed",
      ]),
    ));

    expect(audits).toHaveLength(3);
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      "user.access.change.failed",
      "user.access.changed",
      "user.employee.created",
    ]);
    expectNoAuditSecret(audits, auditPlaintextPassword);
    expectNoAuditSecret(audits, auditPasswordHash);
  });
});

function toStaffAccessInsert(profile: ReturnType<typeof normalizeStaffAccessProfile>) {
  return {
    adminPermissions: [...profile.adminPermissions],
    formPermissions: { ...profile.formPermissions },
    assignedOnly: profile.assignedOnly,
  };
}
