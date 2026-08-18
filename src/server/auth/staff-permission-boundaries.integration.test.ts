import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminStaffAccess,
  formUserAccess,
  user,
} from "@/server/db/schema";
import { requireAdminPermissionFrom } from "./require-admin";
import { normalizeStaffAccessProfile, isStaffAccessProfile } from "./staff-access-profile";
import { requireFormPermissionFrom } from "@/server/forms/require-forms";
import { buildFormAccessProfile, isFormAccessProfile } from "@/server/forms/forms-permissions";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const ids = {
  admin: `boundary-admin-${suffix}`,
  orderViewer: `boundary-orders-${suffix}`,
  paymentOperator: `boundary-payments-${suffix}`,
  assignedArtist: `boundary-artist-${suffix}`,
  contentEditor: `boundary-content-${suffix}`,
  missingProfile: `boundary-missing-${suffix}`,
  unknownKeyProfile: `boundary-unknown-${suffix}`,
  malformedProfile: `boundary-malformed-${suffix}`,
  formStaff: `boundary-form-staff-${suffix}`,
} as const;
type UserInsert = typeof user.$inferInsert;
type StaffAccessInsert = typeof adminStaffAccess.$inferInsert;

function sessionFor(id: string) {
  return { user: { id, email: `${id}@example.test` } };
}

async function findAdminAccess(userId: string) {
  const [record] = await database
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
  const profile = record?.adminPermissions && record.formPermissions
    ? {
        adminPermissions: record.adminPermissions,
        formPermissions: record.formPermissions,
        assignedOnly: record.assignedOnly ?? false,
      }
    : null;
  return { role: record?.role ?? null, profile: isStaffAccessProfile(profile) ? profile : null };
}

async function findFormAccess(userId: string) {
  const [record] = await database
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
  const profile = record?.role === "staff"
    ? (isStaffAccessProfile(staffProfile) ? staffProfile : null)
    : (isFormAccessProfile(presetProfile) ? presetProfile : null);
  return { role: record?.role ?? null, profile };
}

function requireAdmin(id: string, permission: Parameters<typeof requireAdminPermissionFrom>[3]) {
  return requireAdminPermissionFrom(
    async () => sessionFor(id),
    findAdminAccess,
    new Headers(),
    permission,
  );
}

function requireForm(id: string, permission: Parameters<typeof requireFormPermissionFrom>[3]) {
  return requireFormPermissionFrom(
    async () => sessionFor(id),
    findFormAccess,
    new Headers(),
    permission,
  );
}

describe("stored staff permission boundaries", () => {
  beforeAll(async () => {
    const users: UserInsert[] = [
      ...Object.entries(ids).map(([name, id]) => ({
        id,
        name,
        email: `${id}@example.test`,
        role: (name === "admin" ? "admin" : name === "formStaff" ? "form_staff" : "staff") as UserInsert["role"],
      })),
    ];
    const profiles: StaffAccessInsert[] = [
      {
        userId: ids.orderViewer,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: ["access_admin", "view_orders"],
          formPermissions: {},
          assignedOnly: false,
        })),
      },
      {
        userId: ids.paymentOperator,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: ["access_admin", "view_orders", "manage_payment"],
          formPermissions: {},
          assignedOnly: false,
        })),
      },
      {
        userId: ids.assignedArtist,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: [],
          formPermissions: { access_forms: true, view_jobs: true, view_files: true },
          assignedOnly: true,
        })),
      },
      {
        userId: ids.contentEditor,
        ...toStaffAccessInsert(normalizeStaffAccessProfile({
          adminPermissions: ["access_admin", "manage_content"],
          formPermissions: {},
          assignedOnly: false,
        })),
      },
      {
        userId: ids.unknownKeyProfile,
        adminPermissions: ["unknown_permission"] as never,
        formPermissions: {} as never,
        assignedOnly: false,
      },
      {
        userId: ids.malformedProfile,
        adminPermissions: [],
        formPermissions: { access_forms: "yes" } as never,
        assignedOnly: false,
      },
    ];
    await database.insert(user).values(users);
    await database.insert(adminStaffAccess).values(profiles);
    const artistProfile = buildFormAccessProfile("artist");
    await database.insert(formUserAccess).values({
      userId: ids.formStaff,
      preset: "artist",
      assignedOnly: artistProfile.assignedOnly,
      permissions: { ...artistProfile.permissions },
    });
  });

  afterAll(async () => {
    await database.delete(user).where(eq(user.id, ids.admin));
    await database.delete(user).where(eq(user.id, ids.orderViewer));
    await database.delete(user).where(eq(user.id, ids.paymentOperator));
    await database.delete(user).where(eq(user.id, ids.assignedArtist));
    await database.delete(user).where(eq(user.id, ids.contentEditor));
    await database.delete(user).where(eq(user.id, ids.missingProfile));
    await database.delete(user).where(eq(user.id, ids.unknownKeyProfile));
    await database.delete(user).where(eq(user.id, ids.malformedProfile));
    await database.delete(user).where(eq(user.id, ids.formStaff));
  });

  it("grants an order viewer only its stored order profile", async () => {
    await expect(requireAdmin(ids.orderViewer, "view_orders")).resolves.toMatchObject({
      adminRole: "staff",
      adminPermissions: ["access_admin", "view_orders"],
    });
    for (const permission of ["manage_payment", "record_refund", "view_production_finance", "view_audit", "manage_roles"] as const) {
      await expect(requireAdmin(ids.orderViewer, permission)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("allows Payment Requests only for the payment operator profile", async () => {
    await expect(requireAdmin(ids.paymentOperator, "manage_payment")).resolves.toMatchObject({
      adminPermissions: ["access_admin", "view_orders", "manage_payment"],
    });
    for (const permission of ["update_payment_status", "record_refund", "view_audit", "manage_roles"] as const) {
      await expect(requireAdmin(ids.paymentOperator, permission)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("keeps assigned artists scoped to non-financial, non-contact Forms access", async () => {
    await expect(requireForm(ids.assignedArtist, "view_jobs")).resolves.toMatchObject({
      formRole: "staff",
      formProfile: expect.objectContaining({ assignedOnly: true }),
    });
    await expect(requireForm(ids.assignedArtist, "view_files")).resolves.toMatchObject({ formRole: "staff" });
    for (const permission of ["view_customer_contact", "view_finance", "update_finance"] as const) {
      await expect(requireForm(ids.assignedArtist, permission)).rejects.toMatchObject({ status: 403 });
    }
    await expect(requireAdmin(ids.assignedArtist, "view_production_finance")).rejects.toMatchObject({ status: 403 });
  });

  it("does not turn content editing into publishing or other Admin powers", async () => {
    await expect(requireAdmin(ids.contentEditor, "manage_content")).resolves.toMatchObject({
      adminPermissions: ["access_admin", "manage_content"],
    });
    for (const permission of ["publish_content", "manage_payment", "view_audit", "manage_roles"] as const) {
      await expect(requireAdmin(ids.contentEditor, permission)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("fails closed for missing, unknown-key, or malformed Staff profiles", async () => {
    for (const id of [ids.missingProfile, ids.unknownKeyProfile, ids.malformedProfile]) {
      await expect(requireAdmin(id, "view_orders")).rejects.toMatchObject({ status: 403 });
      await expect(requireForm(id, "view_jobs")).rejects.toMatchObject({ status: 403 });
    }
  });

  it("preserves database-admin and form_staff compatibility without delegating roles", async () => {
    await expect(requireAdmin(ids.admin, "manage_roles")).resolves.toMatchObject({ adminRole: "admin" });
    await expect(requireForm(ids.admin, "update_finance")).resolves.toMatchObject({ formRole: "admin" });
    await expect(requireForm(ids.formStaff, "view_jobs")).resolves.toMatchObject({ formRole: "form_staff" });
    await expect(requireAdmin(ids.formStaff, "view_orders")).rejects.toMatchObject({ status: 403 });
  });
});

function toStaffAccessInsert(profile: ReturnType<typeof normalizeStaffAccessProfile>) {
  return {
    adminPermissions: [...profile.adminPermissions],
    formPermissions: { ...profile.formPermissions },
    assignedOnly: profile.assignedOnly,
  };
}
