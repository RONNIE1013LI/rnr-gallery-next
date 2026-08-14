import { eq } from "drizzle-orm";

import { user } from "@/server/db/schema";
import { HttpError, requireSessionFrom } from "@/server/auth/require-session";
import {
  hasFormPermission,
  isFormAccessProfile,
  isFormCapableRole,
  type FormAccessProfile,
  type FormCapableRole,
  type FormPermission,
} from "./forms-permissions";

type SessionWithUser = Readonly<{
  user: Readonly<{ id: string; name?: string; email?: string }>;
}>;

type SessionGetter<T extends SessionWithUser> = (
  context: { headers: Headers },
) => Promise<T | null>;

type StoredFormAccess = Readonly<{
  role: unknown;
  profile: unknown;
}>;

export type FormAccess<T extends SessionWithUser = SessionWithUser> = T &
  Readonly<{
    formRole: FormCapableRole;
    formProfile: FormAccessProfile | null;
  }>;

export async function requireFormPermissionFrom<T extends SessionWithUser>(
  getSession: SessionGetter<T>,
  findAccess: (userId: string) => Promise<StoredFormAccess>,
  requestHeaders: Headers,
  permission: FormPermission,
): Promise<FormAccess<T>> {
  const session = await requireSessionFrom(getSession, requestHeaders);
  const stored = await findAccess(session.user.id);
  const profile = isFormAccessProfile(stored.profile) ? stored.profile : null;
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
  const [{ getDatabase }, { formUserAccess }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/db/schema"),
  ]);
  const [record] = await getDatabase()
    .select({
      role: user.role,
      preset: formUserAccess.preset,
      assignedOnly: formUserAccess.assignedOnly,
      permissions: formUserAccess.permissions,
    })
    .from(user)
    .leftJoin(formUserAccess, eq(formUserAccess.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  return {
    role: record?.role ?? null,
    profile: record?.preset && record.permissions
      ? {
          preset: record.preset,
          assignedOnly: record.assignedOnly ?? false,
          permissions: record.permissions,
        }
      : null,
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
