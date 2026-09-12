import { FORM_PERMISSION_KEYS } from "@/domain/forms/forms-parity";
import { ADMIN_PERMISSION_KEYS } from "./admin-permissions";

export const STAFF_ROLES = ["owner", "admin", "staff", "customer_service", "designer", "production", "temporary"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ELEVATION_MS = 5 * 60_000;

const grants: Record<Exclude<StaffRole, "owner">, readonly string[]> = {
  admin: ADMIN_PERMISSION_KEYS.filter((key) => ![
    "manage_roles", "manage_payment", "update_payment_status", "record_refund",
  ].includes(key)),
  staff: ["access_admin", "view_orders", "manage_payment", "update_payment_status", "record_refund", "manage_shipping", "use_reply_assistant"],
  customer_service: ["access_admin", "view_orders", "view_customers", "update_order_status", "use_reply_assistant", "view_production_jobs", "view_production_files"],
  designer: ["access_admin", "view_production_jobs", "view_production_files", "upload_production_files", "review_production_proofs"],
  production: ["access_admin", "view_production_jobs", "update_production_jobs", "view_production_files"],
  temporary: ["access_admin", "view_production_jobs"],
};

export function staffRoleAllows(role: string, permission: string): boolean {
  if (!ADMIN_PERMISSION_KEYS.includes(permission as (typeof ADMIN_PERMISSION_KEYS)[number])) return false;
  if (role === "owner") return true;
  return Object.hasOwn(grants, role) && grants[role as Exclude<StaffRole, "owner">].includes(permission);
}

export function mayManageStaff(actor: string, target: string, next: string): boolean {
  if (!STAFF_ROLES.includes(target as StaffRole) || !STAFF_ROLES.includes(next as StaffRole)) return false;
  if (actor === "owner") return true;
  return actor === "admin" && ![target, next].some((role) => role === "owner" || role === "admin");
}

export type StaffSessionState = {
  mfaRequired?: boolean; enabled: boolean; expiresAt: number | null; role: StaffRole;
  sessionCreatedAt: number; sessionExpiresAt: number;
  lastActiveAt: number; mfaAt: number | null; elevatedAt: number | null; rolloutAt: number;
};

export function evaluateStaffSession(state: StaffSessionState, now: number, elevated = false) {
  if (!state.enabled || (state.expiresAt !== null && (!Number.isFinite(state.expiresAt) || state.expiresAt <= now))) return "disabled";
  const timestamps = [now, state.sessionCreatedAt, state.sessionExpiresAt, state.lastActiveAt, state.rolloutAt];
  if (timestamps.some((time) => !Number.isFinite(time))) return "expired";
  // The native Better Auth session expiry is the sole ordinary session lifetime.
  // Do not impose a second absolute or idle timeout on staff sessions: it caused
  // active operators to be signed out while viewing orders or replying to customers.
  if (state.sessionExpiresAt <= now) return "expired";
  const strong = state.mfaAt !== null && Number.isFinite(state.mfaAt) && state.mfaAt <= now;
  // The caller decides whether this identity/session requires MFA. A session
  // being older than rollout must never override an explicit requirement.
  if (!strong && state.mfaRequired !== false) return "mfa_required";
  if (elevated && (!strong || state.elevatedAt === null || !Number.isFinite(state.elevatedAt) || state.elevatedAt > now || now - state.elevatedAt >= STAFF_ELEVATION_MS)) return "step_up_required";
  return "allowed";
}

const formGrants: Record<Exclude<StaffRole, "owner" | "admin">, readonly string[]> = {
  staff: ["access_forms", "view_jobs", "create_jobs", "update_jobs", "delete_jobs", "view_customer_contact", "view_finance", "update_finance", "view_payment_proof", "view_files", "upload_files", "update_production_status", "update_delivery_status", "view_stats", "view_audit"],
  customer_service: ["access_forms", "view_jobs", "view_customer_contact", "view_files", "update_jobs", "update_delivery_status"],
  designer: ["access_forms", "view_jobs", "view_files", "upload_files"],
  production: ["access_forms", "view_jobs", "view_files", "view_customer_contact", "update_production_status", "update_delivery_status"],
  temporary: ["access_forms", "view_jobs"],
};
export function staffRoleAllowsForm(role: StaffRole, permission: string) {
  if (!FORM_PERMISSION_KEYS.includes(permission as (typeof FORM_PERMISSION_KEYS)[number])) return false;
  if (role === "owner" || role === "admin") return true;
  return Object.hasOwn(formGrants, role) && formGrants[role].includes(permission);
}
