import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  websiteAnalyticsAttributionSnapshots,
  websiteAnalyticsConversions,
  websiteAnalyticsDailyAggregates,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsPageviews,
  websiteAnalyticsReconciliationState,
  websiteAnalyticsSessions,
} from "./index";

const dialect = new PgDialect();

function normalizeSql(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function checkContracts(table: Parameters<typeof getTableConfig>[0]) {
  return Object.fromEntries(getTableConfig(table).checks.map((constraint) => [
    constraint.name,
    normalizeSql(dialect.sqlToQuery(constraint.value as SQL).sql),
  ]));
}

function indexContracts(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((value) => ({
    name: value.config.name,
    unique: value.config.unique,
    columns: value.config.columns.map((column) =>
      typeof column === "object" && column !== null && "name" in column
        ? column.name
        : "<expression>"),
  }));
}

describe("website analytics schema contract", () => {
  it("preserves V1 and defines the five additive V2 tables", () => {
    expect([
      websiteAnalyticsSessions,
      websiteAnalyticsPageviews,
      websiteAnalyticsConversions,
      websiteAnalyticsAttributionSnapshots,
      websiteAnalyticsFinancialEvents,
      websiteAnalyticsDailyAggregates,
      websiteAnalyticsReconciliationState,
    ].map(getTableName)).toEqual([
      "website_analytics_sessions",
      "website_analytics_pageviews",
      "website_analytics_conversions",
      "website_analytics_attribution_snapshots",
      "website_analytics_financial_events",
      "website_analytics_daily_aggregates",
      "website_analytics_reconciliation_state",
    ]);
  });

  it("stores immutable conversion facts with nullable source and attribution references", () => {
    const columns = getTableColumns(websiteAnalyticsConversions);
    const config = getTableConfig(websiteAnalyticsConversions);

    expect(Object.keys(columns)).toEqual([
      "id", "conversionType", "sourceType", "sourceId", "orderId",
      "productionJobId", "conversationId", "occurredAt", "localDate", "scope",
      "market", "currency", "orderedAmountInclGstCents", "visitorDigest",
      "convertingSessionId", "firstSessionId", "lastSessionId",
      "lastNonDirectSessionId", "historical", "consentLinked",
      "attributionVersion", "createdAt",
    ]);
    for (const column of [
      columns.orderId,
      columns.productionJobId,
      columns.conversationId,
      columns.convertingSessionId,
      columns.firstSessionId,
      columns.lastSessionId,
      columns.lastNonDirectSessionId,
    ]) {
      expect(column.notNull).toBe(false);
    }
    expect(config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        column: reference.columns[0].name,
        table: getTableName(reference.foreignTable),
        onDelete: foreignKey.onDelete,
      };
    })).toEqual([
      { column: "order_id", table: "orders", onDelete: "set null" },
      { column: "production_job_id", table: "production_jobs", onDelete: "set null" },
      { column: "conversation_id", table: "customer_service_conversations", onDelete: "set null" },
      { column: "converting_session_id", table: "website_analytics_sessions", onDelete: "set null" },
      { column: "first_session_id", table: "website_analytics_sessions", onDelete: "set null" },
      { column: "last_session_id", table: "website_analytics_sessions", onDelete: "set null" },
      { column: "last_non_direct_session_id", table: "website_analytics_sessions", onDelete: "set null" },
    ]);
    expect(indexContracts(websiteAnalyticsConversions)).toEqual([
      { name: "website_analytics_conversions_source_unique", unique: true, columns: ["conversion_type", "source_type", "source_id"] },
      { name: "website_analytics_conversions_local_scope_type_idx", unique: false, columns: ["local_date", "scope", "conversion_type"] },
      { name: "website_analytics_conversions_occurred_id_idx", unique: false, columns: ["occurred_at", "id"] },
      { name: "website_analytics_conversions_order_idx", unique: false, columns: ["order_id"] },
      { name: "website_analytics_conversions_job_idx", unique: false, columns: ["production_job_id"] },
      { name: "website_analytics_conversions_conversation_idx", unique: false, columns: ["conversation_id"] },
      { name: "website_analytics_conversions_visitor_occurred_idx", unique: false, columns: ["visitor_digest", "occurred_at"] },
    ]);
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      "website_analytics_conversions_type_valid",
      "website_analytics_conversions_source_type_valid",
      "website_analytics_conversions_scope_valid",
      "website_analytics_conversions_commercial_shape_valid",
      "website_analytics_conversions_source_reference_valid",
      "website_analytics_conversions_visitor_digest_valid",
      "website_analytics_conversions_consent_links_valid",
      "website_analytics_conversions_attribution_version_valid",
    ]));
    expect(checkContracts(websiteAnalyticsConversions)).toMatchObject({
      website_analytics_conversions_commercial_shape_valid: expect.stringContaining('"website_analytics_conversions"."ordered_amount_incl_gst_cents" > 0'),
      website_analytics_conversions_source_reference_valid: expect.stringContaining('"website_analytics_conversions"."source_type" = \'customer_service_conversation\''),
      website_analytics_conversions_consent_links_valid: expect.stringContaining('not "website_analytics_conversions"."consent_linked"'),
    });
  });

  it("freezes one privacy-minimised snapshot per conversion and attribution model", () => {
    const columns = getTableColumns(websiteAnalyticsAttributionSnapshots);
    const config = getTableConfig(websiteAnalyticsAttributionSnapshots);

    expect(Object.keys(columns)).toEqual([
      "id", "conversionId", "sessionId", "attributionModel", "channel", "source", "medium",
      "campaign", "term", "content", "landingPath", "externalReferrerOrigin",
      "market", "countryCode", "deviceCategory", "consentQualifiedClickIds",
      "visitorReference", "conversionReference", "attributedAt", "rulesVersion", "createdAt",
    ]);
    expect(columns.sessionId.notNull).toBe(false);
    expect(config.foreignKeys).toHaveLength(2);
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
    expect(config.foreignKeys[1].onDelete).toBe("set null");
    expect(indexContracts(websiteAnalyticsAttributionSnapshots)).toEqual([
      { name: "website_analytics_attribution_conversion_model_unique", unique: true, columns: ["conversion_id", "attribution_model"] },
      { name: "website_analytics_attribution_model_channel_idx", unique: false, columns: ["attribution_model", "channel"] },
      { name: "website_analytics_attribution_campaign_idx", unique: false, columns: ["attribution_model", "campaign", "source"] },
    ]);
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      "website_analytics_attribution_model_valid",
      "website_analytics_attribution_channel_valid",
      "website_analytics_attribution_landing_path_valid",
      "website_analytics_attribution_market_valid",
      "website_analytics_attribution_country_valid",
      "website_analytics_attribution_device_valid",
      "website_analytics_attribution_click_ids_valid",
      "website_analytics_attribution_visitor_reference_valid",
      "website_analytics_attribution_rules_version_valid",
    ]));
    expect(checkContracts(websiteAnalyticsAttributionSnapshots)).toMatchObject({
      website_analytics_attribution_click_ids_valid: expect.stringContaining("jsonb_path_exists"),
      website_analytics_attribution_visitor_reference_valid: expect.stringContaining("^[a-f0-9]{64}$"),
    });
  });

  it("stores positive directional financial facts behind the final idempotency key", () => {
    const columns = getTableColumns(websiteAnalyticsFinancialEvents);
    const config = getTableConfig(websiteAnalyticsFinancialEvents);

    expect(Object.keys(columns)).toEqual([
      "id", "conversionId", "orderId", "productionJobId", "eventType",
      "sourceType", "sourceId", "amountCents", "currency", "occurredAt",
      "localDate", "historical", "createdAt",
    ]);
    for (const column of [columns.conversionId, columns.orderId, columns.productionJobId]) {
      expect(column.notNull).toBe(false);
    }
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "set null", "set null", "set null",
    ]);
    expect(indexContracts(websiteAnalyticsFinancialEvents)).toEqual([
      { name: "website_analytics_financial_source_event_unique", unique: true, columns: ["source_type", "source_id", "event_type"] },
      { name: "website_analytics_financial_local_currency_type_idx", unique: false, columns: ["local_date", "currency", "event_type"] },
      { name: "website_analytics_financial_conversion_occurred_idx", unique: false, columns: ["conversion_id", "occurred_at"] },
      { name: "website_analytics_financial_order_idx", unique: false, columns: ["order_id"] },
      { name: "website_analytics_financial_job_idx", unique: false, columns: ["production_job_id"] },
    ]);
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      "website_analytics_financial_event_type_valid",
      "website_analytics_financial_source_type_valid",
      "website_analytics_financial_amount_positive",
      "website_analytics_financial_currency_valid",
      "website_analytics_financial_reference_valid",
    ]));
    expect(checkContracts(websiteAnalyticsFinancialEvents)).toMatchObject({
      website_analytics_financial_amount_positive: '"website_analytics_financial_events"."amount_cents" > 0',
      website_analytics_financial_currency_valid: '"website_analytics_financial_events"."currency" in (\'NZD\', \'AUD\')',
      website_analytics_financial_reference_valid: expect.stringContaining('"website_analytics_financial_events"."conversion_id" is not null'),
    });
  });

  it("uses explicit daily dimensions and non-negative aggregate counters", () => {
    const columns = getTableColumns(websiteAnalyticsDailyAggregates);
    const config = getTableConfig(websiteAnalyticsDailyAggregates);

    expect(Object.keys(columns)).toEqual([
      "id", "localDate", "scope", "market", "currency", "channel", "source",
      "medium", "campaign", "attributionModel", "visitors", "sessions",
      "pageViews", "inquiries", "orders", "paidOrders", "orderedRevenueCents",
      "collectedRevenueCents", "refundedRevenueCents", "netCollectedRevenueCents",
      "rulesVersion", "createdAt", "updatedAt",
    ]);
    for (const name of ["market", "currency", "channel", "source", "medium", "campaign"] as const) {
      expect(columns[name].notNull).toBe(true);
    }
    expect(indexContracts(websiteAnalyticsDailyAggregates)).toEqual([
      { name: "website_analytics_daily_dimensions_unique", unique: true, columns: ["local_date", "scope", "market", "currency", "channel", "source", "medium", "campaign", "attribution_model", "rules_version"] },
      { name: "website_analytics_daily_scope_model_date_idx", unique: false, columns: ["scope", "attribution_model", "local_date"] },
      { name: "website_analytics_daily_channel_date_idx", unique: false, columns: ["channel", "local_date"] },
      { name: "website_analytics_daily_campaign_date_idx", unique: false, columns: ["campaign", "local_date"] },
    ]);
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      "website_analytics_daily_scope_valid",
      "website_analytics_daily_market_valid",
      "website_analytics_daily_currency_valid",
      "website_analytics_daily_attribution_model_valid",
      "website_analytics_daily_dimensions_valid",
      "website_analytics_daily_counts_nonnegative",
      "website_analytics_daily_money_valid",
      "website_analytics_daily_rules_version_valid",
    ]));
    expect(checkContracts(websiteAnalyticsDailyAggregates)).toMatchObject({
      website_analytics_daily_counts_nonnegative: expect.stringContaining('"website_analytics_daily_aggregates"."paid_orders" >= 0'),
      website_analytics_daily_money_valid: expect.stringContaining('"website_analytics_daily_aggregates"."net_collected_revenue_cents" = "website_analytics_daily_aggregates"."collected_revenue_cents" - "website_analytics_daily_aggregates"."refunded_revenue_cents"'),
    });
  });

  it("keeps dirty dates and resumable cursors in a customer-data-free state table", () => {
    const columns = getTableColumns(websiteAnalyticsReconciliationState);
    const config = getTableConfig(websiteAnalyticsReconciliationState);

    expect(Object.keys(columns)).toEqual([
      "id", "stateType", "stateKey", "localDate", "cursorOccurredAt", "cursorId",
      "status", "scannedCount", "createdCount", "unchangedCount", "skippedCount",
      "failedCount", "startedAt", "completedAt", "lastErrorCode", "createdAt", "updatedAt",
    ]);
    expect(Object.keys(columns)).not.toEqual(expect.arrayContaining([
      "email", "name", "phone", "address", "message", "payload", "notes",
    ]));
    expect(indexContracts(websiteAnalyticsReconciliationState)).toEqual([
      { name: "website_analytics_reconciliation_state_key_unique", unique: true, columns: ["state_type", "state_key"] },
      { name: "website_analytics_reconciliation_status_date_idx", unique: false, columns: ["status", "local_date"] },
    ]);
    expect(config.checks.map((value) => value.name)).toEqual(expect.arrayContaining([
      "website_analytics_reconciliation_state_type_valid",
      "website_analytics_reconciliation_status_valid",
      "website_analytics_reconciliation_state_shape_valid",
      "website_analytics_reconciliation_counts_nonnegative",
      "website_analytics_reconciliation_completion_valid",
    ]));
    expect(checkContracts(websiteAnalyticsReconciliationState)).toMatchObject({
      website_analytics_reconciliation_state_shape_valid: expect.stringContaining('"website_analytics_reconciliation_state"."state_type" = \'dirty_date\''),
      website_analytics_reconciliation_completion_valid: expect.stringContaining('"website_analytics_reconciliation_state"."status" = \'failed\''),
    });
  });

  it("stores privacy-minimised session attribution", () => {
    const columns = getTableColumns(websiteAnalyticsSessions);
    expect(columns).toEqual(expect.objectContaining({
      id: expect.anything(),
      visitorDigest: expect.anything(),
      startedAt: expect.anything(),
      localDate: expect.anything(),
      channel: expect.anything(),
      source: expect.anything(),
      medium: expect.anything(),
      utmCampaign: expect.anything(),
      clickIdType: expect.anything(),
      countryCode: expect.anything(),
    }));
    expect(columns.visitorDigest.dataType).toBe("string");
    expect(Object.keys(columns)).not.toEqual(expect.arrayContaining([
      "ip", "fullIp", "email", "name", "phone", "accountId", "userAgent",
      "gclid", "gbraid", "wbraid", "fbclid", "clickId",
    ]));
  });

  it("uses an idempotent pageview UUID and cascade session ownership", () => {
    const columns = getTableColumns(websiteAnalyticsPageviews);
    const config = getTableConfig(websiteAnalyticsPageviews);
    expect(columns).toEqual(expect.objectContaining({
      id: expect.anything(),
      sessionId: expect.anything(),
      occurredAt: expect.anything(),
      localDate: expect.anything(),
      pathname: expect.anything(),
    }));
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0].onDelete).toBe("cascade");
  });

  it("contains only dashboard-query indexes and approved checks", () => {
    const sessionConfig = getTableConfig(websiteAnalyticsSessions);
    const pageviewConfig = getTableConfig(websiteAnalyticsPageviews);
    expect(sessionConfig.indexes.map((index) => index.config.name)).toEqual([
      "website_analytics_sessions_local_date_visitor_idx",
      "website_analytics_sessions_local_date_channel_idx",
      "website_analytics_sessions_started_id_idx",
    ]);
    expect(pageviewConfig.indexes.map((index) => index.config.name)).toEqual([
      "website_analytics_pageviews_session_idx",
      "website_analytics_pageviews_local_path_session_idx",
    ]);
    expect(sessionConfig.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "website_analytics_sessions_visitor_digest_valid",
      "website_analytics_sessions_channel_valid",
      "website_analytics_sessions_click_id_type_valid",
      "website_analytics_sessions_country_code_valid",
    ]));
    expect(pageviewConfig.checks.map((check) => check.name)).toContain(
      "website_analytics_pageviews_pathname_valid",
    );
  });

  it("uses the approved forward-only 0058 two-table migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0058_website_analytics_v1.sql"),
      "utf8",
    );
    expect(migration.match(/CREATE TABLE "website_analytics_/g)).toHaveLength(2);
    expect(migration).toContain('CREATE TABLE "website_analytics_sessions"');
    expect(migration).toContain('CREATE TABLE "website_analytics_pageviews"');
    expect(migration).toContain('ON DELETE cascade');
    expect(migration).not.toMatch(/^\s*(?:DROP\b|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
    expect(migration).not.toMatch(/ALTER TABLE "(?!website_analytics_pageviews)/);
    expect(migration).not.toMatch(/\b(?:orders|payments|production_jobs|customer_service_)\b/i);
  });
});
