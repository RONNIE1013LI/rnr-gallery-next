import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs, session as nativeSession, staffSecurity, staffSecurityPolicy, staffSessionSecurity } from "@/server/db/schema";
import { HttpError } from "./require-session";
import { evaluateStaffSession, staffRoleAllows, STAFF_ELEVATION_MS, type StaffRole } from "./staff-security-policy";

export class StaffSecurityError extends HttpError {
  constructor(public readonly reason: "mfa_required" | "step_up_required" | "expired" | "disabled") {
    super(reason === "mfa_required" ? "Set up or verify your staff authentication." : reason === "step_up_required" ? "Verify your identity before this action." : "Sign in again.", reason === "disabled" ? 403 : 401);
  }
}
export type SecuritySession = { user: { id: string; email?: string }; session?: { id: string; createdAt: Date | string; expiresAt: Date | string } };
// manage_payment is an operational Payment Requests grant, not configuration access.
const elevatedPermissions = new Set(["manage_roles", "export_production_jobs", "manage_production_fields"]);

export async function writeSecurityAudit(input: {
  event: string; userId?: string; email?: string; targetUserId?: string; success: boolean; headers?: Headers;
}) {
  await getDatabase().insert(adminAuditLogs).values({
    actorUserId: input.userId ?? "unauthenticated",
    actorEmail: input.email ?? "not-recorded",
    action: `security.${input.event}`,
    resourceType: "staff_security",
    resourceId: input.targetUserId ?? input.userId ?? null,
    result: input.success ? "success" : "failure",
    idempotencyKey: randomUUID(),
    afterSummary: {
      userAgent: input.headers?.get("user-agent")?.slice(0, 250) ?? null,
      ip: process.env.VERCEL === "1" ? input.headers?.get("x-vercel-forwarded-for")?.slice(0, 45) ?? null : null,
    },
  });
}

export async function loadStaffSecurity(userId: string) {
  const [record] = await getDatabase().select().from(staffSecurity).where(eq(staffSecurity.userId, userId)).limit(1);
  return record ?? null;
}

export async function assertStaffSecurity(
  authSession: SecuritySession,
  permission?: string,
  forceElevated = false,
  revokeSession: (sessionId: string) => Promise<void> = async (sessionId) => {
    const [row] = await getDatabase().select({ token: nativeSession.token }).from(nativeSession).where(eq(nativeSession.id, sessionId)).limit(1);
    if (!row) return;
    // Use the native adapter so the existing Redis revocation fences also run.
    const { auth } = await import("@/server/auth");
    await (await auth.$context).internalAdapter.deleteSession(row.token);
  },
): Promise<StaffRole | null> {
  const database = getDatabase();
  const [policy] = await database.select().from(staffSecurityPolicy).where(eq(staffSecurityPolicy.id, "primary")).limit(1);
  // Activation is a separately audited Owner bootstrap, never inferred from email.
  if (!policy) return null;
  const identity = await loadStaffSecurity(authSession.user.id);
  if (!identity?.enabled || !authSession.session) throw new StaffSecurityError("disabled");
  const session = authSession.session;
  const now = new Date();
  const createdAt = new Date(session.createdAt).getTime();
  const rolloutAt = policy.rolloutAt.getTime();
  await database.insert(staffSessionSecurity).values({
    sessionId: session.id, userId: authSession.user.id,
    lastActiveAt: new Date(Math.max(createdAt, rolloutAt)),
  }).onConflictDoNothing();
  const [security] = await database.select().from(staffSessionSecurity).where(and(
    eq(staffSessionSecurity.sessionId, session.id), eq(staffSessionSecurity.userId, authSession.user.id),
  )).limit(1);
  if (!security) throw new StaffSecurityError("expired");
  const decision = evaluateStaffSession({
    // Owner protection is independent of the employee rollout. A pre-rollout
    // Owner session must not be grandfathered without a verified factor.
    mfaRequired: identity.role === "owner" || Boolean(policy.enforcedAt) || identity.createdAt.getTime() >= rolloutAt,
    enabled: identity.enabled, role: identity.role, expiresAt: identity.expiresAt?.getTime() ?? null,
    sessionCreatedAt: createdAt, sessionExpiresAt: new Date(session.expiresAt).getTime(),
    rolloutAt, lastActiveAt: security.lastActiveAt.getTime(),
    mfaAt: security.mfaAt?.getTime() ?? null, elevatedAt: security.elevatedAt?.getTime() ?? null,
  }, now.getTime(), forceElevated || Boolean(permission && elevatedPermissions.has(permission)));
  if (decision !== "allowed") {
    if (decision === "expired" || decision === "disabled") await revokeSession(session.id);
    throw new StaffSecurityError(decision);
  }
  if (permission && !staffRoleAllows(identity.role, permission)) throw new HttpError("Forbidden", 403);
  // Do not let delayed requests move last-active backwards.
  await database.update(staffSessionSecurity).set({ lastActiveAt: sql`greatest(${staffSessionSecurity.lastActiveAt}, ${now})` })
    .where(eq(staffSessionSecurity.sessionId, session.id));
  return identity.role;
}

export async function markStrongStaffSession(authSession: SecuritySession, factor: "passkey" | "totp" | "recovery", fallbackLogin = false) {
  if (!authSession.session) throw new Error("Verified staff session is missing");
  const identity = await loadStaffSecurity(authSession.user.id);
  if (!identity) return;
  if (!identity.enabled) throw new StaffSecurityError("disabled");
  const now = new Date();
  await getDatabase().insert(staffSessionSecurity).values({
    sessionId: authSession.session.id, userId: authSession.user.id,
    mfaAt: now, elevatedAt: factor === "recovery" ? null : now, lastActiveAt: now, factor,
  }).onConflictDoUpdate({ target: staffSessionSecurity.sessionId, set: {
    mfaAt: now, elevatedAt: factor === "recovery" ? null : now, lastActiveAt: now, factor,
  } });
  if (fallbackLogin && (factor === "totp" || factor === "recovery")) {
    await getDatabase().update(staffSecurity).set({ fallbackVerifiedAt: now, updatedAt: now }).where(eq(staffSecurity.userId, authSession.user.id));
  }
}

export async function staffSessionCreationHook<T extends { userId: string }>(created: T) {
  const identity = await loadStaffSecurity(created.userId);
  if (identity && (!identity.enabled || (identity.expiresAt && identity.expiresAt.getTime() <= Date.now()))) return false;
  return { data: created };
}

// Recovery grants only a brief route back to a verified device, never broad
// elevated permissions. The native recovery flow consumed a code and rotated
// the session before this database marker could be written.
export async function canEnrollReplacementPasskey(current: SecuritySession) {
  await assertStaffSecurity(current);
  if (!current.session) return false;
  const [security] = await getDatabase().select().from(staffSessionSecurity).where(and(
    eq(staffSessionSecurity.sessionId, current.session.id), eq(staffSessionSecurity.userId, current.user.id),
  )).limit(1);
  const now = Date.now();
  const verifiedAt = security?.mfaAt?.getTime();
  const createdAt = new Date(current.session.createdAt).getTime();
  return security?.factor === "recovery" && verifiedAt !== undefined && verifiedAt <= now && now - verifiedAt < STAFF_ELEVATION_MS && createdAt <= now && now - createdAt < STAFF_ELEVATION_MS;
}
