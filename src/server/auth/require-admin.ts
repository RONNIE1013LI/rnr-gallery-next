import { eq } from "drizzle-orm";
import { user } from "@/server/db/schema";
import {
  hasAdminPermission,
  isAdminRole,
  type AdminPermission,
  type AdminRole,
} from "./admin-permissions";
import { HttpError, requireSessionFrom } from "./require-session";

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
  Readonly<{ adminRole: AdminRole }>;

export async function requireAdminPermissionFrom<T extends SessionWithUser>(
  getSession: SessionGetter<T>,
  findRole: (userId: string) => Promise<unknown>,
  requestHeaders: Headers,
  permission: AdminPermission,
): Promise<AdminAccess<T>> {
  const session = await requireSessionFrom(getSession, requestHeaders);
  const role = await findRole(session.user.id);
  if (!isAdminRole(role) || !hasAdminPermission(role, permission)) {
    throw new HttpError("Forbidden", 403);
  }
  return Object.freeze({ ...session, adminRole: role });
}

async function roleForUser(userId: string) {
  const { getDatabase } = await import("@/server/db/client");
  const [record] = await getDatabase()
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return record?.role ?? null;
}

export async function requireAdminPermission(permission: AdminPermission) {
  const [{ headers }, { auth }] = await Promise.all([
    import("next/headers"),
    import("@/server/auth"),
  ]);
  return requireAdminPermissionFrom(
    auth.api.getSession,
    roleForUser,
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
