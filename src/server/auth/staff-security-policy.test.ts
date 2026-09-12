import { describe, expect, it } from "vitest";
import { evaluateStaffSession, staffRoleAllows, staffRoleAllowsForm, mayManageStaff } from "./staff-security-policy";

const now = Date.parse("2026-09-10T00:00:00Z");
const state = {
  enabled: true, expiresAt: null, role: "designer" as const,
  sessionCreatedAt: now - 1000, sessionExpiresAt: now + 1000,
  lastActiveAt: now - 1000, mfaAt: now - 1000, elevatedAt: null,
  rolloutAt: now - 2000,
};

describe("staff security policy", () => {
  it("allows the explicitly requested order and Payment Requests Staff duties", () => {
    for (const permission of ["access_admin", "view_orders", "manage_payment", "update_payment_status", "record_refund", "manage_shipping"]) {
      expect(staffRoleAllows("staff", permission)).toBe(true);
    }
    for (const permission of ["access_forms", "view_jobs", "create_jobs", "update_jobs", "delete_jobs", "view_customer_contact", "view_finance", "update_finance", "view_payment_proof", "view_files", "upload_files", "update_production_status", "update_delivery_status", "view_stats", "view_audit"]) {
      expect(staffRoleAllowsForm("staff", permission)).toBe(true);
    }
  });
  it("keeps order Staff outside security, catalogue and bulk export permissions", () => {
    for (const permission of ["manage_roles", "view_customers", "manage_prices", "manage_gallery", "publish_content", "export_production_jobs", "manage_production_fields"]) {
      expect(staffRoleAllows("staff", permission)).toBe(false);
    }
    for (const permission of ["delete_files", "export_jobs", "manage_stats", "manage_views"]) {
      expect(staffRoleAllowsForm("staff", permission)).toBe(false);
    }
    expect(mayManageStaff("staff", "designer", "admin")).toBe(false);
  });
  it("accepts a trusted session through normal page navigation without fresh MFA", () => {
    expect(evaluateStaffSession(state, now)).toBe("allowed");
    expect(evaluateStaffSession({ ...state, elevatedAt: null }, now)).toBe("allowed");
  });
  it("allows staged enrollment but still requires strong step-up", () => {
    const enrolling = { ...state, mfaAt: null, mfaRequired: false };
    expect(evaluateStaffSession(enrolling, now)).toBe("allowed");
    expect(evaluateStaffSession(enrolling, now, true)).toBe("step_up_required");
  });
  it("denies unknown Forms permissions even to an Owner", () => {
    expect(staffRoleAllowsForm("owner", "unknown_permission")).toBe(false);
    expect(staffRoleAllowsForm("admin", "unknown_permission")).toBe(false);
  });
  it("requires MFA for a new password-only session", () => {
    expect(evaluateStaffSession({ ...state, mfaAt: null }, now)).toBe("mfa_required");
  });
  it("immediately denies disabled and expired temporary staff", () => {
    expect(evaluateStaffSession({ ...state, enabled: false }, now)).toBe("disabled");
    expect(evaluateStaffSession({ ...state, expiresAt: now }, now)).toBe("disabled");
  });
  it("does not impose the withdrawn absolute or idle staff limits", () => {
    expect(evaluateStaffSession({ ...state, sessionCreatedAt: now - 12 * 3600_000, rolloutAt: now - 24 * 3600_000 }, now)).toBe("allowed");
    expect(evaluateStaffSession({ ...state, lastActiveAt: now - 3600_000 }, now)).toBe("allowed");
    expect(evaluateStaffSession({ ...state, sessionExpiresAt: now }, now)).toBe("expired");
  });
  it("preserves pre-rollout sessions until the native session expires", () => {
    const old = { ...state, sessionCreatedAt: now - 86400_000, rolloutAt: now - 1000, mfaAt: null };
    expect(evaluateStaffSession(old, now)).toBe("allowed");
    expect(evaluateStaffSession({ ...old, rolloutAt: now - 12 * 3600_000 }, now)).toBe("allowed");
  });
  it("requires a recent strong factor for elevated operations, including old sessions", () => {
    expect(evaluateStaffSession(state, now, true)).toBe("step_up_required");
    expect(evaluateStaffSession({ ...state, elevatedAt: now - 60_000 }, now, true)).toBe("allowed");
    expect(evaluateStaffSession({ ...state, elevatedAt: now - 5 * 60_000 }, now, true)).toBe("step_up_required");
  });
  it("fails closed for unknown roles and invalid timestamps", () => {
    expect(staffRoleAllows("unknown", "view_orders")).toBe(false);
    expect(evaluateStaffSession({ ...state, lastActiveAt: NaN }, now)).toBe("expired");
  });
  it.each([
    ["customer_service", "manage_roles"], ["designer", "manage_payment"],
    ["production", "manage_roles"], ["temporary", "view_customers"],
    ["admin", "manage_payment"], ["admin", "manage_roles"],
  ])("denies %s permission %s", (role, permission) => {
    expect(staffRoleAllows(role, permission)).toBe(false);
  });
  it.each([
    ["owner", "manage_roles"], ["customer_service", "use_reply_assistant"],
    ["designer", "upload_production_files"], ["production", "update_production_jobs"],
    ["admin", "view_orders"],
  ])("allows %s necessary work permission %s", (role, permission) => {
    expect(staffRoleAllows(role, permission)).toBe(true);
  });
  it("prevents admin privilege escalation and all Owner modifications", () => {
    expect(mayManageStaff("admin", "owner", "admin")).toBe(false);
    expect(mayManageStaff("admin", "admin", "owner")).toBe(false);
    expect(mayManageStaff("admin", "designer", "admin")).toBe(false);
    expect(mayManageStaff("admin", "designer", "production")).toBe(true);
    expect(mayManageStaff("designer", "production", "temporary")).toBe(false);
    expect(mayManageStaff("owner", "admin", "owner")).toBe(true);
  });
});
