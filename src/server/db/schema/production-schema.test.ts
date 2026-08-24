import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  customerNotificationOutbox,
  formStatsLayouts,
  invoiceItems,
  invoices,
  productionJobFiles,
  productionJobItems,
  productionJobs,
  productionFieldDefinitions,
  productionFieldValues,
  productionProofReviews,
  productionSavedViews,
} from "./index";

function columns(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name);
}

describe("production job schema", () => {
  it("keeps production work separate from immutable ecommerce orders", () => {
    expect(getTableName(productionJobs)).toBe("production_jobs");
    expect(columns(productionJobs)).toEqual([
      "id",
      "job_number",
      "source",
      "order_id",
      "idempotency_key",
      "request_digest",
      "legacy_source",
      "legacy_order_id",
      "customer_name",
      "customer_email",
      "customer_phone",
      "customer_source",
      "web_order_number",
      "manual_status",
      "manual_payment_status",
      "urgent",
      "needed_date",
      "delivery_method",
      "delivery_address",
      "payment_reconciliation_status",
      "assigned_user_id",
      "design_requirements",
      "internal_notes",
      "amount_payable_cents",
      "amount_paid_cents",
      "artist_fee_cents",
      "material_cost_cents",
      "file_sent_at",
      "downloaded_at",
      "printed_at",
      "customer_notified_at",
      "delivered_at",
      "artist_paid_at",
      "completed_at",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ]);
  });

  it("gives imported historical jobs a paired, allowlisted source identity", () => {
    expect(getTableConfig(productionJobs).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "production_jobs_legacy_identity_pair",
        "production_jobs_legacy_source_valid",
      ]),
    );
    expect(getTableConfig(productionJobs).indexes.map((item) => item.config.name)).toContain(
      "production_jobs_legacy_identity_unique",
    );
  });

  it("keeps configurable and historical form values without weakening typed job fields", () => {
    expect(getTableName(productionFieldDefinitions)).toBe("production_field_definitions");
    expect(columns(productionFieldDefinitions)).toEqual(expect.arrayContaining([
      "field_key", "label", "field_type", "section", "options", "required",
      "enabled", "show_on_create", "show_on_detail", "show_on_list", "legacy_only",
      "sort_order", "created_at", "updated_at",
    ]));
    expect(getTableName(productionFieldValues)).toBe("production_field_values");
    expect(columns(productionFieldValues)).toEqual(expect.arrayContaining([
      "job_id", "field_id", "value", "updated_by_user_id", "created_at", "updated_at",
    ]));
    expect(getTableConfig(productionFieldDefinitions).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "production_field_definitions_key_valid",
        "production_field_definitions_type_valid",
        "production_field_definitions_section_valid",
      ]),
    );
  });

  it("stores multiple typed items with optional immutable order item links", () => {
    expect(getTableName(productionJobItems)).toBe("production_job_items");
    expect(columns(productionJobItems)).toEqual(expect.arrayContaining([
      "job_id",
      "position",
      "source_order_item_id",
      "product_title",
      "size_label",
      "quantity",
      "design_text",
      "notes",
      "created_at",
    ]));
  });

  it("enforces source, status, value and monetary invariants in PostgreSQL", () => {
    const jobChecks = getTableConfig(productionJobs).checks.map((check) => check.name);
    expect(jobChecks).toEqual(expect.arrayContaining([
      "production_jobs_source_valid",
      "production_jobs_source_link_valid",
      "production_jobs_manual_status_valid",
      "production_jobs_manual_payment_status_valid",
      "production_jobs_delivery_method_valid",
      "production_jobs_payment_reconciliation_status_valid",
      "production_jobs_needed_date_valid",
      "production_jobs_money_nonnegative",
      "production_jobs_paid_not_over_payable",
    ]));
    expect(getTableConfig(productionJobItems).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "production_job_items_position_nonnegative",
        "production_job_items_quantity_valid",
        "production_job_items_product_present",
        "production_job_items_size_present",
      ]),
    );
  });

  it("stores private production files and immutable proof decisions", () => {
    expect(getTableName(productionJobFiles)).toBe("production_job_files");
    expect(columns(productionJobFiles)).toEqual(expect.arrayContaining([
      "job_id", "kind", "version", "original_name", "media_type",
      "size_bytes", "storage_key", "sha256", "idempotency_key", "request_digest",
      "uploaded_by_user_id", "created_at",
    ]));
    expect(getTableConfig(productionJobFiles).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "production_job_files_kind_valid",
        "production_job_files_version_valid",
        "production_job_files_size_valid",
        "production_job_files_sha256_valid",
        "production_job_files_request_digest_valid",
      ]),
    );

    expect(getTableName(productionProofReviews)).toBe("production_proof_reviews");
    expect(columns(productionProofReviews)).toEqual(expect.arrayContaining([
      "job_id", "file_id", "decision", "notes", "reviewer_type", "recorded_by_user_id",
      "idempotency_key", "created_at",
    ]));
    expect(getTableConfig(productionProofReviews).checks.map((check) => check.name)).toContain(
      "production_proof_reviews_reviewer_type_valid",
    );
  });

  it("stores idempotent customer notification delivery attempts", () => {
    expect(getTableName(customerNotificationOutbox)).toBe("customer_notification_outbox");
    expect(columns(customerNotificationOutbox)).toEqual(expect.arrayContaining([
      "event_key", "kind", "job_id", "order_id", "file_id", "recipient_email",
      "status", "attempts", "available_at", "last_attempt_at", "sent_at",
      "provider_message_id", "last_error_code", "created_at", "updated_at",
    ]));
    expect(getTableConfig(customerNotificationOutbox).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "customer_notification_outbox_kind_valid",
        "customer_notification_outbox_status_valid",
        "customer_notification_outbox_attempts_nonnegative",
      ]),
    );
  });

  it("stores only per-user production filter views", () => {
    expect(getTableName(productionSavedViews)).toBe("production_saved_views");
    expect(columns(productionSavedViews)).toEqual(expect.arrayContaining([
      "user_id", "name", "query_string", "created_at", "updated_at",
    ]));
    expect(getTableConfig(productionSavedViews).checks.map((check) => check.name)).toContain(
      "production_saved_views_query_valid",
    );
  });

  it("stores bounded per-user forms statistics layouts", () => {
    expect(getTableName(formStatsLayouts)).toBe("form_stats_layouts");
    expect(columns(formStatsLayouts)).toEqual(expect.arrayContaining([
      "user_id", "name", "widgets", "created_at", "updated_at",
    ]));
    expect(getTableConfig(formStatsLayouts).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(["form_stats_layouts_name_valid", "form_stats_layouts_widget_count_valid"]),
    );
  });

  it("stores persistent GST invoices separately from production jobs", () => {
    expect(getTableName(invoices)).toBe("invoices");
    expect(columns(invoices)).toEqual(expect.arrayContaining([
      "job_id", "invoice_number", "status", "invoice_date", "due_date",
      "reference", "web_order_number", "business_name", "business_address",
      "business_email", "business_phone", "business_website", "gst_number",
      "bank_account", "customer_name", "customer_email", "customer_address",
      "delivery_address", "currency", "gst_rate_basis_points",
      "prices_include_gst", "gross_cents", "discount_cents",
      "subtotal_ex_gst_cents", "gst_cents", "total_incl_gst_cents",
      "notes", "terms", "issued_at", "voided_at", "void_reason",
      "created_by_user_id", "updated_by_user_id", "created_at", "updated_at",
    ]));
    expect(getTableConfig(invoices).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "invoices_status_valid",
        "invoices_currency_supported",
        "invoices_tax_rate_valid",
        "invoices_totals_nonnegative",
        "invoices_totals_balance",
        "invoices_lifecycle_valid",
      ]),
    );

    expect(getTableName(invoiceItems)).toBe("invoice_items");
    expect(columns(invoiceItems)).toEqual(expect.arrayContaining([
      "invoice_id", "position", "code", "description", "quantity_milli",
      "rate_incl_gst_cents", "line_total_incl_gst_cents", "created_at",
    ]));
    expect(getTableConfig(invoiceItems).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "invoice_items_position_nonnegative",
        "invoice_items_quantity_positive",
        "invoice_items_rate_nonnegative",
        "invoice_items_line_total_nonnegative",
      ]),
    );
  });
});
