import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { account, adminAuditLogs, adminStaffAccess, staffSecurity, user } from "@/server/db/schema";
import { ADMIN_PERMISSION_KEYS } from "./admin-permissions";
import { FORM_PERMISSION_KEYS } from "@/domain/forms/forms-parity";
import { assertStaffSecurity, type SecuritySession } from "./staff-security-runtime";
import { mayManageStaff, staffRoleAllows, staffRoleAllowsForm, type StaffRole } from "./staff-security-policy";
import { HttpError } from "./require-session";

export async function inviteStaff(actor: SecuritySession, input: { name: string; email: string; role: StaffRole }, runtime: {
  hash: (password: string) => Promise<string>;
  sendSetup: (email: string) => Promise<unknown>;
}) {
  await assertStaffSecurity(actor, undefined, true);
  const passwordHash = await runtime.hash(randomBytes(32).toString("base64url"));
  const id = randomUUID();
  const database = getDatabase();
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_access_change'))`);
    const [sender] = await transaction.select().from(staffSecurity).where(eq(staffSecurity.userId, actor.user.id)).limit(1);
    if (!sender?.enabled || !mayManageStaff(sender.role, input.role, input.role)) throw new HttpError("Forbidden", 403);
    const [existing] = await transaction.select({ id: user.id }).from(user).where(eq(user.email, input.email)).limit(1);
    if (existing) throw new HttpError("Use the existing account's security settings.", 409);
    await transaction.insert(user).values({ id, email: input.email, name: input.name, role: input.role === "admin" || input.role === "owner" ? "admin" : "staff" });
    await transaction.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: passwordHash });
    await transaction.insert(staffSecurity).values({ userId: id, role: input.role });
    await transaction.insert(adminStaffAccess).values({
      userId: id, adminPermissions: ADMIN_PERMISSION_KEYS.filter((permission) => permission !== "manage_roles" && staffRoleAllows(input.role, permission)),
      formPermissions: Object.fromEntries(FORM_PERMISSION_KEYS.map((permission) => [permission, staffRoleAllowsForm(input.role, permission)])),
      assignedOnly: input.role === "designer" || input.role === "temporary",
    });
    await transaction.insert(adminAuditLogs).values({ actorUserId: actor.user.id, actorEmail: actor.user.email ?? "not-recorded", action: "security.STAFF_CREATED", resourceType: "staff_security", resourceId: id, result: "success", idempotencyKey: id, afterSummary: { role: input.role, setupRequired: true } });
  });
  // Reuse Better Auth's short-lived, hashed, single-use password setup token.
  // No initial password is given to the inviting administrator or the employee.
  await runtime.sendSetup(input.email);
  return { id };
}
