import { eq } from "drizzle-orm";

import { adminStaffAccess, formUserAccess, user } from "@/server/db/schema";
import { HttpError, requireSessionFrom } from "@/server/auth/require-session";
import {
  hasFormPermission,
  isFormAccessProfile,
  isFormCapableRole,
  type FormAccessProfile,
  type FormCapableRole,
  type FormPermission,
} from "./forms-permissions";
import {
  isStaffAccessProfile,
  type StaffAccessProfile,
} from "@/server/auth/staff-access-profile";

type SessionWithUser = Readonly<{
  user: Readonly<{ id: string; name?: string; email?: string }>;
}>;

type SessionGetter<T extends SessionWithUser> = (
  context: { headers: Headers },
) => Promise<T | null>;

type StoredFormAccess = Readonly<{
  role: unknown;
  profile: FormAccessProfile | StaffAccessProfile | null;
}>;

export type FormAccess<T extends SessionWithUser = SessionWithUser> = T &
  Readonly<{
    formRole: FormCapableRole;
    formProfile: FormAccessProfile | StaffAccessProfile | null;
  }>;

export async function requireFormPermissionFrom<T extends SessionWithUser>(
  getSession: SessionGetter<T>,
  findAccess: (userId: string) => Promise<StoredFormAccess>,
  requestHeaders: Headers,
  permission: FormPermission,
): Promise<FormAccess<T>> {
  const session = await requireSessionFrom(getSession, requestHeaders);
  const stored = await findAccess(session.user.id);
  const profile = stored.role === "staff"
    ? (isStaffAccessProfile(stored.profile) ? stored.profile : null)
    : (isFormAccessProfile(stored.profile) ? stored.profile : null);
  if (
    !isFormCapableRole(stored.role) ||
    !hasFormPermission(stored.role, profile, permission)
  ) {
    throw new HttpError("Forbidden", 403);
  }
  return Object.freeze({
    ...session,
    formRole: stored.role,
    formProfile: profile,
  });
}

async function accessForUser(userId: string): Promise<StoredFormAccess> {
  const { getDatabase } = await import("@/server/db/client");
  const [record] = await getDatabase()
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
  return {
    role: record?.role ?? null,
    profile: record?.role === "staff"
      ? (isStaffAccessProfile(staffProfile) ? staffProfile : null)
      : isFormAccessProfile(presetProfile) ? presetProfile : null,
  };
}

export async function requireFormPermission(permission: FormPermission) {
  const [{ headers }, { auth }] = await Promise.all([
    import("next/headers"),
    import("@/server/auth"),
  ]);
  return requireFormPermissionFrom(
    auth.api.getSession,
    accessForUser,
    await headers(),
    permission,
  );
}
