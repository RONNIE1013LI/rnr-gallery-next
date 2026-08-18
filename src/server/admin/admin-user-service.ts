import { and, asc, count, desc, eq, ilike, max, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs, adminStaffAccess, formUserAccess, session, user } from "@/server/db/schema";
import {
  isStaffAccessProfile,
  normalizeStaffAccessProfile,
  type StaffAccessProfile,
} from "@/server/auth/staff-access-profile";
import { buildFormAccessProfile, type FormPermission } from "@/server/forms/forms-permissions";
import { buildAuditRecord } from "./audit-service";

export const adminUserRoles = ["admin", "form_staff", "staff", "customer"] as const;
export type AdminUserRole = (typeof adminUserRoles)[number];
export const formAccessPresets = ["manager", "artist", "finance", "readOnly"] as const;
export type FormAccessPreset = (typeof formAccessPresets)[number];

type Database = ReturnType<typeof getDatabase>;
type Actor = Readonly<{ userId: string; email: string }>;

export type AdminUserAccount = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AdminUserRole;
  formPreset: FormAccessPreset | null;
  adminPermissions: readonly string[] | null;
  formPermissions: Readonly<Record<FormPermission, boolean>> | null;
  assignedOnly: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminUserListItem = AdminUserAccount & Readonly<{
  lastSeenAt: Date | null;
  activeSessions: number;
}>;

export type AdminUserAccessChangeResult = AdminUserAccount & Readonly<{
  changed: boolean;
}>;

export class AdminUserValidationError extends Error {}
export class AdminUserNotFoundError extends Error {}
export class AdminUserConflictError extends Error {}
export class AdminUserAuthorizationError extends Error {}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAdminUserFilters(
  params: Readonly<Record<string, string | string[] | undefined>>,
) {
  const rawPage = Number(scalar(params.page));
  const rawRole = scalar(params.role);
  return Object.freeze({
    query: scalar(params.q)?.trim().toLowerCase().slice(0, 320) ?? "",
    role: adminUserRoles.find((role) => role === rawRole),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: 30,
  });
}

const selectedUserFields = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  role: user.role,
  formPreset: formUserAccess.preset,
  adminPermissions: adminStaffAccess.adminPermissions,
  formPermissions: adminStaffAccess.formPermissions,
  assignedOnly: adminStaffAccess.assignedOnly,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

function profileFromRecord(record: Pick<AdminUserAccount, "adminPermissions" | "formPermissions" | "assignedOnly">) {
  if (!record.adminPermissions || !record.formPermissions || record.assignedOnly === null) return null;
  const candidate = {
    adminPermissions: record.adminPermissions,
    formPermissions: record.formPermissions,
    assignedOnly: record.assignedOnly,
  };
  return isStaffAccessProfile(candidate) ? candidate : null;
}

function freezeUser(record: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  formPreset: string | null;
  adminPermissions: string[] | null;
  formPermissions: Record<string, boolean> | null;
  assignedOnly: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminUserAccount {
  const profile = profileFromRecord({
    adminPermissions: record.adminPermissions,
    formPermissions: record.formPermissions as Record<FormPermission, boolean> | null,
    assignedOnly: record.assignedOnly,
  });
  return Object.freeze({
    ...record,
    role: adminUserRoles.includes(record.role as AdminUserRole) ? record.role as AdminUserRole : "customer",
    formPreset: formAccessPresets.includes(record.formPreset as FormAccessPreset)
      ? record.formPreset as FormAccessPreset
      : null,
    adminPermissions: profile ? Object.freeze([...profile.adminPermissions]) : null,
    formPermissions: profile ? Object.freeze({ ...profile.formPermissions }) : null,
    assignedOnly: profile?.assignedOnly ?? null,
  });
}

export async function listAdminUsers(
  database: Database,
  params: Readonly<Record<string, string | string[] | undefined>>,
) {
  const filters = parseAdminUserFilters(params);
  const conditions: SQL[] = [];
  if (filters.query) conditions.push(ilike(user.email, `%${filters.query}%`));
  if (filters.role) conditions.push(eq(user.role, filters.role));
  const where = conditions.length ? and(...conditions) : undefined;
  const [totalRow] = await database.select({ value: count() }).from(user).where(where);
  const total = Number(totalRow?.value ?? 0);
  const pageCount = Math.ceil(total / filters.pageSize);
  const page = pageCount ? Math.min(filters.page, pageCount) : 1;
  const items = await database
    .select({
      ...selectedUserFields,
      lastSeenAt: max(session.updatedAt),
      activeSessions: sql<number>`count(${session.id}) filter (where ${session.expiresAt} > now())`,
    })
    .from(user)
    .leftJoin(session, eq(session.userId, user.id))
    .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
    .leftJoin(adminStaffAccess, eq(adminStaffAccess.userId, user.id))
    .where(where)
    .groupBy(
      user.id,
      user.name,
      user.email,
      user.emailVerified,
      user.role,
      formUserAccess.preset,
      adminStaffAccess.adminPermissions,
      adminStaffAccess.formPermissions,
      adminStaffAccess.assignedOnly,
      user.createdAt,
      user.updatedAt,
    )
    .orderBy(desc(user.createdAt), asc(user.email))
    .limit(filters.pageSize)
    .offset((page - 1) * filters.pageSize);
  return Object.freeze({
    items: Object.freeze(items.map((item) => Object.freeze({
      ...freezeUser(item),
      activeSessions: Number(item.activeSessions ?? 0),
      lastSeenAt: item.lastSeenAt,
    }))),
    total,
    page,
    pageSize: filters.pageSize,
    pageCount,
  });
}

const accessChangeBase = {
  targetUserId: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().trim().min(8).max(255),
  requestSource: z.string().trim().min(1).max(255).optional(),
};

const accessChangeSchema = z.discriminatedUnion("role", [
  z.object({
    ...accessChangeBase,
    role: z.literal("staff"),
    adminPermissions: z.array(z.string()),
    formPermissions: z.record(z.string(), z.boolean()),
    assignedOnly: z.boolean(),
  }).strict(),
  z.object({
    ...accessChangeBase,
    role: z.literal("form_staff"),
    formPreset: z.enum(formAccessPresets),
  }).strict(),
  z.object({ ...accessChangeBase, role: z.literal("admin") }).strict(),
  z.object({ ...accessChangeBase, role: z.literal("customer") }).strict(),
]);

type AccessChangeInput = Readonly<{
  targetUserId: unknown;
  role: unknown;
  adminPermissions?: unknown;
  formPermissions?: unknown;
  assignedOnly?: unknown;
  formPreset?: unknown;
  idempotencyKey: unknown;
  requestSource?: unknown;
}>;

export type ParsedAccessChangeInput = Readonly<{
  targetUserId: string;
  role: AdminUserRole;
  profile: StaffAccessProfile | null;
  formPreset?: FormAccessPreset;
  idempotencyKey: string;
  requestSource?: string;
}>;

type AdminUserRepository = Readonly<{
  getById: (userId: string) => Promise<AdminUserAccount | null>;
  updateAccess: (
    actor: Actor,
    input: ParsedAccessChangeInput,
  ) => Promise<AdminUserAccessChangeResult | null>;
}>;

function parseAccessChange(input: AccessChangeInput): ParsedAccessChangeInput {
  const parsed = accessChangeSchema.safeParse(input);
  if (!parsed.success) throw new AdminUserValidationError("Choose a valid user access profile.");
  try {
    const profile = parsed.data.role === "staff"
      ? normalizeStaffAccessProfile({
          adminPermissions: parsed.data.adminPermissions,
          formPermissions: parsed.data.formPermissions,
          assignedOnly: parsed.data.assignedOnly,
        })
      : null;
    return Object.freeze({
      targetUserId: parsed.data.targetUserId,
      role: parsed.data.role,
      profile,
      ...(parsed.data.role === "form_staff" ? { formPreset: parsed.data.formPreset } : {}),
      idempotencyKey: parsed.data.idempotencyKey,
      ...(parsed.data.requestSource ? { requestSource: parsed.data.requestSource } : {}),
    });
  } catch {
    throw new AdminUserValidationError("Choose a valid employee permissions profile.");
  }
}

export function createAdminUserService(repository: AdminUserRepository) {
  return Object.freeze({
    getById(userId: string) {
      return repository.getById(userId);
    },
    async updateAccess(actor: Actor, input: AccessChangeInput) {
      const parsed = parseAccessChange(input);
      if (parsed.targetUserId === actor.userId) {
        throw new AdminUserConflictError("You cannot change your own administrator role.");
      }
      const result = await repository.updateAccess(actor, parsed);
      if (!result) throw new AdminUserNotFoundError("The user account could not be found.");
      return result;
    },
  });
}

function accessSummary(account: AdminUserAccount) {
  const profile = profileFromRecord(account);
  return {
    role: account.role,
    ...(profile ? {
      adminPermissions: profile.adminPermissions,
      formPermissions: profile.formPermissions,
      assignedOnly: profile.assignedOnly,
    } : {}),
    ...(account.role === "form_staff" && account.formPreset ? { formPreset: account.formPreset } : {}),
  };
}

function accessResponseSnapshot(account: AdminUserAccount) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    emailVerified: account.emailVerified,
    role: account.role,
    formPreset: account.formPreset,
    adminPermissions: account.adminPermissions ? [...account.adminPermissions] : null,
    formPermissions: account.formPermissions ? { ...account.formPermissions } : null,
    assignedOnly: account.assignedOnly,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function responseSnapshotFromAudit(summary: unknown): AdminUserAccount | null {
  if (!summary || typeof summary !== "object") return null;
  const snapshot = (summary as Record<string, unknown>).responseSnapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidate = snapshot as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.email !== "string" ||
    typeof candidate.emailVerified !== "boolean" ||
    typeof candidate.role !== "string" ||
    (candidate.formPreset !== null && typeof candidate.formPreset !== "string") ||
    (candidate.adminPermissions !== null && !Array.isArray(candidate.adminPermissions)) ||
    (candidate.formPermissions !== null && (
      !candidate.formPermissions || typeof candidate.formPermissions !== "object" || Array.isArray(candidate.formPermissions)
    )) ||
    (candidate.assignedOnly !== null && typeof candidate.assignedOnly !== "boolean") ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) return null;
  const createdAt = new Date(candidate.createdAt);
  const updatedAt = new Date(candidate.updatedAt);
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) return null;
  if (!candidate.adminPermissions?.every((permission) => typeof permission === "string")) return null;
  if (!Object.values(candidate.formPermissions ?? {}).every((enabled) => typeof enabled === "boolean")) return null;
  return freezeUser({
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    emailVerified: candidate.emailVerified,
    role: candidate.role,
    formPreset: candidate.formPreset,
    adminPermissions: candidate.adminPermissions as string[] | null,
    formPermissions: candidate.formPermissions as Record<string, boolean> | null,
    assignedOnly: candidate.assignedOnly,
    createdAt,
    updatedAt,
  });
}

function matchesRecordedAccess(
  summary: unknown,
  targetUserId: string | null,
  requestSource: string | null,
  input: ParsedAccessChangeInput,
) {
  if (
    targetUserId !== input.targetUserId ||
    requestSource !== (input.requestSource ?? null) ||
    !summary ||
    typeof summary !== "object"
  ) return false;
  const recorded = summary as Record<string, unknown>;
  if (recorded.role !== input.role) return false;
  if (input.role === "staff") {
    return sameStaffAccessProfile({
      adminPermissions: recorded.adminPermissions,
      formPermissions: recorded.formPermissions,
      assignedOnly: recorded.assignedOnly,
    }, input.profile);
  }
  return input.role !== "form_staff" || recorded.formPreset === input.formPreset;
}

function sameStaffAccessProfile(candidate: unknown, expected: StaffAccessProfile | null) {
  if (!expected || !isStaffAccessProfile(candidate)) return false;
  return candidate.adminPermissions.length === expected.adminPermissions.length &&
    candidate.adminPermissions.every((permission, index) => permission === expected.adminPermissions[index]) &&
    candidate.assignedOnly === expected.assignedOnly &&
    Object.entries(expected.formPermissions).every(
      ([permission, enabled]) => candidate.formPermissions[permission as FormPermission] === enabled,
    );
}

export function createDrizzleAdminUserRepository(database: Database): AdminUserRepository {
  async function getById(userId: string) {
    const [record] = await database
      .select(selectedUserFields)
      .from(user)
      .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
      .leftJoin(adminStaffAccess, eq(adminStaffAccess.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1);
    return record ? freezeUser(record) : null;
  }

  return Object.freeze({
    getById,
    async updateAccess(actor, input) {
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_access_change'))`);

        const [currentActor] = await transaction
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, actor.userId))
          .limit(1);
        if (currentActor?.role !== "admin") {
          throw new AdminUserAuthorizationError("Administrator access has changed. Sign in again.");
        }
        if (input.targetUserId === actor.userId) {
          throw new AdminUserConflictError("You cannot change your own administrator role.");
        }
        let profile: StaffAccessProfile | null = null;
        try {
          profile = input.role === "staff" ? normalizeStaffAccessProfile(input.profile) : null;
        } catch {
          throw new AdminUserValidationError("Choose a valid employee permissions profile.");
        }

        const [existingAudit] = await transaction
          .select({
            resourceId: adminAuditLogs.resourceId,
            afterSummary: adminAuditLogs.afterSummary,
            requestSource: adminAuditLogs.requestSource,
          })
          .from(adminAuditLogs)
          .where(and(
            eq(adminAuditLogs.actorUserId, actor.userId),
            eq(adminAuditLogs.action, "user.access.changed"),
            eq(adminAuditLogs.result, "success"),
            eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existingAudit) {
          if (!matchesRecordedAccess(
            existingAudit.afterSummary,
            existingAudit.resourceId,
            existingAudit.requestSource,
            input,
          )) {
            throw new AdminUserConflictError("This access-change request has already been used.");
          }
          const responseSnapshot = responseSnapshotFromAudit(existingAudit.afterSummary);
          if (!responseSnapshot) {
            throw new AdminUserConflictError("This access-change request has already been used.");
          }
          return Object.freeze({ ...responseSnapshot, changed: false });
        }

        const [lockedTarget] = await transaction
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, input.targetUserId))
          .for("update")
          .limit(1);
        if (!lockedTarget) return null;
        const [targetRecord] = await transaction
          .select(selectedUserFields)
          .from(user)
          .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
          .leftJoin(adminStaffAccess, eq(adminStaffAccess.userId, user.id))
          .where(eq(user.id, lockedTarget.id))
          .limit(1);
        if (!targetRecord) return null;
        const target = freezeUser(targetRecord);

        const currentProfile = profileFromRecord(target);
        const changed = target.role !== input.role ||
          (input.role === "staff" && !sameStaffAccessProfile(currentProfile, profile)) ||
          (input.role === "form_staff" && target.formPreset !== input.formPreset);
        let updated = target;
        if (changed) {
          const [updatedRecord] = await transaction
            .update(user)
            .set({ role: input.role, updatedAt: new Date() })
            .where(eq(user.id, input.targetUserId))
            .returning({
              id: user.id,
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
              role: user.role,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
            });
          if (!updatedRecord) return null;
          updated = Object.freeze({
            ...updatedRecord,
            formPreset: null,
            adminPermissions: null,
            formPermissions: null,
            assignedOnly: null,
          });
        }

        let formPreset: FormAccessPreset | null = null;
        if (input.role === "staff" && profile) {
          await transaction.insert(adminStaffAccess).values({
            userId: input.targetUserId,
            adminPermissions: [...profile.adminPermissions],
            formPermissions: { ...profile.formPermissions },
            assignedOnly: profile.assignedOnly,
          }).onConflictDoUpdate({
            target: adminStaffAccess.userId,
            set: {
              adminPermissions: [...profile.adminPermissions],
              formPermissions: { ...profile.formPermissions },
              assignedOnly: profile.assignedOnly,
              updatedAt: new Date(),
            },
          });
          await transaction.delete(formUserAccess).where(eq(formUserAccess.userId, input.targetUserId));
        } else {
          await transaction.delete(adminStaffAccess).where(eq(adminStaffAccess.userId, input.targetUserId));
          if (input.role === "form_staff" && input.formPreset) {
            const profile = buildFormAccessProfile(input.formPreset);
            await transaction.insert(formUserAccess).values({
              userId: input.targetUserId,
              preset: input.formPreset,
              assignedOnly: profile.assignedOnly,
              permissions: profile.permissions,
            }).onConflictDoUpdate({
              target: formUserAccess.userId,
              set: {
                preset: input.formPreset,
                assignedOnly: profile.assignedOnly,
                permissions: profile.permissions,
                updatedAt: new Date(),
              },
            });
            formPreset = input.formPreset;
          } else {
            await transaction.delete(formUserAccess).where(eq(formUserAccess.userId, input.targetUserId));
          }
        }

        const result = Object.freeze({
          ...updated,
          formPreset,
          adminPermissions: profile ? Object.freeze([...profile.adminPermissions]) : null,
          formPermissions: profile ? Object.freeze({ ...profile.formPermissions }) : null,
          assignedOnly: profile?.assignedOnly ?? null,
          changed,
        });
        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "user.access.changed",
          resourceType: "user",
          resourceId: input.targetUserId,
          beforeSummary: accessSummary(target),
          afterSummary: {
            ...accessSummary(result),
            responseSnapshot: accessResponseSnapshot(result),
          },
          ...(input.requestSource ? { requestSource: input.requestSource } : {}),
          result: "success",
          idempotencyKey: input.idempotencyKey,
        }));
        return result;
      });
    },
  });
}
