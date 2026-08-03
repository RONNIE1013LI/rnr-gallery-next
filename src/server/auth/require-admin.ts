import { eq } from "drizzle-orm";
import { user } from "@/server/db/schema";
import { HttpError, requireSessionFrom } from "./require-session";

type SessionWithUser = Readonly<{ user: Readonly<{ id: string }> }>;
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
