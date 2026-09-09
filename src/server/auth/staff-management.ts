import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { adminStaffAccess, staffSecurity, user } from "@/server/db/schema";
import { mayManageStaff, staffRoleAllows, staffRoleAllowsForm, type StaffRole } from "./staff-security-policy";
import { ADMIN_PERMISSION_KEYS } from "./admin-permissions";
import { FORM_PERMISSION_KEYS } from "@/domain/forms/forms-parity";
import { HttpError } from "./require-session";
import { assertStaffSecurity, writeSecurityAudit, type SecuritySession } from "./staff-security-runtime";

export async function changeStaffSecurity(actor: SecuritySession, targetUserId: string, input: {
  role: StaffRole; enabled: boolean; expiresAt: Date | null;
}, revokeSessions: (userId: string) => Promise<void>) {
  await assertStaffSecurity(actor, undefined, true);
  const database = getDatabase();
  let event = "ROLE_CHANGED";
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_access_change'))`);
    const [currentActor] = await transaction.select().from(staffSecurity).where(eq(staffSecurity.userId, actor.user.id)).limit(1);
    const [target] = await transaction.select().from(staffSecurity).where(eq(staffSecurity.userId, targetUserId)).limit(1);
    if (!currentActor?.enabled || !target || !mayManageStaff(currentActor.role, target.role, input.role)) throw new HttpError("Forbidden", 403);
    if (actor.user.id === targetUserId && input.role !== target.role && currentActor.role !== "owner") throw new HttpError("Forbidden", 403);
    event = !input.enabled ? "STAFF_DISABLED" : !target.enabled ? "STAFF_REACTIVATED" : "ROLE_CHANGED";
    const losesOwner = target.role === "owner" && (input.role !== "owner" || !input.enabled || input.expiresAt !== null);
    if (losesOwner) {
      const owners = await transaction.select({ id: staffSecurity.userId }).from(staffSecurity)
        .where(and(eq(staffSecurity.role, "owner"), eq(staffSecurity.enabled, true), sql`(${staffSecurity.expiresAt} is null or ${staffSecurity.expiresAt} > now())`));
      if (owners.length <= 1) throw new HttpError("The last Owner cannot be removed or disabled.", 409);
    }
    if (input.role === "owner" && input.expiresAt) throw new HttpError("Owner accounts cannot expire.", 422);
    await transaction.update(staffSecurity).set({ ...input, updatedAt: new Date() }).where(eq(staffSecurity.userId, targetUserId));
    await transaction.update(user).set({ role: input.role === "owner" || input.role === "admin" ? "admin" : "staff" }).where(eq(user.id, targetUserId));
    // Status/expiry changes must not replace individually assigned business permissions.
    if (input.role !== target.role) {
      const profile = {
        adminPermissions: ADMIN_PERMISSION_KEYS.filter((permission) => staffRoleAllows(input.role, permission)),
        formPermissions: Object.fromEntries(FORM_PERMISSION_KEYS.map((permission) => [permission, staffRoleAllowsForm(input.role, permission)])),
        assignedOnly: input.role === "designer" || input.role === "temporary",
      };
      await transaction.insert(adminStaffAccess).values({ userId: targetUserId, ...profile })
        .onConflictDoUpdate({ target: adminStaffAccess.userId, set: profile });
    }
  });
  await revokeSessions(targetUserId);
  await writeSecurityAudit({ event, userId: actor.user.id, email: actor.user.email, targetUserId, success: true });
}
