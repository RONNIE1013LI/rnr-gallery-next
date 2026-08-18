import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { account, adminAuditLogs, adminStaffAccess, user } from "@/server/db/schema";
import {
  isStaffAccessProfile,
  normalizeStaffAccessProfile,
  type StaffAccessProfile,
} from "@/server/auth/staff-access-profile";
import { FORM_PERMISSION_KEYS } from "@/domain/forms/forms-parity";
import { buildAuditRecord } from "./audit-service";

type Database = ReturnType<typeof getDatabase>;
type Actor = Readonly<{ userId: string; email: string }>;
type PasswordPolicy = Readonly<{ minPasswordLength: number; maxPasswordLength: number }>;

export type CreateEmployeeRecord = Readonly<{
  name: string;
  email: string;
  passwordHash: string;
  profile: StaffAccessProfile;
  idempotencyKey: string;
  requestSource?: string;
}>;

export type AdminEmployeeResult = Readonly<{
  id: string;
  name: string;
  email: string;
  role: "staff";
  created: boolean;
}>;

export class AdminEmployeeValidationError extends Error {}
export class AdminEmployeeConflictError extends Error {}
export class AdminEmployeeAuthorizationError extends Error {}

const basicInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  initialPassword: z.string(),
  adminPermissions: z.array(z.string()),
  formPermissions: z.record(z.string(), z.boolean()),
  assignedOnly: z.boolean(),
  idempotencyKey: z.string().trim().min(8).max(255),
  requestSource: z.string().trim().min(1).max(255).optional(),
}).strict();

type EmployeeInput = unknown;
type ParsedEmployeeInput = Readonly<{
  name: string;
  email: string;
  initialPassword: string;
  profile: StaffAccessProfile;
  idempotencyKey: string;
  requestSource?: string;
}>;

type ReplayPasswordVerifier = (storedPasswordHash: string) => Promise<boolean>;
type AdminEmployeeRepository = Readonly<{
  create: (
    actor: Actor,
    input: CreateEmployeeRecord,
    verifyReplayPassword: ReplayPasswordVerifier,
  ) => Promise<AdminEmployeeResult>;
}>;

type PasswordRuntime = Readonly<{
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (input: Readonly<{ password: string; hash: string }>) => Promise<boolean>;
  passwordPolicy: PasswordPolicy;
}>;
type ServiceDependencies = AdminEmployeeRepository & Partial<PasswordRuntime> & Readonly<{
  getPasswordRuntime?: () => Promise<PasswordRuntime>;
}>;

function parseInput(input: EmployeeInput, passwordPolicy: PasswordPolicy): ParsedEmployeeInput {
  const parsed = basicInputSchema.safeParse(input);
  if (!parsed.success ||
    parsed.data.initialPassword.length < passwordPolicy.minPasswordLength ||
    parsed.data.initialPassword.length > passwordPolicy.maxPasswordLength
  ) {
    throw new AdminEmployeeValidationError("Choose valid employee details.");
  }

  try {
    return Object.freeze({
      name: parsed.data.name,
      email: parsed.data.email,
      initialPassword: parsed.data.initialPassword,
      profile: normalizeStaffAccessProfile({
        adminPermissions: parsed.data.adminPermissions,
        formPermissions: parsed.data.formPermissions,
        assignedOnly: parsed.data.assignedOnly,
      }),
      idempotencyKey: parsed.data.idempotencyKey,
      ...(parsed.data.requestSource ? { requestSource: parsed.data.requestSource } : {}),
    });
  } catch {
    throw new AdminEmployeeValidationError("Choose valid employee permissions.");
  }
}

async function resolvePasswordRuntime(dependencies: ServiceDependencies): Promise<PasswordRuntime> {
  if (dependencies.getPasswordRuntime) return dependencies.getPasswordRuntime();
  if (dependencies.hashPassword && dependencies.passwordPolicy) {
    return {
      hashPassword: dependencies.hashPassword,
      verifyPassword: dependencies.verifyPassword ?? (() => Promise.resolve(false)),
      passwordPolicy: dependencies.passwordPolicy,
    };
  }
  throw new Error("Employee password runtime is unavailable.");
}

export function createAdminEmployeeService(dependencies: ServiceDependencies) {
  return Object.freeze({
    async createEmployee(actor: Actor, input: EmployeeInput): Promise<AdminEmployeeResult> {
      const passwordRuntime = await resolvePasswordRuntime(dependencies);
      const parsed = parseInput(input, passwordRuntime.passwordPolicy);
      const passwordHash = await passwordRuntime.hashPassword(parsed.initialPassword);
      return dependencies.create(actor, Object.freeze({
        name: parsed.name,
        email: parsed.email,
        passwordHash,
        profile: parsed.profile,
        idempotencyKey: parsed.idempotencyKey,
        ...(parsed.requestSource ? { requestSource: parsed.requestSource } : {}),
      }), (storedPasswordHash) => passwordRuntime.verifyPassword({
        password: parsed.initialPassword,
        hash: storedPasswordHash,
      }));
    },
  });
}

const employeeFields = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
};

export function sameStaffAccessProfile(
  candidate: unknown,
  expected: StaffAccessProfile,
) {
  if (!isStaffAccessProfile(candidate)) return false;
  return candidate.adminPermissions.length === expected.adminPermissions.length &&
    candidate.adminPermissions.every((permission, index) => permission === expected.adminPermissions[index]) &&
    candidate.assignedOnly === expected.assignedOnly &&
    FORM_PERMISSION_KEYS.every(
      (permission) => candidate.formPermissions[permission] === expected.formPermissions[permission],
    );
}

function matchesEmployeeRecord(
  record: { id: string; name: string; email: string; role: "customer" | "form_staff" | "staff" | "admin" },
  profile: unknown,
  input: CreateEmployeeRecord,
) {
  return record.name === input.name &&
    record.email === input.email &&
    record.role === "staff" &&
    sameStaffAccessProfile(profile, input.profile);
}

export function createDrizzleAdminEmployeeRepository(database: Database): AdminEmployeeRepository {
  return Object.freeze({
    async create(actor, input, verifyReplayPassword) {
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_employee_create'))`);

        const [currentActor] = await transaction
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, actor.userId))
          .limit(1);
        if (currentActor?.role !== "admin") {
          throw new AdminEmployeeAuthorizationError("Administrator access has changed. Sign in again.");
        }

        const [existingAudit] = await transaction
          .select({ resourceId: adminAuditLogs.resourceId })
          .from(adminAuditLogs)
          .where(and(
            eq(adminAuditLogs.actorUserId, actor.userId),
            eq(adminAuditLogs.action, "user.employee.created"),
            eq(adminAuditLogs.result, "success"),
            eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existingAudit) {
          if (!existingAudit.resourceId) {
            throw new AdminEmployeeConflictError("This employee-creation request has already been used.");
          }
          const [record] = await transaction
            .select({
              ...employeeFields,
              adminPermissions: adminStaffAccess.adminPermissions,
              formPermissions: adminStaffAccess.formPermissions,
              assignedOnly: adminStaffAccess.assignedOnly,
            })
            .from(user)
            .leftJoin(adminStaffAccess, eq(adminStaffAccess.userId, user.id))
            .where(eq(user.id, existingAudit.resourceId))
            .limit(1);
          const profile = record?.adminPermissions && record.formPermissions
            ? {
                adminPermissions: record.adminPermissions,
                formPermissions: record.formPermissions,
                assignedOnly: record.assignedOnly ?? false,
              }
            : null;
          if (!record || !matchesEmployeeRecord(record, profile, input)) {
            throw new AdminEmployeeConflictError("This employee-creation request has already been used.");
          }
          const [credential] = await transaction
            .select({ password: account.password })
            .from(account)
            .where(and(
              eq(account.userId, record.id),
              eq(account.providerId, "credential"),
            ))
            .limit(1);
          if (!credential?.password || !await verifyReplayPassword(credential.password)) {
            throw new AdminEmployeeConflictError("This employee-creation request has already been used.");
          }
          return Object.freeze({ ...record, role: "staff" as const, created: false });
        }

        const [existingEmail] = await transaction
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, input.email))
          .limit(1);
        if (existingEmail) {
          throw new AdminEmployeeConflictError("An account already uses this email.");
        }

        const employeeId = randomUUID();
        const [created] = await transaction.insert(user).values({
          id: employeeId,
          name: input.name,
          email: input.email,
          emailVerified: false,
          role: "staff",
        }).returning(employeeFields);
        if (!created) throw new Error("Employee account creation did not return a user.");

        await transaction.insert(account).values({
          id: randomUUID(),
          accountId: employeeId,
          providerId: "credential",
          userId: employeeId,
          password: input.passwordHash,
        });
        await transaction.insert(adminStaffAccess).values({
          userId: employeeId,
          adminPermissions: [...input.profile.adminPermissions],
          formPermissions: { ...input.profile.formPermissions },
          assignedOnly: input.profile.assignedOnly,
        });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "user.employee.created",
          resourceType: "user",
          resourceId: employeeId,
          afterSummary: {
            role: "staff",
            adminPermissions: input.profile.adminPermissions,
            formPermissions: input.profile.formPermissions,
            assignedOnly: input.profile.assignedOnly,
          },
          ...(input.requestSource ? { requestSource: input.requestSource } : {}),
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return Object.freeze({ ...created, role: "staff" as const, created: true });
      });
    },
  });
}
