import { sql } from "drizzle-orm";
import {
  bigint,
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
