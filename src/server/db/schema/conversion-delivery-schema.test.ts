import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { analyticsConversionDeliveries, productionJobs } from "./index";

describe("conversion delivery schema", () => {
  it("stores the first authoritative manual payment confirmation time", () => {
    expect(getTableConfig(productionJobs).columns.map((column) => column.name))
      .toContain("manual_payment_confirmed_at");
  });

  it("defines one immutable provider delivery per business transaction", () => {
    expect(getTableName(analyticsConversionDeliveries))
      .toBe("analytics_conversion_deliveries");
    const config = getTableConfig(analyticsConversionDeliveries);

    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "platform",
      "transaction_id",
      "job_id",
      "event_type",
      "event_occurred_at",
      "event_source",
      "currency",
      "value_minor",
      "consent_snapshot",
      "attribution_snapshot",
      "user_data_snapshot",
      "status",
      "request_id",
      "attempt_count",
      "next_attempt_at",
      "last_attempt_at",
      "lease_token",
      "lease_expires_at",
      "last_error_code",
      "last_error_category",
      "last_error_at",
      "provider_diagnostics",
      "accepted_at",
      "completed_at",
      "dead_lettered_at",
      "created_at",
      "updated_at",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "analytics_conversion_deliveries_platform_transaction_unique",
        "analytics_conversion_deliveries_status_next_attempt_idx",
        "analytics_conversion_deliveries_job_idx",
        "analytics_conversion_deliveries_request_idx",
        "analytics_conversion_deliveries_stale_lease_idx",
      ]),
    );
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "analytics_conversion_deliveries_platform_valid",
        "analytics_conversion_deliveries_event_type_valid",
        "analytics_conversion_deliveries_currency_valid",
        "analytics_conversion_deliveries_value_positive",
        "analytics_conversion_deliveries_status_valid",
        "analytics_conversion_deliveries_attempt_count_nonnegative",
        "analytics_conversion_deliveries_snapshots_objects",
        "analytics_conversion_deliveries_lease_shape_valid",
        "analytics_conversion_deliveries_request_state_valid",
        "analytics_conversion_deliveries_diagnostics_object",
      ]),
    );
  });

  it("does not persist raw customer commerce content in the delivery table", () => {
    const columns = getTableConfig(analyticsConversionDeliveries).columns
      .map((column) => column.name);

    expect(columns).not.toEqual(expect.arrayContaining([
      "customer_name",
      "customer_email",
      "customer_phone",
      "shipping_address",
      "artwork",
      "design_notes",
      "payment_proof",
      "attachments",
      "raw_payload",
    ]));
  });
});
