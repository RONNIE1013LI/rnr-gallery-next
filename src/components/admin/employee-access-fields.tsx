"use client";

import type { AdminPermission } from "@/server/auth/admin-permissions";
import {
  normalizeStaffAccessProfile,
  type StaffAccessProfile,
} from "@/server/auth/staff-access-profile";
import { type FormPermission } from "@/server/forms/forms-permissions";
import { FORM_PERMISSION_KEYS } from "@/domain/forms/forms-parity";
import styles from "./admin.module.css";

type PermissionDefinition<T extends string> = Readonly<{ key: T; label: string }>;
type PermissionGroup<T extends string> = Readonly<{
  label: string;
  permissions: readonly PermissionDefinition<T>[];
}>;

const adminGroups = [
  { label: "Dashboard", permissions: [{ key: "access_admin", label: "Administration dashboard" }] },
  { label: "Orders", permissions: [{ key: "view_orders", label: "View orders" }, { key: "update_order_status", label: "Update order status" }] },
  { label: "Customers", permissions: [{ key: "view_customers", label: "View customers" }] },
  { label: "Production", permissions: [
    { key: "view_production_jobs", label: "View production jobs" }, { key: "create_manual_jobs", label: "Create manual jobs" },
    { key: "update_production_jobs", label: "Update production jobs" }, { key: "view_production_files", label: "View production files" },
    { key: "upload_production_files", label: "Upload production files" }, { key: "review_production_proofs", label: "Review production proofs" },
    { key: "manage_production_views", label: "Manage production views" }, { key: "view_production_reports", label: "View production reports" },
    { key: "export_production_jobs", label: "Export production jobs" }, { key: "manage_production_fields", label: "Manage production fields" },
    { key: "view_production_finance", label: "View production finance" }, { key: "update_production_finance", label: "Update production finance" },
  ] },
  { label: "Catalogue", permissions: [{ key: "manage_gallery", label: "Manage gallery" }, { key: "manage_prices", label: "Manage prices" }, { key: "delete_media", label: "Delete media" }] },
  { label: "Content", permissions: [{ key: "manage_content", label: "Manage content" }, { key: "publish_content", label: "Publish content" }] },
  { label: "Commerce", permissions: [{ key: "manage_payment", label: "Manage payment" }, { key: "update_payment_status", label: "Update payment status" }, { key: "record_refund", label: "Record refunds" }, { key: "manage_shipping", label: "Manage shipping" }] },
  { label: "Oversight and support", permissions: [{ key: "view_audit", label: "View audit log" }, { key: "use_reply_assistant", label: "Use reply assistant" }] },
] as const satisfies readonly PermissionGroup<Exclude<AdminPermission, "manage_roles">>[];

const formGroups = [
  { label: "Order Entry", permissions: [
    { key: "access_forms", label: "Open Order Entry" }, { key: "view_jobs", label: "View Forms jobs" },
    { key: "create_jobs", label: "Create Forms jobs" }, { key: "update_jobs", label: "Update Forms jobs" },
    { key: "delete_jobs", label: "Delete Forms jobs" }, { key: "view_customer_contact", label: "View customer contact" },
    { key: "view_finance", label: "View Forms finance" }, { key: "update_finance", label: "Update Forms finance" },
    { key: "view_payment_proof", label: "View payment proof" }, { key: "view_files", label: "View Forms files" },
    { key: "upload_files", label: "Upload Forms files" }, { key: "delete_files", label: "Delete Forms files" },
    { key: "update_production_status", label: "Update production status" }, { key: "update_delivery_status", label: "Update delivery status" },
    { key: "view_stats", label: "View Forms statistics" }, { key: "manage_stats", label: "Manage Forms statistics" },
    { key: "export_jobs", label: "Export Forms jobs" }, { key: "manage_views", label: "Manage Forms views" },
    { key: "view_audit", label: "View Forms audit" },
  ] },
] as const satisfies readonly PermissionGroup<FormPermission>[];

export function emptyStaffAccessProfile(): StaffAccessProfile {
  return normalizeStaffAccessProfile({
    adminPermissions: [],
    formPermissions: {},
    assignedOnly: false,
  });
}

function normalise(
  profile: StaffAccessProfile,
  adminPermissions: Iterable<AdminPermission> = profile.adminPermissions,
  formPermissions: Readonly<Record<FormPermission, boolean>> = profile.formPermissions,
  assignedOnly = profile.assignedOnly,
) {
  return normalizeStaffAccessProfile({
    adminPermissions: [...adminPermissions],
    formPermissions: Object.fromEntries(
      FORM_PERMISSION_KEYS.map((permission) => [permission, Boolean(formPermissions[permission])]),
    ),
    assignedOnly,
  });
}

export function EmployeeAccessFields({
  profile,
  onChange,
  disabled = false,
}: Readonly<{
  profile: StaffAccessProfile;
  onChange: (profile: StaffAccessProfile) => void;
  disabled?: boolean;
}>) {
  function updateAdmin(permission: AdminPermission, checked: boolean) {
    const selected = new Set(profile.adminPermissions);
    if (checked) selected.add(permission); else selected.delete(permission);
    onChange(normalise(profile, selected));
  }

  function updateForm(permission: FormPermission, checked: boolean) {
    onChange(normalise(profile, profile.adminPermissions, { ...profile.formPermissions, [permission]: checked }));
  }

  function updateGroup<T extends AdminPermission | FormPermission>(
    group: PermissionGroup<T>,
    selected: boolean,
    kind: "admin" | "forms",
  ) {
    if (kind === "admin") {
      const permissions = new Set(profile.adminPermissions);
      for (const permission of group.permissions) {
        if (selected) permissions.add(permission.key as AdminPermission); else permissions.delete(permission.key as AdminPermission);
      }
      onChange(normalise(profile, permissions));
      return;
    }
    const formPermissions = { ...profile.formPermissions };
    for (const permission of group.permissions) formPermissions[permission.key as FormPermission] = selected;
    onChange(normalise(profile, profile.adminPermissions, formPermissions));
  }

  return <div className={styles.employeeAccessFields}>
    <p className={styles.permissionHint}>Selecting a permission automatically includes the access it depends on. Permission changes are checked on the server.</p>
    <div className={styles.permissionColumns}>
      <section aria-labelledby="admin-permissions-heading">
        <h2 id="admin-permissions-heading">Admin permissions</h2>
        {adminGroups.map((group) => <fieldset className={styles.permissionGroup} key={group.label}>
          <legend>{group.label} permissions</legend>
          <div className={styles.permissionGroupActions}>
            <button type="button" disabled={disabled} onClick={() => updateGroup(group, true, "admin")}>Select all {group.label} permissions</button>
            <button type="button" disabled={disabled} onClick={() => updateGroup(group, false, "admin")}>Clear {group.label} permissions</button>
          </div>
          <div className={styles.permissionOptions}>
            {group.permissions.map((permission) => <label key={permission.key}>
              <input type="checkbox" disabled={disabled} checked={profile.adminPermissions.includes(permission.key)} onChange={(event) => updateAdmin(permission.key, event.target.checked)} />
              <span>{permission.label}</span>
            </label>)}
          </div>
        </fieldset>)}
      </section>
      <section aria-labelledby="forms-permissions-heading">
        <h2 id="forms-permissions-heading">Forms / Order Entry permissions</h2>
        {formGroups.map((group) => <fieldset className={styles.permissionGroup} key={group.label}>
          <legend>{group.label} permissions</legend>
          <div className={styles.permissionGroupActions}>
            <button type="button" disabled={disabled} onClick={() => updateGroup(group, true, "forms")}>Select all {group.label} permissions</button>
            <button type="button" disabled={disabled} onClick={() => updateGroup(group, false, "forms")}>Clear {group.label} permissions</button>
          </div>
          <div className={styles.permissionOptions}>
            {group.permissions.map((permission) => <label key={permission.key}>
              <input type="checkbox" disabled={disabled} checked={profile.formPermissions[permission.key]} onChange={(event) => updateForm(permission.key, event.target.checked)} />
              <span>{permission.label}</span>
            </label>)}
          </div>
        </fieldset>)}
        <label className={styles.assignedOnlyField}>
          <input aria-label="Only assigned Forms jobs" type="checkbox" disabled={disabled} checked={profile.assignedOnly} onChange={(event) => onChange(normalise(profile, profile.adminPermissions, profile.formPermissions, event.target.checked))} />
          <span><strong>Only assigned Forms jobs</strong><small>Limit Forms work to jobs assigned to this employee.</small></span>
        </label>
      </section>
    </div>
  </div>;
}
