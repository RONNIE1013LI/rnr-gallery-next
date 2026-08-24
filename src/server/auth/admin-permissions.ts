export type AdminRole = "admin" | "staff";

export const ADMIN_PERMISSION_KEYS = [
  "access_admin",
  "view_orders",
  "update_order_status",
  "update_payment_status",
  "record_refund",
  "view_customers",
  "manage_gallery",
  "manage_content",
  "publish_content",
  "manage_reviews",
  "publish_reviews",
  "manage_prices",
  "manage_shipping",
  "manage_payment",
  "delete_media",
  "view_audit",
  "manage_roles",
  "view_production_jobs",
  "create_manual_jobs",
  "update_production_jobs",
  "view_production_finance",
  "update_production_finance",
  "view_production_files",
  "upload_production_files",
  "review_production_proofs",
  "manage_production_views",
  "view_production_reports",
  "export_production_jobs",
  "manage_production_fields",
  "use_reply_assistant",
  "review_reply_learning",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION_KEYS)[number];

export const ASSIGNABLE_ADMIN_PERMISSION_KEYS = Object.freeze(
  ADMIN_PERMISSION_KEYS.filter((permission) => permission !== "manage_roles"),
) as readonly Exclude<AdminPermission, "manage_roles">[];

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "admin" || value === "staff";
}

export function hasAdminPermission(
  role: unknown,
  granted: readonly AdminPermission[],
  permission: AdminPermission,
): boolean;
/** @deprecated Pass the resolved grant list so Staff access stays exact. */
export function hasAdminPermission(
  role: unknown,
  permission: AdminPermission,
): boolean;
export function hasAdminPermission(
  role: unknown,
  grantedOrPermission: readonly AdminPermission[] | AdminPermission,
  permission?: AdminPermission,
): boolean {
  const granted = Array.isArray(grantedOrPermission) ? grantedOrPermission : [];
  const requestedPermission = permission ?? grantedOrPermission;
  if (role === "admin") return true;
  return role === "staff" && granted.includes(requestedPermission);
}
