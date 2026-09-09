import { eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { adminAuditLogs, staffSecurity, staffSecurityPolicy, user } from "@/server/db/schema";
import { STAFF_ROLES, type StaffRole } from "./staff-security-policy";

// Administrative deployment operation, never exposed as an HTTP recovery route.
// The migration and exact account mapping require separate Production approval.
export async function bootstrapStaffSecurity(input: { ownerId: string; staffRoles: Record<string, Exclude<StaffRole, "owner">> }, database = getDatabase()) {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('rnr_admin_user_access_change'))`);
    const [existing] = await transaction.select().from(staffSecurityPolicy).limit(1);
    if (existing) throw new Error("Staff security is already activated; bootstrap cannot be reused.");
    const members = await transaction.select({ id: user.id, role: user.role, email: user.email, emailVerified: user.emailVerified, createdAt: user.createdAt }).from(user)
      .where(inArray(user.role, ["admin", "staff", "form_staff"]));
    const owner = members.find((member) => member.id === input.ownerId);
    if (!owner || owner.role !== "admin" || !owner.emailVerified) throw new Error("The explicitly selected Owner must be an existing verified administrator.");
    const others = members.filter((member) => member.id !== owner.id);
    if (Object.keys(input.staffRoles).length !== others.length || others.some((member) => !Object.hasOwn(input.staffRoles, member.id) || !STAFF_ROLES.includes(input.staffRoles[member.id]) || (input.staffRoles[member.id] as string) === "owner")) {
      throw new Error("An explicit role mapping for every existing staff member is required.");
    }
    const rolloutAt = new Date();
    await transaction.insert(staffSecurity).values(members.map((member) => ({
      userId: member.id, role: member.id === owner.id ? "owner" as const : input.staffRoles[member.id],
      createdAt: member.createdAt, updatedAt: rolloutAt,
    })));
    await transaction.insert(staffSecurityPolicy).values({ id: "primary", rolloutAt, activatedBy: owner.id });
    await transaction.insert(adminAuditLogs).values({ actorUserId: owner.id, actorEmail: owner.email, action: "security.SECURITY_SETTING_CHANGED", resourceType: "staff_security", resourceId: owner.id, result: "success", idempotencyKey: "staff-security-bootstrap-v1", afterSummary: { stage: "enrollment", staffCount: members.length } });
    return { stage: "enrollment", staffCount: members.length };
  });
}
