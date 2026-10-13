import type { SupplyPurchaseSnapshot } from "@/domain/checkout/types";
import type { PriceLine } from "@/domain/pricing/types";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { suppliesProducts, suppliesVariants } from "./supplies";
import { paymentAttempts } from "./payments";
import { orders } from "./orders";

/** Independent Supplies inventory and immutable order snapshots. */
export const suppliesStockReservations = pgTable("supplies_stock_reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  selectionKey: text("selection_key").notNull(),
  productId: uuid("product_id").notNull().references(() => suppliesProducts.id, { onDelete: "restrict" }),
  variantId: uuid("variant_id").references(() => suppliesVariants.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  tracked: boolean("tracked").notNull(),
  status: text("status").$type<"reserved" | "consumed" | "released" | "restocked">().notNull(),
  stockShortage: boolean("stock_shortage").default(false).notNull(),
  reservedForPaymentAttemptId: uuid("reserved_for_payment_attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).default(sql`now() + interval '30 minutes'`).notNull(),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("supplies_reservation_order_selection_unique").on(table.orderId, table.selectionKey),
  index("supplies_reservation_product_idx").on(table.productId),
  index("supplies_reservation_expiry_idx").on(table.expiresAt, table.orderId).where(sql`${table.status} = 'reserved'`),
  check("supplies_reservation_quantity_positive", sql`${table.quantity} > 0`),
  check("supplies_reservation_status_valid", sql`${table.status} in ('reserved', 'consumed', 'released', 'restocked')`),
]);

export const suppliesOrderItems = pgTable("supplies_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  clientItemId: uuid("client_item_id").notNull(),
  productKey: text("product_key").notNull(),
  productSlug: text("product_slug").notNull(),
  productTitle: text("product_title").notNull(),
  sizeKey: text("size_key").notNull(),
  sizeLabel: text("size_label").notNull(),
  supplySnapshot: jsonb("supply_snapshot").$type<SupplyPurchaseSnapshot>().notNull(),
  quantity: integer("quantity").notNull(),
  priceLines: jsonb("price_lines").$type<readonly PriceLine[]>().notNull(),
  unitSubtotalExGstCents: bigint("unit_subtotal_ex_gst_cents", { mode: "number" }).notNull(),
  unitGstCents: bigint("unit_gst_cents", { mode: "number" }).notNull(),
  unitTotalInclGstCents: bigint("unit_total_incl_gst_cents", { mode: "number" }).notNull(),
  lineSubtotalExGstCents: bigint("line_subtotal_ex_gst_cents", { mode: "number" }).notNull(),
  lineGstCents: bigint("line_gst_cents", { mode: "number" }).notNull(),
  lineTotalInclGstCents: bigint("line_total_incl_gst_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("supplies_order_item_order_position_unique").on(table.orderId, table.position),
  uniqueIndex("supplies_order_item_order_client_unique").on(table.orderId, table.clientItemId),
  check("supplies_order_item_quantity_valid", sql`${table.quantity} between 1 and 999`),
  check("supplies_order_item_unit_balance", sql`${table.unitSubtotalExGstCents} >= 0 and ${table.unitGstCents} >= 0 and ${table.unitTotalInclGstCents} = ${table.unitSubtotalExGstCents} + ${table.unitGstCents}`),
  check("supplies_order_item_line_balance", sql`${table.lineSubtotalExGstCents} = ${table.unitSubtotalExGstCents} * ${table.quantity} and ${table.lineGstCents} = ${table.unitGstCents} * ${table.quantity} and ${table.lineTotalInclGstCents} = ${table.unitTotalInclGstCents} * ${table.quantity}`),
]);
