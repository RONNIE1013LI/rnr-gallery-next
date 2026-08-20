import { z } from "zod";

import {
  ADMIN_PERMISSION_KEYS,
  ASSIGNABLE_ADMIN_PERMISSION_KEYS,
  type AdminPermission,
} from "./admin-permissions";
import {
  FORM_PERMISSION_KEYS,
} from "@/domain/forms/forms-parity";
import type { FormPermission } from "@/server/forms/forms-permissions";

export type StaffAccessProfile = Readonly<{
  adminPermissions: readonly AdminPermission[];
  formPermissions: Readonly<Record<FormPermission, boolean>>;
  assignedOnly: boolean;
}>;

type PermissionDependencies<TPermission extends string> = Readonly<
  Partial<Record<TPermission, readonly TPermission[]>>
>;

export const STAFF_ACCESS_PROFILE_DEPENDENCIES = Object.freeze({
  admin: Object.freeze({
    access_admin: [],
    view_orders: ["access_admin"],
    update_order_status: ["view_orders"],
    update_payment_status: ["manage_payment", "view_orders"],
    record_refund: ["manage_payment", "view_orders"],
    view_customers: ["access_admin"],
    manage_gallery: ["access_admin"],
    manage_content: ["access_admin"],
    publish_content: ["manage_content"],
    manage_reviews: ["access_admin"],
    publish_reviews: ["manage_reviews"],
    manage_prices: ["access_admin"],
    manage_shipping: ["access_admin"],
    manage_payment: ["access_admin"],
    delete_media: ["access_admin"],
    view_audit: ["access_admin"],
    view_production_jobs: ["access_admin"],
    create_manual_jobs: ["view_production_jobs"],
    update_production_jobs: ["view_production_jobs"],
    view_production_finance: ["view_production_jobs"],
    update_production_finance: ["view_production_finance", "view_production_jobs"],
    view_production_files: ["view_production_jobs"],
    upload_production_files: ["view_production_files"],
    review_production_proofs: ["view_production_files"],
    manage_production_views: ["view_production_jobs"],
    view_production_reports: ["view_production_jobs"],
    export_production_jobs: ["view_production_jobs"],
    manage_production_fields: ["view_production_jobs"],
    use_reply_assistant: ["access_admin"],
  } satisfies PermissionDependencies<Exclude<AdminPermission, "manage_roles">>),
  forms: Object.freeze({
    access_forms: [],
    view_jobs: ["access_forms"],
    create_jobs: ["view_jobs"],
    update_jobs: ["view_jobs"],
    delete_jobs: ["view_jobs"],
    view_customer_contact: ["view_jobs"],
    view_finance: ["view_jobs"],
    update_finance: ["view_finance"],
    view_payment_proof: ["view_files"],
    view_files: ["view_jobs"],
    upload_files: ["view_files"],
    delete_files: ["view_files"],
    update_production_status: ["view_jobs"],
    update_delivery_status: ["view_jobs"],
    view_stats: ["view_jobs"],
    manage_stats: ["view_stats"],
    export_jobs: ["view_jobs"],
    manage_views: ["view_jobs"],
    view_audit: ["view_jobs"],
  } satisfies PermissionDependencies<FormPermission>),
});

const staffAccessProfileInput = z.object({
  adminPermissions: z.array(z.string()),
  formPermissions: z.record(z.string(), z.boolean()),
  assignedOnly: z.boolean(),
}).strict();

function expandDependencies<TPermission extends string>(
  selected: Iterable<TPermission>,
  dependencies: PermissionDependencies<TPermission>,
): Set<TPermission> {
  const expanded = new Set(selected);
  for (const permission of expanded) {
    for (const dependency of dependencies[permission] ?? []) {
      if (!expanded.has(dependency)) expanded.add(dependency);
    }
  }
  return expanded;
}

function isExactAdminPermissionList(value: readonly unknown[]): value is readonly AdminPermission[] {
  return value.every((permission): permission is AdminPermission => (
    typeof permission === "string" && ASSIGNABLE_ADMIN_PERMISSION_KEYS.includes(
      permission as Exclude<AdminPermission, "manage_roles">,
    )
  ));
}

function isExactFormPermissionRecord(
  value: Record<string, boolean>,
): value is Record<FormPermission, boolean> {
  return Object.keys(value).every((permission) => FORM_PERMISSION_KEYS.includes(
    permission as FormPermission,
  ));
}

function invalidEmployeePermissions(): never {
  throw new Error("Invalid employee permissions");
}

export function normalizeStaffAccessProfile(input: unknown): StaffAccessProfile {
  const parsed = staffAccessProfileInput.safeParse(input);
  if (!parsed.success) invalidEmployeePermissions();

  const { adminPermissions, formPermissions, assignedOnly } = parsed.data;
  if (
    !isExactAdminPermissionList(adminPermissions) ||
    new Set(adminPermissions).size !== adminPermissions.length ||
    !isExactFormPermissionRecord(formPermissions)
  ) {
    invalidEmployeePermissions();
  }

  const selectedAdminPermissions = expandDependencies(
    adminPermissions,
    STAFF_ACCESS_PROFILE_DEPENDENCIES.admin,
  );
  const selectedFormPermissions = expandDependencies(
    FORM_PERMISSION_KEYS.filter((permission) => formPermissions[permission]),
    STAFF_ACCESS_PROFILE_DEPENDENCIES.forms,
  );

  return Object.freeze({
    adminPermissions: Object.freeze(
      ADMIN_PERMISSION_KEYS.filter((permission): permission is Exclude<AdminPermission, "manage_roles"> => (
        permission !== "manage_roles" && selectedAdminPermissions.has(permission)
      )),
    ),
    formPermissions: Object.freeze(Object.fromEntries(
      FORM_PERMISSION_KEYS.map((permission) => [permission, selectedFormPermissions.has(permission)]),
    ) as Record<FormPermission, boolean>),
    assignedOnly,
  });
}

export function isStaffAccessProfile(value: unknown): value is StaffAccessProfile {
  try {
    const normalized = normalizeStaffAccessProfile(value);
    const candidate = value as Partial<StaffAccessProfile>;
    return Array.isArray(candidate.adminPermissions) &&
      candidate.adminPermissions.every((permission, index) => permission === normalized.adminPermissions[index]) &&
      candidate.adminPermissions.length === normalized.adminPermissions.length &&
      Boolean(candidate.formPermissions) &&
      FORM_PERMISSION_KEYS.every(
        (permission) => candidate.formPermissions?.[permission] === normalized.formPermissions[permission],
      );
  } catch {
    return false;
  }
}

const LEGACY_STAFF_ADMIN_PERMISSIONS = [
  "access_admin",
  "view_orders",
  "update_order_status",
  "view_customers",
  "manage_gallery",
  "manage_content",
  "view_production_jobs",
  "create_manual_jobs",
  "update_production_jobs",
  "view_production_files",
  "upload_production_files",
  "review_production_proofs",
  "manage_production_views",
  "view_production_reports",
  "use_reply_assistant",
] as const;

const LEGACY_STAFF_FORM_PERMISSIONS = {
  access_forms: true,
  view_jobs: true,
  create_jobs: true,
  update_jobs: true,
  view_customer_contact: true,
  view_files: true,
  upload_files: true,
  update_production_status: true,
  update_delivery_status: true,
  view_stats: true,
  manage_stats: true,
  manage_views: true,
} as const;

export function buildLegacyStaffAccessProfile(): StaffAccessProfile {
  return normalizeStaffAccessProfile({
    adminPermissions: LEGACY_STAFF_ADMIN_PERMISSIONS,
    formPermissions: LEGACY_STAFF_FORM_PERMISSIONS,
    assignedOnly: false,
  });
}
