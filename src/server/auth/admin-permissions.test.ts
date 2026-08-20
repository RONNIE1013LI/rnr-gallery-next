import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSION_KEYS,
  ASSIGNABLE_ADMIN_PERMISSION_KEYS,
  hasAdminPermission,
} from "./admin-permissions";

describe("admin permissions", () => {
  it("allows admins to perform every management action", () => {
    for (const permission of [
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
      "use_reply_assistant",
      "review_reply_learning",
    ] as const) {
      expect(hasAdminPermission("admin", [], permission)).toBe(true);
    }
  });

  it("grants staff only their explicitly stored management permissions", () => {
    const granted = ["access_admin", "view_orders", "update_order_status"] as const;
    for (const permission of [
      "access_admin",
      "view_orders",
      "update_order_status",
    ] as const) {
      expect(hasAdminPermission("staff", granted, permission)).toBe(true);
    }

    for (const permission of [
      "view_customers",
      "update_payment_status",
      "record_refund",
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
      "view_production_finance",
      "update_production_finance",
      "view_production_jobs",
      "create_manual_jobs",
      "update_production_jobs",
      "view_production_files",
      "upload_production_files",
      "review_production_proofs",
      "manage_production_views",
      "view_production_reports",
      "export_production_jobs",
      "use_reply_assistant",
      "review_reply_learning",
    ] as const) {
      expect(hasAdminPermission("staff", granted, permission)).toBe(false);
    }
  });

  it("keeps staff role management unavailable for assignment", () => {
    expect(ADMIN_PERMISSION_KEYS).toContain("manage_roles");
    expect(ASSIGNABLE_ADMIN_PERMISSION_KEYS).not.toContain("manage_roles");
  });

  it("exposes separate assignable review management and publishing permissions", () => {
    expect(ADMIN_PERMISSION_KEYS).toEqual(expect.arrayContaining([
      "manage_reviews",
      "publish_reviews",
    ]));
    expect(ASSIGNABLE_ADMIN_PERMISSION_KEYS).toEqual(expect.arrayContaining([
      "manage_reviews",
      "publish_reviews",
    ]));
  });

  it("denies customers and unknown roles", () => {
    expect(hasAdminPermission("customer", [], "access_admin")).toBe(false);
    expect(hasAdminPermission("form_staff", [], "access_admin")).toBe(false);
    expect(hasAdminPermission("owner", [], "access_admin")).toBe(false);
    expect(hasAdminPermission(null, [], "access_admin")).toBe(false);
  });
});
