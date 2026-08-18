import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index";

const { orders, paymentAttempts, webhookEvents } = schema;

describe("payment schema contract", () => {
  it("defines payment attempts with immutable order money ownership", () => {
    expect(getTableName(paymentAttempts)).toBe("payment_attempts");

    const attemptConfig = getTableConfig(paymentAttempts);
    const moneyForeignKey = attemptConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === "payment_attempts_expected_order_amount_fk",
    );

    expect(moneyForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      "order_id",
      "expected_amount_cents",
      "currency",
    ]);
    expect(
      moneyForeignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(["id", "total_incl_gst_cents", "currency"]);
    expect(getTableConfig(orders).uniqueConstraints.map((item) => item.name)).toContain(
      "orders_id_total_incl_gst_currency_unique",
    );
    expect(attemptConfig.checks.map((check) => check.name)).toContain(
      "payment_attempts_currency_valid",
    );
  });

  it("binds every attempt to exactly one payment target", () => {
    const attemptConfig = getTableConfig(paymentAttempts);
    const columns = attemptConfig.columns.map((column) => column.name);

    expect(columns).toEqual(expect.arrayContaining([
      "order_id",
      "payment_request_id",
      "payer_snapshot",
    ]));
    expect(attemptConfig.checks.map((item) => item.name)).toContain(
      "payment_attempts_exactly_one_target",
    );

    const indexNames = attemptConfig.indexes.map((item) => item.config.name);
    expect(indexNames).toEqual(expect.arrayContaining([
      "payment_attempts_one_nonterminal_order_unique",
      "payment_attempts_one_nonterminal_request_unique",
    ]));

    expect(attemptConfig.foreignKeys.map((item) => item.getName())).toContain(
      "payment_attempts_expected_payment_request_amount_fk",
    );
  });

  it("defines fixed payment requests without a partially-paid state", () => {
    const paymentRequests = Reflect.get(schema, "paymentRequests");
    expect(paymentRequests).toBeDefined();
    if (!paymentRequests) return;

    expect(getTableName(paymentRequests)).toBe("payment_requests");
    const config = getTableConfig(paymentRequests);
    expect(config.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "payment_requests_target_matches_kind",
      "payment_requests_amount_positive",
      "payment_requests_status_valid",
      "payment_requests_token_digest_format",
    ]));
    expect(config.uniqueConstraints.map((item) => item.name)).toContain(
      "payment_requests_expected_amount_unique",
    );
    expect(config.columns.map((column) => column.name)).not.toContain(
      "partially_paid_amount_cents",
    );
  });

  it("defines an append-only payment ledger with reversal ownership", () => {
    const paymentLedgerEntries = Reflect.get(schema, "paymentLedgerEntries");
    expect(paymentLedgerEntries).toBeDefined();
    if (!paymentLedgerEntries) return;

    expect(getTableName(paymentLedgerEntries)).toBe("payment_ledger_entries");
    const config = getTableConfig(paymentLedgerEntries);
    expect(config.checks.map((item) => item.name)).toEqual(expect.arrayContaining([
      "payment_ledger_entries_target_valid",
      "payment_ledger_entries_amount_positive",
      "payment_ledger_entries_type_valid",
      "payment_ledger_entries_direction_valid",
    ]));
    expect(config.indexes.map((item) => item.config.name)).toContain(
      "payment_ledger_entries_payment_attempt_unique",
    );
    expect(config.indexes.map((item) => item.config.name)).toContain(
      "payment_ledger_entries_reversal_unique",
    );
  });

  it("defines a durable Payment Request notification outbox", () => {
    const outbox = Reflect.get(schema, "paymentRequestNotificationOutbox");
    expect(outbox).toBeDefined();
    if (!outbox) return;

    expect(getTableName(outbox)).toBe("payment_request_notification_outbox");
    const config = getTableConfig(outbox);
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "event_key",
      "kind",
      "payment_request_id",
      "recipient_name",
      "recipient_email",
      "status",
      "attempts",
      "available_at",
      "sent_at",
    ]));
    expect(config.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      "payment_request_notification_outbox_event_key_unique",
      "payment_request_notification_outbox_status_available_idx",
    ]));
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "payment_request_notification_outbox_kind_valid",
      "payment_request_notification_outbox_status_valid",
      "payment_request_notification_outbox_recipient_present",
    ]));
  });

  it("deduplicates non-null return-state digests per provider", () => {
    const index = getTableConfig(paymentAttempts).indexes.find(
      (candidate) =>
        candidate.config.name ===
        "payment_attempts_provider_return_state_digest_unique",
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(2);
    expect(index?.config.where).toBeDefined();
  });

  it("stores webhook metadata without raw payloads", () => {
    expect(getTableName(webhookEvents)).toBe("webhook_events");

    const eventConfig = getTableConfig(webhookEvents);
    const columns = eventConfig.columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "provider",
        "provider_event_id",
        "payload_sha256",
        "processing_result",
        "processed_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining(["raw_payload", "payload", "request_body"]),
    );
    expect(eventConfig.indexes.map((index) => index.config.name)).toContain(
      "webhook_events_provider_event_unique",
    );
    expect(eventConfig.checks.map((check) => check.name)).toContain(
      "webhook_events_sha256_format",
    );
  });

  it("never persists browser-facing provider secrets or redirects", () => {
    const columns = getTableConfig(paymentAttempts).columns.map(
      (column) => column.name,
    );

    expect(columns).not.toEqual(
      expect.arrayContaining([
        "client_secret",
        "redirect_url",
        "raw_body",
        "raw_payload",
      ]),
    );
  });
});
