import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  customerServiceHumanReviews,
  customerServiceRateLimitBuckets,
  customerServiceReviewAlertOutbox,
  customerServiceWebSessions,
  customerServiceWebsiteAssistantMessages,
} from "./index";

const websiteTables = [
  customerServiceWebSessions,
  customerServiceWebsiteAssistantMessages,
  customerServiceHumanReviews,
  customerServiceReviewAlertOutbox,
  customerServiceRateLimitBuckets,
];

describe("website customer service schema contract", () => {
  it("defines the five additive website persistence tables", () => {
    expect(websiteTables.map(getTableName)).toEqual([
      "customer_service_web_sessions",
      "customer_service_website_assistant_messages",
      "customer_service_human_reviews",
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
    const reviewColumns = getTableColumns(customerServiceHumanReviews);
    const outboxColumns = getTableColumns(customerServiceReviewAlertOutbox);

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
    ]));
    expect(outboxColumns).toEqual(expect.objectContaining({
      humanReviewId: expect.anything(),
      status: expect.anything(),
      idempotencyKey: expect.anything(),
      attemptCount: expect.anything(),
      nextAttemptAt: expect.anything(),
      leaseToken: expect.anything(),
      leaseExpiresAt: expect.anything(),
      lastErrorCode: expect.anything(),
      sentAt: expect.anything(),
    }));
    expect(outboxConfig.indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      "customer_service_review_alert_outbox_review_unique",
      "customer_service_review_alert_outbox_idempotency_unique",
      "customer_service_review_alert_outbox_due_idx",
    ]));
    expect(reviewConfig.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "customer_service_human_reviews_channel_valid",
      "customer_service_human_reviews_resolution_valid",
      "customer_service_human_reviews_deep_link_valid",
    ]));
    expect(outboxConfig.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "customer_service_review_alert_outbox_lease_valid",
      "customer_service_review_alert_outbox_sent_valid",
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
  });

  it("uses the next forward-only additive migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0044_website_customer_assistant.sql"),
      "utf8",
    );

    for (const table of websiteTables.map(getTableName)) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration.match(/CREATE TABLE "customer_service_/g)).toHaveLength(5);
    expect(migration).not.toMatch(/CREATE TABLE "(?:orders|payment_requests|payment_attempts|payment_ledger_entries)"/);
    expect(migration).not.toMatch(/^\s*(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)/im);
    expect(migration).not.toMatch(/^\s*DROP\s+CONSTRAINT/im);
    expect(migration).not.toMatch(/\b(?:raw_ip|ip_address|session_token|access_token|secret)\b/i);
  });
});
