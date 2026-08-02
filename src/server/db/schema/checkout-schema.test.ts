import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  checkoutSessions,
  checkoutUploads,
  orderAddresses,
  orderItems,
  orders,
  shippingQuotes,
} from "./index";

function config(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table);
}

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return config(table).columns.map((column) => column.name);
}

function referencedTables(table: Parameters<typeof getTableConfig>[0]) {
  return config(table).foreignKeys.map(
    (foreignKey) => getTableName(foreignKey.reference().foreignTable),
  );
}

describe("checkout and order schema contract", () => {
  it("backfills completed checkout sessions before adding order guards", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0003_awesome_tattoo.sql"),
      "utf8",
    );
    const backfill = migration.indexOf(
      'UPDATE "checkout_sessions" AS "session_snapshot" SET "completed_at"',
    );
    const firstGuard = migration.indexOf(
      'CREATE UNIQUE INDEX "orders_session_idempotency_unique"',
    );

    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(firstGuard);
    expect(migration.slice(backfill, firstGuard)).toContain(
      '"order_snapshot"."created_at"',
    );
  });

  it("stores only a unique opaque checkout token digest", () => {
    expect(columnNames(checkoutSessions)).toContain("token_digest");
    expect(columnNames(checkoutSessions)).not.toContain("token");
    expect(checkoutSessions.tokenDigest.notNull).toBe(true);
    expect(checkoutSessions.tokenDigest.isUnique).toBe(true);
    expect(columnNames(checkoutSessions)).toContain("completed_at");
    expect(referencedTables(checkoutSessions)).toContain("user");
    expect(referencedTables(checkoutSessions)).toContain("shipping_quotes");
  });

  it("owns shipping quotes and uploads through checkout sessions", () => {
    expect(referencedTables(shippingQuotes)).toContain("checkout_sessions");
    expect(referencedTables(checkoutUploads)).toContain("checkout_sessions");
    expect(referencedTables(checkoutUploads)).toContain("order_items");
    expect(checkoutUploads.claimedByOrderItemId.isUnique).toBe(false);

    const selectedQuoteOwner = config(checkoutSessions).foreignKeys.find(
      (foreignKey) => foreignKey.getName() === "checkout_sessions_selected_quote_owner_fk",
    );
    expect(selectedQuoteOwner?.reference().columns.map((column) => column.name)).toEqual([
      "id",
      "selected_shipping_quote_id",
    ]);
    expect(
      selectedQuoteOwner?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(["checkout_session_id", "id"]);
  });

  it("enforces one order per checkout session and session-scoped idempotency", () => {
    expect(orders.checkoutSessionId.isUnique).toBe(true);
    expect(orders.idempotencyKey.isUnique).toBe(false);
    expect(orders.orderNumber.isUnique).toBe(true);
    expect(config(orders).indexes.map((index) => index.config.name)).toContain(
      "orders_session_idempotency_unique",
    );
    expect(referencedTables(orders)).toEqual(
      expect.arrayContaining(["checkout_sessions", "shipping_quotes", "user"]),
    );
  });

  it("stores immutable shipping provenance on the order", () => {
    expect(columnNames(orders)).toEqual(expect.arrayContaining([
      "shipping_provider",
      "shipping_service_code",
      "shipping_service_name",
      "shipping_provider_reference",
      "shipping_is_test",
      "shipping_request_digest",
    ]));
  });

  it.each([
    [shippingQuotes, [
      "amount_ex_gst_cents",
      "gst_cents",
      "amount_incl_gst_cents",
    ]],
    [orders, [
      "product_subtotal_ex_gst_cents",
      "product_gst_cents",
      "product_total_incl_gst_cents",
      "shipping_ex_gst_cents",
      "shipping_gst_cents",
      "shipping_total_incl_gst_cents",
      "total_ex_gst_cents",
      "total_gst_cents",
      "total_incl_gst_cents",
    ]],
    [orderItems, [
      "unit_subtotal_ex_gst_cents",
      "unit_gst_cents",
      "unit_total_incl_gst_cents",
      "line_subtotal_ex_gst_cents",
      "line_gst_cents",
      "line_total_incl_gst_cents",
    ]],
  ] as const)("stores explicit immutable money in %s", (table, moneyColumns) => {
    const tableConfig = config(table);
    for (const name of moneyColumns) {
      const column = tableConfig.columns.find((candidate) => candidate.name === name);
      expect(column, name).toBeDefined();
      expect(column?.notNull, name).toBe(true);
    }
    expect(tableConfig.checks.length).toBeGreaterThanOrEqual(moneyColumns.length);
  });

  it("keeps item and address snapshots owned by an order", () => {
    expect(referencedTables(orderItems)).toContain("orders");
    expect(referencedTables(orderAddresses)).toContain("orders");
    expect(config(orderItems).indexes.map((index) => index.config.name)).toContain(
      "order_items_order_client_item_unique",
    );
    expect(config(orderAddresses).indexes.map((index) => index.config.name)).toContain(
      "order_addresses_order_kind_unique",
    );
  });
});
