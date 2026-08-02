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
  it("stores only a unique opaque checkout token digest", () => {
    expect(columnNames(checkoutSessions)).toContain("token_digest");
    expect(columnNames(checkoutSessions)).not.toContain("token");
    expect(checkoutSessions.tokenDigest.notNull).toBe(true);
    expect(checkoutSessions.tokenDigest.isUnique).toBe(true);
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

  it("enforces one order per checkout session and globally unique idempotency", () => {
    expect(orders.checkoutSessionId.isUnique).toBe(true);
    expect(orders.idempotencyKey.isUnique).toBe(true);
    expect(orders.orderNumber.isUnique).toBe(true);
    expect(referencedTables(orders)).toEqual(
      expect.arrayContaining(["checkout_sessions", "shipping_quotes", "user"]),
    );
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
