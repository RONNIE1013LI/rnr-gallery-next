import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceConversationIdentities,
  customerServiceConversations,
  customerServiceHumanReviews,
  customerServiceRateLimitBuckets,
  customerServiceRetentionHolds,
  customerServiceReviewAlertOutbox,
  customerServiceReviewSelectors,
  customerServiceWebSessions,
  customerServiceWebsiteAssistantMessages,
  customerServiceWebsiteMetricEvents,
} from "./index";

const initialWebsiteTables = [
  customerServiceWebSessions,
  customerServiceWebsiteAssistantMessages,
  customerServiceHumanReviews,
  customerServiceReviewAlertOutbox,
  customerServiceRateLimitBuckets,
];
const websiteTables = [
  ...initialWebsiteTables.slice(0, 3),
  customerServiceReviewSelectors,
  ...initialWebsiteTables.slice(3),
];

describe("website customer service schema contract", () => {
  it("stores one hash-only authoritative identity per technical conversation", () => {
    const columns = getTableColumns(customerServiceConversationIdentities);
    const config = getTableConfig(customerServiceConversationIdentities);
    const identityIndex = config.indexes.find((item) => (
      item.config.name === "customer_service_conversation_identities_lookup_idx"
    ));
    const conversationForeignKey = config.foreignKeys.find((item) => (
      item.getName() === "customer_service_conversation_identities_conversation_fk"
    ));

    expect(getTableName(customerServiceConversationIdentities)).toBe(
      "customer_service_conversation_identities",
    );
    expect(Object.keys(columns)).toEqual([
      "conversationId",
      "channel",
      "identityKind",
      "identityKeyHash",
      "createdAt",
      "updatedAt",
    ]);
    expect(columns.conversationId).toMatchObject({ primary: true, notNull: true });
    expect(columns.channel).toMatchObject({ notNull: true });
    expect(columns.identityKind).toMatchObject({ notNull: true });
    expect(columns.identityKeyHash).toMatchObject({ notNull: true });
    expect(columns.createdAt).toMatchObject({ notNull: true });
    expect(columns.updatedAt).toMatchObject({ notNull: true });
    expect(config.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "customer_service_conversation_identities_channel_valid",
      "customer_service_conversation_identities_kind_valid",
      "customer_service_conversation_identities_hash_valid",
    ]));
    expect(identityIndex?.config.unique).toBe(false);
    expect(identityIndex?.config.columns.map((column) => (
      typeof column === "object" && column !== null && "name" in column
        ? column.name
        : "<expression>"
    ))).toEqual(["channel", "identity_kind", "identity_key_hash"]);
    expect(conversationForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      "conversation_id",
      "channel",
    ]);
    expect(conversationForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual([
      "id",
      "channel",
    ]);
    expect(conversationForeignKey?.onDelete).toBe("restrict");
    expect(Object.keys(columns)).not.toEqual(expect.arrayContaining([
      "psid",
      "customerId",
      "visitorId",
      "cookie",
      "ipAddress",
      "fingerprint",
      "email",
      "name",
    ]));
  });

  it("stores nullable canonical Website renderer proof on AI attempts", () => {
    expect(getTableColumns(customerServiceAiAttempts)).toEqual(expect.objectContaining({
      websiteDecision: expect.anything(),
      websiteResponseTemplateVersion: expect.anything(),
    }));
  });

  it("defines the additive website persistence tables", () => {
    expect(websiteTables.map(getTableName)).toEqual([
      "customer_service_web_sessions",
      "customer_service_website_assistant_messages",
      "customer_service_human_reviews",
      "customer_service_review_selectors",
      "customer_service_review_alert_outbox",
      "customer_service_rate_limit_buckets",
    ]);
  });

  it("stores only HMAC session identity and seven-day lifecycle metadata", () => {
    const columns = getTableColumns(customerServiceWebSessions);
    const names = Object.keys(columns);

    expect(columns).toEqual(expect.objectContaining({
      conversationId: expect.anything(),
      channel: expect.anything(),
      sessionTokenHash: expect.anything(),
      status: expect.anything(),
      expiresAt: expect.anything(),
      lastSeenAt: expect.anything(),
    }));
    expect(columns.status.default).toBe("active");
    expect(names).not.toEqual(expect.arrayContaining([
      "session_token",
      "cookie",
      "raw_ip",
      "ip_address",
      "user_agent",
    ]));
  });

  it("publishes at most one website response per turn and AI attempt", () => {
    const config = getTableConfig(customerServiceWebsiteAssistantMessages);
    const columns = getTableColumns(customerServiceWebsiteAssistantMessages);

    expect(columns).toEqual(expect.objectContaining({
      conversationId: expect.anything(),
      channel: expect.anything(),
      messageId: expect.anything(),
      turnId: expect.anything(),
      aiAttemptId: expect.anything(),
      kind: expect.anything(),
      body: expect.anything(),
      policyResult: expect.anything(),
      gateReasons: expect.anything(),
      knowledgeVersion: expect.anything(),
      publishedAt: expect.anything(),
    }));
    expect(config.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      "customer_service_website_assistant_messages_turn_unique",
      "customer_service_website_assistant_messages_attempt_unique",
      "customer_service_website_assistant_messages_conversation_published_idx",
    ]));
  });

  it("models one open human-review generation and one alert per incident", () => {
    const reviewConfig = getTableConfig(customerServiceHumanReviews);
    const outboxConfig = getTableConfig(customerServiceReviewAlertOutbox);
    const selectorConfig = getTableConfig(customerServiceReviewSelectors);
    const reviewColumns = getTableColumns(customerServiceHumanReviews);
    const outboxColumns = getTableColumns(customerServiceReviewAlertOutbox);
    const selectorColumns = getTableColumns(customerServiceReviewSelectors);

    expect(reviewColumns).toEqual(expect.objectContaining({
      conversationId: expect.anything(),
      triggerTurnId: expect.anything(),
      generation: expect.anything(),
      reason: expect.anything(),
      status: expect.anything(),
      redactedSummary: expect.anything(),
      deepLinkTokenHash: expect.anything(),
      deepLinkExpiresAt: expect.anything(),
      resolvedByUserId: expect.anything(),
      resolutionEventId: expect.anything(),
    }));
    expect(reviewConfig.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      "customer_service_human_reviews_conversation_generation_unique",
      "customer_service_human_reviews_open_conversation_unique",
      "customer_service_human_reviews_deep_link_unique",
      "customer_service_human_reviews_deep_link_expiry_idx",
    ]));
    expect(outboxColumns).toEqual(expect.objectContaining({
      humanReviewId: expect.anything(),
      status: expect.anything(),
      idempotencyKey: expect.anything(),
      attemptCount: expect.anything(),
      deduplicatedCount: expect.anything(),
      nextAttemptAt: expect.anything(),
      leaseToken: expect.anything(),
      leaseExpiresAt: expect.anything(),
      providerSendStartedAt: expect.anything(),
      providerPayloadDigest: expect.anything(),
      lastErrorCode: expect.anything(),
      sentAt: expect.anything(),
    }));
    expect(outboxConfig.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      "customer_service_review_alert_outbox_review_unique",
      "customer_service_review_alert_outbox_idempotency_unique",
      "customer_service_review_alert_outbox_due_idx",
    ]));
    expect(selectorColumns).toEqual(expect.objectContaining({
      humanReviewId: expect.anything(),
      generation: expect.anything(),
      selectorHash: expect.anything(),
      expiresAt: expect.anything(),
    }));
    expect(selectorConfig.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      "customer_service_review_selectors_hash_unique",
      "customer_service_review_selectors_review_window_unique",
      "customer_service_review_selectors_expiry_idx",
    ]));
    expect(reviewConfig.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "customer_service_human_reviews_channel_valid",
      "customer_service_human_reviews_resolution_valid",
      "customer_service_human_reviews_deep_link_valid",
    ]));
    expect(outboxConfig.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "customer_service_review_alert_outbox_lease_valid",
      "customer_service_review_alert_outbox_sent_valid",
      "customer_service_review_alert_outbox_deduplicated_valid",
    ]));
    expect(getTableConfig(customerServiceWebsiteAssistantMessages).checks.map((item) => item.name))
      .toEqual(expect.arrayContaining([
        "customer_service_website_assistant_messages_channel_valid",
        "customer_service_website_assistant_messages_policy_valid",
        "customer_service_website_assistant_messages_gate_reasons_valid",
      ]));
  });

  it("stores only hashed rate-limit keys with bounded counters", () => {
    const columns = getTableColumns(customerServiceRateLimitBuckets);
    const names = Object.keys(columns);

    expect(columns).toEqual(expect.objectContaining({
      bucketKind: expect.anything(),
      bucketKeyHash: expect.anything(),
      windowStartedAt: expect.anything(),
      expiresAt: expect.anything(),
      requestCount: expect.anything(),
    }));
    expect(names).not.toEqual(expect.arrayContaining([
      "raw_ip",
      "ip_address",
      "session_token",
      "psid",
    ]));
    expect(getTableConfig(customerServiceRateLimitBuckets).checks.map((item) => item.name))
      .toEqual(expect.arrayContaining([
        "customer_service_rate_limit_buckets_expiry_valid",
        "customer_service_rate_limit_buckets_window_bounded",
      ]));
  });

  it("uses the next forward-only additive migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0044_website_customer_assistant.sql"),
      "utf8",
    );

    for (const table of initialWebsiteTables.map(getTableName)) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration.match(/CREATE TABLE "customer_service_/g)).toHaveLength(5);
    expect(migration).not.toMatch(/CREATE TABLE "(?:orders|payment_requests|payment_attempts|payment_ledger_entries)"/);
    expect(migration).not.toMatch(/^\s*(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)/im);
    expect(migration).not.toMatch(/^\s*DROP\s+CONSTRAINT/im);
    expect(migration).not.toMatch(/\b(?:raw_ip|ip_address|session_token|access_token|secret)\b/i);
  });

  it("keeps every Task 10 through Task 13 website migration free of removal operations", () => {
    const migrationDirectory = resolve(process.cwd(), "drizzle");
    const migrations = readdirSync(migrationDirectory)
      .filter((name) => /^00(?:44|49|50)_.+\.sql$/.test(name))
      .sort()
      .map((name) => ({
        name,
        sql: readFileSync(resolve(migrationDirectory, name), "utf8"),
      }));

    expect(migrations.map((migration) => migration.name)).toEqual([
      "0044_website_customer_assistant.sql",
      "0049_website_review_live_updates.sql",
      expect.stringMatching(/^0050_.+\.sql$/),
    ]);
    for (const migration of migrations) {
      expect(migration.sql, migration.name).not.toMatch(
        /^\s*(?:DROP\b|ALTER\s+TABLE\s+.+\s+DROP\b|TRUNCATE|DELETE\s+FROM)/im,
      );
    }

    const task13Migration = migrations.at(-1)?.sql ?? "";
    expect(task13Migration).toContain('ADD COLUMN "provider_send_started_at"');
    expect(task13Migration).toContain('ADD COLUMN "provider_payload_digest"');
    expect(task13Migration).toContain('CREATE TABLE "customer_service_review_selectors"');
    expect(task13Migration).toContain('CREATE UNIQUE INDEX "customer_service_review_selectors_hash_unique"');
  });

  it("adds Website renderer proof with a forward-only Task 14 migration", () => {
    const migrationDirectory = resolve(process.cwd(), "drizzle");
    const migrationName = readdirSync(migrationDirectory).find((name) => /^0051_.+\.sql$/.test(name));
    expect(migrationName).toEqual(expect.stringMatching(/^0051_.+\.sql$/));
    const migration = readFileSync(resolve(migrationDirectory, migrationName ?? "missing"), "utf8");

    expect(migration).toContain('ADD COLUMN "website_decision" jsonb');
    expect(migration).toContain('ADD COLUMN "website_response_template_version" text');
    expect(migration).not.toMatch(/^\s*(?:DROP\b|ALTER\s+TABLE\s+.+\s+DROP\b|TRUNCATE|DELETE\s+FROM)/im);
  });

  it("adds only hashed retention holds, bounded metric events, and an anonymization marker", () => {
    expect(getTableColumns(customerServiceConversations)).toEqual(expect.objectContaining({
      anonymizedAt: expect.anything(),
    }));
    expect([customerServiceRetentionHolds, customerServiceWebsiteMetricEvents].map(getTableName)).toEqual([
      "customer_service_retention_holds",
      "customer_service_website_metric_events",
    ]);
    expect(getTableColumns(customerServiceRetentionHolds)).toEqual(expect.objectContaining({
      conversationId: expect.anything(),
      reason: expect.anything(),
      referenceHash: expect.anything(),
      expiresAt: expect.anything(),
      releasedAt: expect.anything(),
    }));
    expect(Object.keys(getTableColumns(customerServiceRetentionHolds))).not.toEqual(expect.arrayContaining([
      "orderId", "customerId", "email", "legalNotes", "rawReference",
    ]));
    expect(getTableConfig(customerServiceWebsiteMetricEvents).checks.map((item) => item.name))
      .toEqual(expect.arrayContaining([
        "customer_service_website_metric_events_type_valid",
        "customer_service_website_metric_events_hash_valid",
        "customer_service_website_metric_events_expiry_valid",
      ]));

    const migrationDirectory = resolve(process.cwd(), "drizzle");
    const migrationName = readdirSync(migrationDirectory).find((name) => /^0052_.+\.sql$/.test(name));
    expect(migrationName).toEqual(expect.stringMatching(/^0052_.+\.sql$/));
    const migration = readFileSync(resolve(migrationDirectory, migrationName ?? "missing"), "utf8");
    expect(migration).toContain('CREATE TABLE "customer_service_retention_holds"');
    expect(migration).toContain('CREATE TABLE "customer_service_website_metric_events"');
    expect(migration).toContain('ADD COLUMN "anonymized_at"');
    expect(migration).not.toMatch(/CREATE TABLE "(?:orders|payment_requests|payment_attempts|payment_ledger_entries)"/);
    expect(migration).not.toMatch(/^\s*(?:DROP\b|ALTER\s+TABLE\s+.+\s+DROP\b|TRUNCATE|DELETE\s+FROM)/im);
  });

  it("adds only the Task 15 review constraints, alert counter, and cleanup index", () => {
    const migrationDirectory = resolve(process.cwd(), "drizzle");
    const migrationName = readdirSync(migrationDirectory).find((name) => /^0053_.+\.sql$/.test(name));
    expect(migrationName).toEqual(expect.stringMatching(/^0053_.+\.sql$/));
    const migration = readFileSync(resolve(migrationDirectory, migrationName ?? "missing"), "utf8");

    expect(migration).toContain('ADD COLUMN "deduplicated_count"');
    expect(migration).toContain("customer_service_rate_limit_buckets_window_bounded");
    expect(migration).toContain("customer_service_review_alert_outbox_deduplicated_valid");
    expect(migration).toContain("customer_service_human_reviews_deep_link_expiry_idx");
    const cleanup = 'DELETE FROM "customer_service_rate_limit_buckets"\n'
      + 'WHERE "expires_at" > "window_started_at" + interval \'24 hours\';';
    expect(migration).toContain(cleanup);
    expect(migration.indexOf(cleanup)).toBeLessThan(
      migration.indexOf('ADD CONSTRAINT "customer_service_rate_limit_buckets_window_bounded"'),
    );
    expect(migration).not.toMatch(/CREATE TABLE "(?:orders|payment_requests|payment_attempts|payment_ledger_entries)"/);
    expect(migration.replace(cleanup, "")).not.toMatch(
      /^\s*(?:DROP\b|ALTER\s+TABLE\s+.+\s+DROP\b|TRUNCATE|DELETE\s+FROM)/im,
    );
  });
});
