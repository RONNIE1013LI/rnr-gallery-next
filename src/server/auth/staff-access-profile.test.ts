import { describe, expect, it } from "vitest";

import {
  buildLegacyStaffAccessProfile,
  normalizeStaffAccessProfile,
} from "./staff-access-profile";

describe("staff access profiles", () => {
  it("adds required admin dependencies in catalogue order", () => {
    expect(normalizeStaffAccessProfile({
      adminPermissions: ["update_order_status"],
      formPermissions: {},
      assignedOnly: false,
    }).adminPermissions).toEqual([
      "access_admin",
      "view_orders",
      "update_order_status",
    ]);
  });

  it("adds required form dependencies and fills unselected permissions with false", () => {
    expect(normalizeStaffAccessProfile({
      adminPermissions: [],
      formPermissions: { upload_files: true },
      assignedOnly: true,
    })).toMatchObject({
      formPermissions: {
        access_forms: true,
        view_jobs: true,
        view_files: true,
        upload_files: true,
        update_finance: false,
      },
      assignedOnly: true,
    });
  });

  it("rejects non-assignable and unknown admin permissions", () => {
    for (const adminPermissions of [["manage_roles"], ["unknown_permission"]]) {
      expect(() => normalizeStaffAccessProfile({
        adminPermissions,
        formPermissions: {},
        assignedOnly: false,
      })).toThrow("Invalid employee permissions");
    }
  });

  it("returns an immutable fixture matching every legacy staff grant", () => {
    const profile = buildLegacyStaffAccessProfile();

    expect(profile.adminPermissions).toEqual([
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
    expect(profile.formPermissions).toMatchObject({
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
      update_finance: false,
      delete_files: false,
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.adminPermissions)).toBe(true);
    expect(Object.isFrozen(profile.formPermissions)).toBe(true);
  });
});
