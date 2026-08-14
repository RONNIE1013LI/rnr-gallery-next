import { and, asc, count, desc, eq, ilike, max, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs, formUserAccess, session, user } from "@/server/db/schema";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { buildAuditRecord } from "./audit-service";

export const adminUserRoles = ["admin", "form_staff", "staff", "customer"] as const;
export type AdminUserRole = (typeof adminUserRoles)[number];
export const formAccessPresets = ["manager", "artist", "finance", "readOnly"] as const;
export type FormAccessPreset = (typeof formAccessPresets)[number];

type Database = ReturnType<typeof getDatabase>;
type Actor = Readonly<{ userId: string; email: string }>;

type AdminUserAccount = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: AdminUserRole;
  formPreset: FormAccessPreset | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminUserListItem = AdminUserAccount & Readonly<{
  lastSeenAt: Date | null;
  activeSessions: number;
}>;

export type AdminUserRoleChangeResult = AdminUserAccount & Readonly<{
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
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      formPreset: formUserAccess.preset,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastSeenAt: max(session.updatedAt),
      activeSessions: sql<number>`count(${session.id}) filter (where ${session.expiresAt} > now())`,
    })
    .from(user)
    .leftJoin(session, eq(session.userId, user.id))
    .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
    .where(where)
    .groupBy(
      user.id,
      user.name,
      user.email,
      user.emailVerified,
      user.role,
      formUserAccess.preset,
      user.createdAt,
      user.updatedAt,
    )
    .orderBy(desc(user.createdAt), asc(user.email))
    .limit(filters.pageSize)
    .offset((page - 1) * filters.pageSize);
  return Object.freeze({
    items: Object.freeze(items.map((item) => Object.freeze({
      ...item,
      activeSessions: Number(item.activeSessions ?? 0),
    }))),
    total,
    page,
    pageSize: filters.pageSize,
    pageCount,
  });
}

const roleChangeSchema = z.object({
  targetUserId: z.string().trim().min(1).max(255),
  role: z.enum(adminUserRoles),
  formPreset: z.enum(formAccessPresets).optional(),
  idempotencyKey: z.string().trim().min(8).max(255),
  requestSource: z.string().trim().min(1).max(255).optional(),
}).strict().superRefine((input, context) => {
  if (input.role === "form_staff" && !input.formPreset) {
    context.addIssue({
      code: "custom",
      path: ["formPreset"],
      message: "Choose a form access profile",
    });
  }
});

type RoleChangeInput = Readonly<{
  targetUserId: unknown;
  role: unknown;
  formPreset?: unknown;
  idempotencyKey: unknown;
  requestSource?: unknown;
}>;
type ParsedRoleChangeInput = z.output<typeof roleChangeSchema>;
type AdminUserRoleRepository = Readonly<{
  changeRole: (
    actor: Actor,
    input: ParsedRoleChangeInput,
  ) => Promise<AdminUserRoleChangeResult | null>;
}>;

export function createAdminUserRoleService(repository: AdminUserRoleRepository) {
  return Object.freeze({
    async changeRole(actor: Actor, input: RoleChangeInput) {
      const parsed = roleChangeSchema.safeParse(input);
      if (!parsed.success) throw new AdminUserValidationError("Choose a valid user role.");
      if (parsed.data.targetUserId === actor.userId) {
        throw new AdminUserConflictError("You cannot change your own administrator role.");
      }
      const result = await repository.changeRole(actor, parsed.data);
      if (!result) throw new AdminUserNotFoundError("The user account could not be found.");
      return result;
    },
  });
}

const selectedUserFields = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  role: user.role,
  formPreset: formUserAccess.preset,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

export function createDrizzleAdminUserRoleRepository(database: Database): AdminUserRoleRepository {
  return Object.freeze({
    async changeRole(actor, input) {
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_role_change'))`);

        const [currentActor] = await transaction
          .select({ role: user.role })
          .from(user)
          .where(eq(user.id, actor.userId))
          .limit(1);
        if (currentActor?.role !== "admin") {
          throw new AdminUserAuthorizationError("Administrator access has changed. Sign in again.");
        }

        const [existingAudit] = await transaction
          .select({ resourceId: adminAuditLogs.resourceId, afterSummary: adminAuditLogs.afterSummary })
          .from(adminAuditLogs)
          .where(and(
            eq(adminAuditLogs.actorUserId, actor.userId),
            eq(adminAuditLogs.action, "user.role.changed"),
            eq(adminAuditLogs.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existingAudit) {
          const recordedRole = (existingAudit.afterSummary as Record<string, unknown> | null)?.role;
          const recordedPreset = (existingAudit.afterSummary as Record<string, unknown> | null)?.formPreset;
          if (
            existingAudit.resourceId !== input.targetUserId ||
            recordedRole !== input.role ||
            (input.role === "form_staff" && recordedPreset !== input.formPreset)
          ) {
            throw new AdminUserConflictError("This role-change request has already been used.");
          }
          const [currentTarget] = await transaction
            .select(selectedUserFields)
            .from(user)
            .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
            .where(eq(user.id, input.targetUserId))
            .limit(1);
          return currentTarget ? Object.freeze({ ...currentTarget, changed: false }) : null;
        }

        const [target] = await transaction
          .select(selectedUserFields)
          .from(user)
          .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
          .where(eq(user.id, input.targetUserId))
          .limit(1);
        if (!target) return null;
        if (
          target.role === input.role &&
          (input.role !== "form_staff" || target.formPreset === input.formPreset)
        ) {
          return Object.freeze({ ...target, changed: false });
        }

        const [updated] = await transaction
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
        if (!updated) return null;

        let formPreset: FormAccessPreset | null = null;
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

        const result = Object.freeze({ ...updated, formPreset, changed: true });

        await transaction.insert(adminAuditLogs).values(buildAuditRecord({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: "user.role.changed",
          resourceType: "user",
          resourceId: input.targetUserId,
          beforeSummary: { role: target.role },
          afterSummary: {
            role: updated.role,
            ...(formPreset ? { formPreset } : {}),
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
