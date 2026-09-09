import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/server/auth";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs, passkey, session, staffSecurity, staffSecurityPolicy, staffSessionSecurity, user } from "@/server/db/schema";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";
import { HttpError } from "./require-session";
import { assertStaffSecurity, loadStaffSecurity, writeSecurityAudit } from "./staff-security-runtime";
import { STAFF_ROLES } from "./staff-security-policy";
import { inviteStaff } from "./staff-invitation";
import { changeStaffSecurity } from "./staff-management";

const noStore = { "Cache-Control": "no-store" };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), name: z.string().trim().min(1).max(120), email: z.email().trim().toLowerCase(), role: z.enum(STAFF_ROLES) }).strict(),
  z.object({ action: z.literal("revoke"), sessionId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("revoke-others") }).strict(),
  z.object({ action: z.literal("enforce") }).strict(),
  z.object({ action: z.literal("change-staff"), userId: z.string().min(1), role: z.enum(STAFF_ROLES), enabled: z.boolean(), expiresAt: z.iso.datetime().nullable() }).strict(),
]);

async function currentStaff(request: Request) {
  const current = await auth.api.getSession({ headers: request.headers });
  if (!current) throw new HttpError("Sign in to manage account security.", 401);
  const staff = await loadStaffSecurity(current.user.id);
  if (!staff?.enabled || (staff.expiresAt && staff.expiresAt.getTime() <= Date.now())) throw new HttpError("Forbidden", 403);
  return { current, staff };
}

export async function getStaffSecurity(request: Request) {
  try {
    const { current, staff } = await currentStaff(request);
    const database = getDatabase();
    const sessions = await database.select({ id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt, userAgent: session.userAgent, lastActiveAt: staffSessionSecurity.lastActiveAt })
      .from(session).leftJoin(staffSessionSecurity, eq(session.id, staffSessionSecurity.sessionId)).where(eq(session.userId, current.user.id));
    const keys = await database.select({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt }).from(passkey).where(eq(passkey.userId, current.user.id));
    const [identity] = await database.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, current.user.id));
    const [policy] = await database.select({ enforcedAt: staffSecurityPolicy.enforcedAt }).from(staffSecurityPolicy).limit(1);
    let staffAccounts: { id: string; name: string; email: string; role: string; enabled: boolean; twoFactorEnabled: boolean; expiresAt: Date | null; lastLoginAt: Date | null }[] | undefined;
    if (["owner", "admin"].includes(staff.role)) {
      try {
        await assertStaffSecurity(current);
        staffAccounts = await database.select({ id: user.id, name: user.name, email: user.email, role: staffSecurity.role, enabled: staffSecurity.enabled, expiresAt: staffSecurity.expiresAt, twoFactorEnabled: user.twoFactorEnabled, lastLoginAt: sql<Date | null>`(select max(${adminAuditLogs.createdAt}) from ${adminAuditLogs} where ${adminAuditLogs.actorUserId} = ${user.id} and ${adminAuditLogs.action} = 'security.LOGIN_SUCCESS' and ${adminAuditLogs.result} = 'success')` })
          .from(staffSecurity).innerJoin(user, eq(staffSecurity.userId, user.id));
      } catch { /* Enrollment view intentionally omits staff records. */ }
    }
    // Profile and device metadata are visible during enrollment; business data is not.
    return Response.json({ staffAccounts, role: staff.role, twoFactorEnabled: identity?.twoFactorEnabled ?? false, passkeys: keys,
      sessions: sessions.filter((s) => s.expiresAt.getTime() > Date.now()).map((s) => ({ ...s, current: s.id === current.session.id })),
      fallbackVerified: Boolean(staff.fallbackVerifiedAt), enforced: Boolean(policy?.enforcedAt),
    }, { headers: noStore });
  } catch (error) { return failure(error); }
}

export async function postStaffSecurity(request: Request) {
  try {
    assertTrustedMutationRequest(request);
    const { current } = await currentStaff(request);
    const parsed = actionSchema.safeParse(await parseBoundedJson(request, 8192));
    if (!parsed.success) throw new HttpError("Invalid security action.", 422);
    const input = parsed.data;
    await assertStaffSecurity(current, undefined, true);
    const database = getDatabase();
    const context = await auth.$context;
    if (input.action === "invite") {
      await inviteStaff(current, input, { hash: context.password.hash, sendSetup: (email) => auth.api.requestPasswordReset({ body: { email, redirectTo: "https://rnrgallery.com/account/reset-password" } }) });
      await writeSecurityAudit({ event: "STAFF_INVITED", userId: current.user.id, email: current.user.email, success: true, headers: request.headers });
    } else if (input.action === "change-staff") {
      await changeStaffSecurity(current, input.userId, { role: input.role, enabled: input.enabled, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }, (id) => context.internalAdapter.deleteUserSessions(id));
    } else if (input.action === "revoke" || input.action === "revoke-others") {
      const targets = await database.select({ token: session.token }).from(session).where(and(
        eq(session.userId, current.user.id), input.action === "revoke" ? eq(session.id, input.sessionId) : ne(session.id, current.session.id),
      ));
      for (const target of targets) await context.internalAdapter.deleteSession(target.token);
      await writeSecurityAudit({ event: input.action === "revoke" ? "SESSION_REVOKED" : "ALL_SESSIONS_REVOKED", userId: current.user.id, email: current.user.email, success: true, headers: request.headers });
    } else {
      await database.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_access_change'))`);
        const [owner] = await transaction.select().from(staffSecurity).where(eq(staffSecurity.userId, current.user.id)).limit(1);
        if (!owner?.enabled || owner.role !== "owner" || (owner.expiresAt && owner.expiresAt.getTime() <= Date.now())) throw new HttpError("Forbidden", 403);
        const [identity] = await transaction.select({ enabled: user.twoFactorEnabled }).from(user).where(eq(user.id, current.user.id));
        const keys = await transaction.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, current.user.id)).limit(1);
        if (!identity?.enabled || !keys.length || !owner.fallbackVerifiedAt) throw new HttpError("Complete a Passkey, authenticator setup and a fallback sign-in first.", 409);
        await transaction.update(staffSecurityPolicy).set({ enforcedAt: new Date() }).where(eq(staffSecurityPolicy.id, "primary"));
      });
      await writeSecurityAudit({ event: "SECURITY_SETTING_CHANGED", userId: current.user.id, email: current.user.email, success: true, headers: request.headers });
    }
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  const status = error instanceof HttpError ? error.status : typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  return Response.json({ error: status < 500 && error instanceof Error ? error.message : "The security action could not be completed." }, { status, headers: noStore });
}
