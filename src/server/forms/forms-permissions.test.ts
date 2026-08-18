import { describe, expect, it } from "vitest";

import { isAdminRole } from "@/server/auth/admin-permissions";
import {
  buildFormAccessProfile,
  hasFormPermission,
  isFormCapableRole,
} from "./forms-permissions";
import { normalizeStaffAccessProfile } from "@/server/auth/staff-access-profile";

describe("forms permissions", () => {
  it("grants admins every form capability without a stored profile", () => {
    expect(hasFormPermission("admin", null, "view_jobs")).toBe(true);
    expect(hasFormPermission("admin", null, "update_finance")).toBe(true);
    expect(hasFormPermission("admin", null, "delete_files")).toBe(true);
  });

  it("uses the persisted profile for form-only staff", () => {
    const profile = buildFormAccessProfile("readOnly");
    expect(hasFormPermission("form_staff", profile, "view_jobs")).toBe(true);
    expect(hasFormPermission("form_staff", profile, "update_jobs")).toBe(false);
    expect(hasFormPermission("form_staff", profile, "view_customer_contact")).toBe(false);
  });

  it("preserves assigned-only source role intent", () => {
    const profile = buildFormAccessProfile("artist");
    expect(profile.assignedOnly).toBe(true);
    expect(profile.permissions.update_production_status).toBe(true);
    expect(profile.permissions.update_delivery_status).toBe(false);
    expect(profile.permissions.view_finance).toBe(false);
  });

  it("lets managers update production and delivery milestones", () => {
    const profile = buildFormAccessProfile("manager");
    expect(profile.permissions.update_production_status).toBe(true);
    expect(profile.permissions.update_delivery_status).toBe(true);
  });

  it("requires staff to have a custom profile and grants only its selected form keys", () => {
    const profile = normalizeStaffAccessProfile({
      adminPermissions: [],
      formPermissions: { view_files: true },
      assignedOnly: true,
    });

    expect(hasFormPermission("staff", null, "view_jobs")).toBe(false);
    expect(hasFormPermission("staff", profile, "view_jobs")).toBe(true);
    expect(hasFormPermission("staff", profile, "view_files")).toBe(true);
    expect(hasFormPermission("staff", profile, "view_customer_contact")).toBe(false);
    expect(hasFormPermission("staff", profile, "update_finance")).toBe(false);
    expect(isFormCapableRole("staff")).toBe(true);
    expect(isFormCapableRole("form_staff")).toBe(true);
    expect(isAdminRole("form_staff")).toBe(false);
  });

  it("denies customers, unknown roles, and form staff without a profile", () => {
    expect(hasFormPermission("customer", null, "view_jobs")).toBe(false);
    expect(hasFormPermission("form_staff", null, "view_jobs")).toBe(false);
    expect(hasFormPermission("owner", null, "view_jobs")).toBe(false);
    expect(isFormCapableRole(null)).toBe(false);
  });
});
