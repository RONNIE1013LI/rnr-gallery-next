import { eq } from "drizzle-orm";
import { adminStaffAccess, user } from "@/server/db/schema";
import {
  ADMIN_PERMISSION_KEYS,
  hasAdminPermission,
  isAdminRole,
  type AdminPermission,
  type AdminRole,
} from "./admin-permissions";
import { HttpError, requireSessionFrom } from "./require-session";
import { isStaffAccessProfile } from "./staff-access-profile";

type SessionWithUser = Readonly<{
  user: Readonly<{ id: string; name?: string; email?: string }>;
}>;
type SessionGetter<T extends SessionWithUser> = (
  context: { headers: Headers },
) => Promise<T | null>;

export async function requireAdminFrom<T extends SessionWithUser>(
  getSession: SessionGetter<T>,
  findRole: (userId: string) => Promise<unknown>,
  requestHeaders: Headers,
): Promise<T> {
  const session = await requireSessionFrom(getSession, requestHeaders);
  if (await findRole(session.user.id) !== "admin") {
    throw new HttpError("Forbidden", 403);
  }
  return session;
}

export type AdminAccess<T extends SessionWithUser = SessionWithUser> = T &
  Readonly<{
    adminRole: AdminRole;
    adminPermissions: readonly AdminPermission[];
  }>;

type StoredAdminAccess = Readonly<{
  role: unknown;
  profile: unknown;
}>;

export async function requireAdminPermissionFrom<T extends SessionWithUser>(
  getSession: SessionGetter<T>,
  findAccess: (userId: string) => Promise<StoredAdminAccess>,
  requestHeaders: Headers,
  permission: AdminPermission,
): Promise<AdminAccess<T>> {
  const session = await requireSessionFrom(getSession, requestHeaders);
  const stored = await findAccess(session.user.id);
  if (!isAdminRole(stored.role)) {
    throw new HttpError("Forbidden", 403);
  }
  const staffProfile = isStaffAccessProfile(stored.profile) ? stored.profile : null;
  const adminPermissions = stored.role === "admin"
    ? ADMIN_PERMISSION_KEYS
    : staffProfile?.adminPermissions;
  if (!adminPermissions || !hasAdminPermission(stored.role, adminPermissions, permission)) {
    throw new HttpError("Forbidden", 403);
  }
  return Object.freeze({
    ...session,
    adminRole: stored.role,
    adminPermissions,
  });
}

async function accessForUser(userId: string): Promise<StoredAdminAccess> {
  const { getDatabase } = await import("@/server/db/client");
  const [record] = await getDatabase()
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
  const candidate = record?.adminPermissions && record.formPermissions
    ? {
        adminPermissions: record.adminPermissions,
        formPermissions: record.formPermissions,
        assignedOnly: record.assignedOnly ?? false,
      }
    : null;
  return {
    role: record?.role ?? null,
    profile: isStaffAccessProfile(candidate) ? candidate : null,
  };
}

export async function requireAdminPermission(permission: AdminPermission) {
  const [{ headers }, { auth }] = await Promise.all([
    import("next/headers"),
    import("@/server/auth"),
  ]);
  return requireAdminPermissionFrom(
    auth.api.getSession,
    accessForUser,
    await headers(),
    permission,
  );
}

export async function requireAdmin() {
  const [{ headers }, { auth }, { getDatabase }] = await Promise.all([
    import("next/headers"),
    import("@/server/auth"),
    import("@/server/db/client"),
  ]);
  const database = getDatabase();
  return requireAdminFrom(
    auth.api.getSession,
    async (userId) => {
      const [record] = await database
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return record?.role ?? null;
    },
    await headers(),
  );
}
