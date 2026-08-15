import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { orders, paymentAttempts, webhookEvents } from "./index";

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

  it("allows only one nonterminal attempt globally per order", () => {
    const attemptConfig = getTableConfig(paymentAttempts);
    const index = attemptConfig.indexes.find(
      (candidate) =>
        candidate.config.name === "payment_attempts_one_nonterminal_unique",
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(1);
    expect(index?.config.columns[0]).toMatchObject({ name: "order_id" });
    expect(index?.config.where).toBeDefined();
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
