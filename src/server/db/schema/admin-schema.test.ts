import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  adminStaffAccess,
  contentEntries,
  formUserAccess,
  orderNotes,
  orders,
  orderStatusHistory,
  productRegistryCurrent,
  productRegistryRevisions,
  user,
} from "./index";

function columns(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("admin operations schema", () => {
  it("stores staff as a database-enforced account role", () => {
    expect(getTableConfig(user).checks.map((check) => check.name)).toContain(
      "user_role_valid",
    );
    expect(user.role.dataType).toBe("string");
  });

  it("stores form-only capabilities separately from administrator roles", () => {
    expect(getTableName(formUserAccess)).toBe("form_user_access");
    expect(columns(formUserAccess)).toEqual(expect.arrayContaining([
      "user_id",
      "preset",
      "assigned_only",
      "permissions",
      "created_at",
      "updated_at",
    ]));
    expect(getTableConfig(formUserAccess).checks.map((check) => check.name)).toContain(
      "form_user_access_preset_valid",
    );
  });

  it("stores exact staff access profiles separately from account roles", () => {
    expect(getTableName(adminStaffAccess)).toBe("admin_staff_access");
    expect(columns(adminStaffAccess)).toEqual(expect.arrayContaining([
      "user_id",
      "admin_permissions",
      "form_permissions",
      "assigned_only",
      "created_at",
      "updated_at",
    ]));
    expect(getTableConfig(adminStaffAccess).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "admin_staff_access_admin_permissions_array",
        "admin_staff_access_form_permissions_object",
      ]),
    );
  });

  it("stores append-only audit facts without secret fields", () => {
    expect(getTableName(adminAuditLogs)).toBe("admin_audit_logs");
    expect(columns(adminAuditLogs)).toEqual(expect.arrayContaining([
      "actor_user_id",
      "actor_email",
      "action",
      "resource_type",
      "resource_id",
      "before_summary",
      "after_summary",
      "request_source",
      "result",
      "idempotency_key",
      "created_at",
    ]));
    expect(columns(adminAuditLogs)).not.toEqual(expect.arrayContaining([
      "secret",
      "password",
      "token",
      "raw_request",
    ]));
  });

  it("stores order notes and idempotent status history separately", () => {
    expect(getTableName(orderNotes)).toBe("order_notes");
    expect(getTableName(orderStatusHistory)).toBe("order_status_history");
    expect(columns(orderNotes)).toEqual(expect.arrayContaining([
      "order_id",
      "author_user_id",
      "visibility",
      "body",
      "idempotency_key",
    ]));
    expect(columns(orderStatusHistory)).toEqual(expect.arrayContaining([
      "order_id",
      "from_status",
      "to_status",
      "actor_user_id",
      "reason",
      "idempotency_key",
    ]));
  });

  it("adds fulfilment tracking without changing immutable money columns", () => {
    expect(columns(orders)).toEqual(expect.arrayContaining([
      "tracking_number",
      "tracking_carrier",
      "tracking_url",
      "shipped_at",
      "completed_at",
      "cancelled_at",
    ]));
    expect(columns(orders)).toEqual(expect.arrayContaining([
      "product_subtotal_ex_gst_cents",
      "total_gst_cents",
      "total_incl_gst_cents",
    ]));
  });

  it("stores fixed-key plain-text content drafts and published values", () => {
    expect(getTableName(contentEntries)).toBe("content_entries");
    expect(columns(contentEntries)).toEqual(expect.arrayContaining([
      "key",
      "group_name",
      "label",
      "draft_value",
      "published_value",
      "draft_updated_by",
      "published_by",
      "published_at",
    ]));
  });

  it("stores one current product registry and append-only revisions", () => {
    expect(getTableName(productRegistryCurrent)).toBe("product_registry_current");
    expect(columns(productRegistryCurrent)).toEqual(expect.arrayContaining([
      "registry_key",
      "revision",
      "snapshot",
      "published_by",
      "published_at",
    ]));
    expect(getTableName(productRegistryRevisions)).toBe("product_registry_revisions");
    expect(columns(productRegistryRevisions)).toEqual(expect.arrayContaining([
      "registry_key",
      "revision",
      "snapshot",
      "published_by",
      "published_at",
    ]));
  });
});
