export type AdminRole = "admin" | "staff";

export type AdminPermission =
  | "access_admin"
  | "view_orders"
  | "update_order_status"
  | "update_payment_status"
  | "record_refund"
  | "view_customers"
  | "manage_gallery"
  | "manage_content"
  | "publish_content"
  | "manage_prices"
  | "manage_shipping"
  | "manage_payment"
  | "delete_media"
  | "view_audit"
  | "manage_roles"
  | "view_production_jobs"
  | "create_manual_jobs"
  | "update_production_jobs"
  | "view_production_finance"
  | "update_production_finance"
  | "view_production_files"
  | "upload_production_files"
  | "review_production_proofs"
  | "manage_production_views"
  | "view_production_reports"
  | "export_production_jobs"
  | "manage_production_fields"
  | "use_reply_assistant";

const staffPermissions = new Set<AdminPermission>([
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
]);

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "admin" || value === "staff";
}

export function hasAdminPermission(
  role: unknown,
  permission: AdminPermission,
): boolean {
  if (role === "admin") return true;
  return role === "staff" && staffPermissions.has(permission);
}
