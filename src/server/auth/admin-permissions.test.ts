import { describe, expect, it } from "vitest";
import { hasAdminPermission } from "./admin-permissions";

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
    ] as const) {
      expect(hasAdminPermission("admin", permission)).toBe(true);
    }
  });

  it("limits staff to day-to-day orders, customers, gallery, and content", () => {
    for (const permission of [
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
    ] as const) {
      expect(hasAdminPermission("staff", permission)).toBe(true);
    }

    for (const permission of [
      "update_payment_status",
      "record_refund",
      "publish_content",
      "manage_prices",
      "manage_shipping",
      "manage_payment",
      "delete_media",
      "view_audit",
      "manage_roles",
      "view_production_finance",
      "update_production_finance",
      "export_production_jobs",
    ] as const) {
      expect(hasAdminPermission("staff", permission)).toBe(false);
    }
  });

  it("denies customers and unknown roles", () => {
    expect(hasAdminPermission("customer", "access_admin")).toBe(false);
    expect(hasAdminPermission("form_staff", "access_admin")).toBe(false);
    expect(hasAdminPermission("owner", "access_admin")).toBe(false);
    expect(hasAdminPermission(null, "access_admin")).toBe(false);
  });
});
