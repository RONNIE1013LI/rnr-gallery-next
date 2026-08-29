import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  WebsiteAnalyticsAttributionModel,
  WebsiteAnalyticsCurrency,
  WebsiteAnalyticsMarket,
  WebsiteAnalyticsScope,
  WebsiteAnalyticsV2Channel,
} from "@/domain/analytics/website-analytics-v2";
import type {
  WebsiteAnalyticsConsentQualifiedClickIds,
  WebsiteAnalyticsDeviceCategory,
} from "@/server/analytics/website-analytics-attribution-v2";
import { customerServiceConversations } from "./customer-service";
import { orders } from "./orders";
import { productionJobs } from "./production";

export type WebsiteAnalyticsChannel =
  | "google_ads"
  | "meta_ads"
  | "google_organic"
  | "direct"
  | "other";

export const websiteAnalyticsSessions = pgTable(
  "website_analytics_sessions",
  {
    id: uuid("id").primaryKey(),
    visitorDigest: varchar("visitor_digest", { length: 64 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    channel: varchar("channel", { length: 32 }).$type<WebsiteAnalyticsChannel>().notNull(),
    source: varchar("source", { length: 255 }),
    medium: varchar("medium", { length: 100 }),
    utmCampaign: varchar("utm_campaign", { length: 100 }),
    clickIdType: varchar("click_id_type", { length: 16 }),
    countryCode: varchar("country_code", { length: 2 }),
  },
  (table) => [
    index("website_analytics_sessions_local_date_visitor_idx")
      .on(table.localDate, table.visitorDigest),
    index("website_analytics_sessions_local_date_channel_idx")
      .on(table.localDate, table.channel),
    index("website_analytics_sessions_started_id_idx")
      .on(table.startedAt, table.id),
    check(
      "website_analytics_sessions_visitor_digest_valid",
      sql`${table.visitorDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "website_analytics_sessions_channel_valid",
      sql`${table.channel} in ('google_ads', 'meta_ads', 'google_organic', 'direct', 'other')`,
    ),
    check(
      "website_analytics_sessions_click_id_type_valid",
      sql`${table.clickIdType} is null or ${table.clickIdType} in ('gclid', 'gbraid', 'wbraid', 'fbclid')`,
    ),
    check(
      "website_analytics_sessions_country_code_valid",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

export const websiteAnalyticsPageviews = pgTable(
  "website_analytics_pageviews",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => websiteAnalyticsSessions.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    pathname: varchar("pathname", { length: 512 }).notNull(),
  },
  (table) => [
    index("website_analytics_pageviews_session_idx").on(table.sessionId),
    index("website_analytics_pageviews_local_path_session_idx")
      .on(table.localDate, table.pathname, table.sessionId),
    check(
      "website_analytics_pageviews_pathname_valid",
      sql`${table.pathname} ~ '^/' and ${table.pathname} !~ '[?#]'`,
    ),
  ],
);

export type WebsiteAnalyticsConversionType = "inquiry" | "order";
export type WebsiteAnalyticsConversionSourceType =
  | "order"
  | "production_job"
  | "customer_service_conversation";

export const websiteAnalyticsConversions = pgTable(
  "website_analytics_conversions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversionType: text("conversion_type").$type<WebsiteAnalyticsConversionType>().notNull(),
    sourceType: text("source_type").$type<WebsiteAnalyticsConversionSourceType>().notNull(),
    sourceId: text("source_id").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    productionJobId: uuid("production_job_id")
      .references(() => productionJobs.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id")
      .references(() => customerServiceConversations.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    scope: text("scope").$type<WebsiteAnalyticsScope>().notNull(),
    market: text("market").$type<WebsiteAnalyticsMarket>(),
    currency: text("currency").$type<WebsiteAnalyticsCurrency>(),
    orderedAmountInclGstCents: bigint("ordered_amount_incl_gst_cents", { mode: "number" }),
    visitorDigest: varchar("visitor_digest", { length: 64 }),
    convertingSessionId: uuid("converting_session_id")
      .references(() => websiteAnalyticsSessions.id, { onDelete: "set null" }),
    firstSessionId: uuid("first_session_id")
      .references(() => websiteAnalyticsSessions.id, { onDelete: "set null" }),
    lastSessionId: uuid("last_session_id")
      .references(() => websiteAnalyticsSessions.id, { onDelete: "set null" }),
    lastNonDirectSessionId: uuid("last_non_direct_session_id")
      .references(() => websiteAnalyticsSessions.id, { onDelete: "set null" }),
    historical: boolean("historical").default(false).notNull(),
    consentLinked: boolean("consent_linked").default(false).notNull(),
    attributionVersion: text("attribution_version").default("v2").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_analytics_conversions_source_unique")
      .on(table.conversionType, table.sourceType, table.sourceId),
    index("website_analytics_conversions_local_scope_type_idx")
      .on(table.localDate, table.scope, table.conversionType),
    index("website_analytics_conversions_occurred_id_idx")
      .on(table.occurredAt, table.id),
    index("website_analytics_conversions_order_idx")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    index("website_analytics_conversions_job_idx")
      .on(table.productionJobId)
      .where(sql`${table.productionJobId} is not null`),
    index("website_analytics_conversions_conversation_idx")
      .on(table.conversationId)
      .where(sql`${table.conversationId} is not null`),
    index("website_analytics_conversions_visitor_occurred_idx")
      .on(table.visitorDigest, table.occurredAt)
      .where(sql`${table.visitorDigest} is not null`),
    check(
      "website_analytics_conversions_type_valid",
      sql`${table.conversionType} in ('inquiry', 'order')`,
    ),
    check(
      "website_analytics_conversions_source_type_valid",
      sql`${table.sourceType} in ('order', 'production_job', 'customer_service_conversation')
        and length(trim(${table.sourceId})) > 0`,
    ),
    check(
      "website_analytics_conversions_scope_valid",
      sql`${table.scope} in ('website', 'all_business')`,
    ),
    check(
      "website_analytics_conversions_commercial_shape_valid",
      sql`(
        ${table.conversionType} = 'inquiry'
        and ${table.scope} = 'website'
        and ${table.market} is null
        and ${table.currency} is null
        and ${table.orderedAmountInclGstCents} is null
      ) or (
        ${table.conversionType} = 'order'
        and ${table.market} in ('NZ', 'AU')
        and ((${table.market} = 'NZ' and ${table.currency} = 'NZD')
          or (${table.market} = 'AU' and ${table.currency} = 'AUD'))
        and ${table.orderedAmountInclGstCents} > 0
      )`,
    ),
    check(
      "website_analytics_conversions_source_reference_valid",
      sql`(
        ${table.sourceType} = 'order'
        and ${table.conversionType} = 'order'
        and ${table.scope} = 'website'
        and ${table.productionJobId} is null
        and ${table.conversationId} is null
      ) or (
        ${table.sourceType} = 'production_job'
        and ${table.conversionType} = 'order'
        and ${table.scope} = 'all_business'
        and ${table.orderId} is null
        and ${table.conversationId} is null
      ) or (
        ${table.sourceType} = 'customer_service_conversation'
        and ${table.conversionType} = 'inquiry'
        and ${table.orderId} is null
        and ${table.productionJobId} is null
      )`,
    ),
    check(
      "website_analytics_conversions_visitor_digest_valid",
      sql`${table.visitorDigest} is null or ${table.visitorDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "website_analytics_conversions_consent_links_valid",
      sql`(${table.consentLinked} and ${table.visitorDigest} is not null and ${table.convertingSessionId} is not null)
        or (not ${table.consentLinked}
          and ${table.visitorDigest} is null
          and ${table.convertingSessionId} is null
          and ${table.firstSessionId} is null
          and ${table.lastSessionId} is null
          and ${table.lastNonDirectSessionId} is null)`,
    ),
    check(
      "website_analytics_conversions_attribution_version_valid",
      sql`${table.attributionVersion} = 'v2'`,
    ),
  ],
);

export const websiteAnalyticsAttributionSnapshots = pgTable(
  "website_analytics_attribution_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversionId: uuid("conversion_id")
      .notNull()
      .references(() => websiteAnalyticsConversions.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .references(() => websiteAnalyticsSessions.id, { onDelete: "set null" }),
    attributionModel: text("attribution_model").$type<WebsiteAnalyticsAttributionModel>().notNull(),
    channel: text("channel").$type<WebsiteAnalyticsV2Channel>().notNull(),
    source: text("source").notNull(),
    medium: text("medium"),
    campaign: text("campaign"),
    term: text("term"),
    content: text("content"),
    landingPath: varchar("landing_path", { length: 512 }),
    externalReferrerOrigin: text("external_referrer_origin"),
    market: text("market").$type<WebsiteAnalyticsMarket>(),
    countryCode: varchar("country_code", { length: 2 }),
    deviceCategory: text("device_category").$type<WebsiteAnalyticsDeviceCategory>(),
    consentQualifiedClickIds: jsonb("consent_qualified_click_ids")
      .$type<WebsiteAnalyticsConsentQualifiedClickIds>(),
    visitorReference: varchar("visitor_reference", { length: 64 }),
    conversionReference: text("conversion_reference"),
    attributedAt: timestamp("attributed_at", { withTimezone: true }).notNull(),
    rulesVersion: text("rules_version").default("v2").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_analytics_attribution_conversion_model_unique")
      .on(table.conversionId, table.attributionModel),
    index("website_analytics_attribution_model_channel_idx")
      .on(table.attributionModel, table.channel),
    index("website_analytics_attribution_campaign_idx")
      .on(table.attributionModel, table.campaign, table.source),
    check(
      "website_analytics_attribution_model_valid",
      sql`${table.attributionModel} in ('first_touch', 'last_touch')`,
    ),
    check(
      "website_analytics_attribution_channel_valid",
      sql`${table.channel} in ('google_ads', 'meta_ads', 'google_organic', 'direct', 'other', 'unattributed', 'manual')`,
    ),
    check(
      "website_analytics_attribution_landing_path_valid",
      sql`${table.landingPath} is null or (${table.landingPath} ~ '^/' and ${table.landingPath} !~ '[?#]')`,
    ),
    check(
      "website_analytics_attribution_market_valid",
      sql`${table.market} is null or ${table.market} in ('NZ', 'AU')`,
    ),
    check(
      "website_analytics_attribution_country_valid",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "website_analytics_attribution_device_valid",
      sql`${table.deviceCategory} is null or ${table.deviceCategory} in ('desktop', 'mobile', 'tablet', 'other')`,
    ),
    check(
      "website_analytics_attribution_click_ids_valid",
      sql`${table.consentQualifiedClickIds} is null
        or (jsonb_typeof(${table.consentQualifiedClickIds}) = 'object'
          and ${table.consentQualifiedClickIds} - array['gclid', 'gbraid', 'wbraid', 'fbclid']::text[] = '{}'::jsonb
          and not jsonb_path_exists(
            ${table.consentQualifiedClickIds},
            '$.* ? (@.type() != "string" || @ == "")'
          ))`,
    ),
    check(
      "website_analytics_attribution_visitor_reference_valid",
      sql`${table.visitorReference} is null or ${table.visitorReference} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "website_analytics_attribution_rules_version_valid",
      sql`${table.rulesVersion} = 'v2'`,
    ),
  ],
);

export type WebsiteAnalyticsFinancialSourceType =
  | "payment_attempt"
  | "payment_ledger_entry"
  | "manual_payment_update"
  | "payment_provider_event";

export const websiteAnalyticsFinancialEvents = pgTable(
  "website_analytics_financial_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversionId: uuid("conversion_id")
      .references(() => websiteAnalyticsConversions.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    productionJobId: uuid("production_job_id")
      .references(() => productionJobs.id, { onDelete: "set null" }),
    eventType: text("event_type").$type<"receipt" | "refund" | "reversal">().notNull(),
    sourceType: text("source_type").$type<WebsiteAnalyticsFinancialSourceType>().notNull(),
    sourceId: text("source_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").$type<WebsiteAnalyticsCurrency>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    historical: boolean("historical").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_analytics_financial_source_event_unique")
      .on(table.sourceType, table.sourceId, table.eventType),
    index("website_analytics_financial_local_currency_type_idx")
      .on(table.localDate, table.currency, table.eventType),
    index("website_analytics_financial_conversion_occurred_idx")
      .on(table.conversionId, table.occurredAt),
    index("website_analytics_financial_order_idx")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    index("website_analytics_financial_job_idx")
      .on(table.productionJobId)
      .where(sql`${table.productionJobId} is not null`),
    check(
      "website_analytics_financial_event_type_valid",
      sql`${table.eventType} in ('receipt', 'refund', 'reversal')`,
    ),
    check(
      "website_analytics_financial_source_type_valid",
      sql`${table.sourceType} in ('payment_attempt', 'payment_ledger_entry', 'manual_payment_update', 'payment_provider_event')
        and length(trim(${table.sourceId})) > 0`,
    ),
    check(
      "website_analytics_financial_amount_positive",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "website_analytics_financial_currency_valid",
      sql`${table.currency} in ('NZD', 'AUD')`,
    ),
    check(
      "website_analytics_financial_reference_valid",
      sql`${table.conversionId} is not null or ${table.orderId} is not null or ${table.productionJobId} is not null`,
    ),
  ],
);

export const websiteAnalyticsDailyAggregates = pgTable(
  "website_analytics_daily_aggregates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    scope: text("scope").$type<WebsiteAnalyticsScope>().notNull(),
    market: text("market").notNull(),
    currency: text("currency").notNull(),
    channel: text("channel").notNull(),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    campaign: text("campaign").notNull(),
    attributionModel: text("attribution_model").$type<WebsiteAnalyticsAttributionModel>().notNull(),
    visitors: bigint("visitors", { mode: "number" }).default(0).notNull(),
    sessions: bigint("sessions", { mode: "number" }).default(0).notNull(),
    pageViews: bigint("page_views", { mode: "number" }).default(0).notNull(),
    inquiries: bigint("inquiries", { mode: "number" }).default(0).notNull(),
    orders: bigint("orders", { mode: "number" }).default(0).notNull(),
    paidOrders: bigint("paid_orders", { mode: "number" }).default(0).notNull(),
    orderedRevenueCents: bigint("ordered_revenue_cents", { mode: "number" }).default(0).notNull(),
    collectedRevenueCents: bigint("collected_revenue_cents", { mode: "number" }).default(0).notNull(),
    refundedRevenueCents: bigint("refunded_revenue_cents", { mode: "number" }).default(0).notNull(),
    netCollectedRevenueCents: bigint("net_collected_revenue_cents", { mode: "number" }).default(0).notNull(),
    rulesVersion: text("rules_version").default("v2").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_analytics_daily_dimensions_unique").on(
      table.localDate,
      table.scope,
      table.market,
      table.currency,
      table.channel,
      table.source,
      table.medium,
      table.campaign,
      table.attributionModel,
      table.rulesVersion,
    ),
    index("website_analytics_daily_scope_model_date_idx")
      .on(table.scope, table.attributionModel, table.localDate),
    index("website_analytics_daily_channel_date_idx")
      .on(table.channel, table.localDate),
    index("website_analytics_daily_campaign_date_idx")
      .on(table.campaign, table.localDate),
    check(
      "website_analytics_daily_scope_valid",
      sql`${table.scope} in ('website', 'all_business')`,
    ),
    check(
      "website_analytics_daily_market_valid",
      sql`${table.market} in ('NZ', 'AU', 'Unattributed')`,
    ),
    check(
      "website_analytics_daily_currency_valid",
      sql`${table.currency} in ('NZD', 'AUD', '(not set)')
        and ((${table.market} = 'NZ' and ${table.currency} = 'NZD')
          or (${table.market} = 'AU' and ${table.currency} = 'AUD')
          or (${table.market} = 'Unattributed' and ${table.currency} = '(not set)'))`,
    ),
    check(
      "website_analytics_daily_attribution_model_valid",
      sql`${table.attributionModel} in ('first_touch', 'last_touch')`,
    ),
    check(
      "website_analytics_daily_dimensions_valid",
      sql`length(trim(${table.channel})) > 0
        and length(trim(${table.source})) > 0
        and length(trim(${table.medium})) > 0
        and length(trim(${table.campaign})) > 0`,
    ),
    check(
      "website_analytics_daily_counts_nonnegative",
      sql`${table.visitors} >= 0
        and ${table.sessions} >= 0
        and ${table.pageViews} >= 0
        and ${table.inquiries} >= 0
        and ${table.orders} >= 0
        and ${table.paidOrders} >= 0`,
    ),
    check(
      "website_analytics_daily_money_valid",
      sql`${table.orderedRevenueCents} >= 0
        and ${table.collectedRevenueCents} >= 0
        and ${table.refundedRevenueCents} >= 0
        and ${table.netCollectedRevenueCents} = ${table.collectedRevenueCents} - ${table.refundedRevenueCents}
        and (${table.currency} <> '(not set)'
          or (${table.orderedRevenueCents} = 0
            and ${table.collectedRevenueCents} = 0
            and ${table.refundedRevenueCents} = 0
            and ${table.netCollectedRevenueCents} = 0))`,
    ),
    check(
      "website_analytics_daily_rules_version_valid",
      sql`${table.rulesVersion} = 'v2'`,
    ),
  ],
);

export type WebsiteAnalyticsReconciliationStateType =
  | "dirty_date"
  | "backfill"
  | "reconciliation";
export type WebsiteAnalyticsReconciliationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export const websiteAnalyticsReconciliationState = pgTable(
  "website_analytics_reconciliation_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stateType: text("state_type").$type<WebsiteAnalyticsReconciliationStateType>().notNull(),
    stateKey: text("state_key").notNull(),
    localDate: date("local_date", { mode: "string" }),
    cursorOccurredAt: timestamp("cursor_occurred_at", { withTimezone: true }),
    cursorId: text("cursor_id"),
    status: text("status").$type<WebsiteAnalyticsReconciliationStatus>().default("pending").notNull(),
    scannedCount: bigint("scanned_count", { mode: "number" }).default(0).notNull(),
    createdCount: bigint("created_count", { mode: "number" }).default(0).notNull(),
    unchangedCount: bigint("unchanged_count", { mode: "number" }).default(0).notNull(),
    skippedCount: bigint("skipped_count", { mode: "number" }).default(0).notNull(),
    failedCount: bigint("failed_count", { mode: "number" }).default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("website_analytics_reconciliation_state_key_unique")
      .on(table.stateType, table.stateKey),
    index("website_analytics_reconciliation_status_date_idx")
      .on(table.status, table.localDate),
    check(
      "website_analytics_reconciliation_state_type_valid",
      sql`${table.stateType} in ('dirty_date', 'backfill', 'reconciliation')
        and length(trim(${table.stateKey})) > 0`,
    ),
    check(
      "website_analytics_reconciliation_status_valid",
      sql`${table.status} in ('pending', 'running', 'completed', 'failed')`,
    ),
    check(
      "website_analytics_reconciliation_state_shape_valid",
      sql`(${table.stateType} = 'dirty_date'
          and ${table.localDate} is not null
          and ${table.cursorOccurredAt} is null
          and ${table.cursorId} is null)
        or (${table.stateType} in ('backfill', 'reconciliation')
          and ${table.localDate} is null)`,
    ),
    check(
      "website_analytics_reconciliation_counts_nonnegative",
      sql`${table.scannedCount} >= 0
        and ${table.createdCount} >= 0
        and ${table.unchangedCount} >= 0
        and ${table.skippedCount} >= 0
        and ${table.failedCount} >= 0`,
    ),
    check(
      "website_analytics_reconciliation_completion_valid",
      sql`(${table.status} = 'pending' and ${table.startedAt} is null and ${table.completedAt} is null)
        or (${table.status} = 'running' and ${table.startedAt} is not null and ${table.completedAt} is null)
        or (${table.status} = 'completed' and ${table.startedAt} is not null and ${table.completedAt} is not null)
        or (${table.status} = 'failed' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.lastErrorCode} is not null)`,
    ),
  ],
);

export type ConversionPlatform = "google" | "meta";
export type ConversionDeliveryStatus =
  | "pending"
  | "sending"
  | "accepted"
  | "processing"
  | "succeeded"
  | "retryable_failed"
  | "permanent_failed"
  | "dead_letter";
export type ConversionEventSource = "WEB" | "MESSAGE" | "PHONE" | "OTHER";
export type ConversionErrorCategory =
  | "transport"
  | "rate_limit"
  | "provider_server"
  | "authentication"
  | "permission"
  | "configuration"
  | "invalid_event"
  | "partial_success"
  | "observation_timeout";

export type ConversionProviderRequestStatus =
  | "REQUEST_STATUS_UNKNOWN"
  | "SUCCESS"
  | "PROCESSING"
  | "FAILURE"
  | "PARTIAL_SUCCESS";

export type ConversionProviderDiagnostics = Readonly<{
  version: 1;
  requestStatus: ConversionProviderRequestStatus;
  destinations: readonly Readonly<{
    requestStatus: ConversionProviderRequestStatus;
    recordCount?: string;
    errors: readonly Readonly<{ recordCount: string; reason: string }>[];
    warnings: readonly Readonly<{ recordCount: string; reason: string }>[];
  }>[];
}>;

export type ConversionConsentSnapshot = Readonly<{
  version: 1;
  decision: "granted";
  recordedAt: string;
  evidenceSource: "manual_order_field";
  adUserData: "CONSENT_GRANTED";
  adPersonalization: "CONSENT_DENIED";
}>;

export type ConversionAttributionSnapshot = Readonly<{
  version: 1;
  source: "google" | "meta";
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  fbp?: string;
  fbc?: string;
}>;

export type ConversionUserDataSnapshot = Readonly<{
  version: 1;
  hashedEmail?: string;
  hashedPhone?: string;
}>;

export type RedactedConversionSnapshot = Readonly<{
  version: 1;
  redacted: true;
}>;

export const analyticsConversionDeliveries = pgTable(
  "analytics_conversion_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").$type<ConversionPlatform>().notNull(),
    transactionId: text("transaction_id").notNull(),
    jobId: uuid("job_id").notNull(),
    eventType: text("event_type").default("purchase").notNull(),
    eventOccurredAt: timestamp("event_occurred_at", { withTimezone: true }).notNull(),
    eventSource: text("event_source").$type<ConversionEventSource>().notNull(),
    currency: text("currency").$type<"NZD" | "AUD">().notNull(),
    valueMinor: bigint("value_minor", { mode: "number" }).notNull(),
    consentSnapshot: jsonb("consent_snapshot")
      .$type<ConversionConsentSnapshot | RedactedConversionSnapshot>()
      .notNull(),
    attributionSnapshot: jsonb("attribution_snapshot")
      .$type<ConversionAttributionSnapshot | RedactedConversionSnapshot>()
      .notNull(),
    userDataSnapshot: jsonb("user_data_snapshot")
      .$type<ConversionUserDataSnapshot | RedactedConversionSnapshot>()
      .notNull(),
    status: text("status")
      .$type<ConversionDeliveryStatus>()
      .default("pending")
      .notNull(),
    requestId: text("request_id"),
    attemptCount: bigint("attempt_count", { mode: "number" }).default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorCategory: text("last_error_category").$type<ConversionErrorCategory>(),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    providerDiagnostics: jsonb("provider_diagnostics")
      .$type<ConversionProviderDiagnostics>(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analytics_conversion_deliveries_platform_transaction_unique")
      .on(table.platform, table.transactionId),
    index("analytics_conversion_deliveries_status_next_attempt_idx")
      .on(table.status, table.nextAttemptAt),
    index("analytics_conversion_deliveries_job_idx").on(table.jobId),
    index("analytics_conversion_deliveries_request_idx")
      .on(table.requestId)
      .where(sql`${table.requestId} is not null`),
    index("analytics_conversion_deliveries_stale_lease_idx")
      .on(table.status, table.leaseExpiresAt)
      .where(sql`${table.status} = 'sending'`),
    check(
      "analytics_conversion_deliveries_platform_valid",
      sql`${table.platform} in ('google', 'meta')`,
    ),
    check(
      "analytics_conversion_deliveries_transaction_id_valid",
      sql`${table.transactionId} ~ '^manual-order:[0-9a-f-]{36}$'`,
    ),
    check(
      "analytics_conversion_deliveries_event_type_valid",
      sql`${table.eventType} = 'purchase'`,
    ),
    check(
      "analytics_conversion_deliveries_event_source_valid",
      sql`${table.eventSource} in ('WEB', 'MESSAGE', 'PHONE', 'OTHER')`,
    ),
    check(
      "analytics_conversion_deliveries_currency_valid",
      sql`${table.currency} in ('NZD', 'AUD')`,
    ),
    check(
      "analytics_conversion_deliveries_value_positive",
      sql`${table.valueMinor} > 0`,
    ),
    check(
      "analytics_conversion_deliveries_status_valid",
      sql`${table.status} in ('pending', 'sending', 'accepted', 'processing', 'succeeded', 'retryable_failed', 'permanent_failed', 'dead_letter')`,
    ),
    check(
      "analytics_conversion_deliveries_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "analytics_conversion_deliveries_snapshots_objects",
      sql`jsonb_typeof(${table.consentSnapshot}) = 'object'
        and jsonb_typeof(${table.attributionSnapshot}) = 'object'
        and jsonb_typeof(${table.userDataSnapshot}) = 'object'`,
    ),
    check(
      "analytics_conversion_deliveries_lease_shape_valid",
      sql`(${table.status} = 'sending' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)
        or (${table.status} <> 'sending' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "analytics_conversion_deliveries_request_state_valid",
      sql`${table.platform} = 'meta'
        or ${table.status} not in ('accepted', 'processing', 'succeeded')
        or ${table.requestId} is not null`,
    ),
    check(
      "analytics_conversion_deliveries_error_category_valid",
      sql`${table.lastErrorCategory} is null or ${table.lastErrorCategory} in ('transport', 'rate_limit', 'provider_server', 'authentication', 'permission', 'configuration', 'invalid_event', 'partial_success', 'observation_timeout')`,
    ),
    check(
      "analytics_conversion_deliveries_diagnostics_object",
      sql`${table.providerDiagnostics} is null or jsonb_typeof(${table.providerDiagnostics}) = 'object'`,
    ),
  ],
);
