import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SupportedCountry } from "@/domain/address/types";
import type {
  DeliveryPreference,
  Orientation,
  PhotoSubmissionMethod,
} from "@/domain/configuration/types";
import type { PriceLine } from "@/domain/pricing/types";
import type { ProviderShippingQuote } from "@/server/shipping/types";
import { user } from "./auth";
import { checkoutSessions, shippingQuotes } from "./checkout";

export type OrderPaymentStatus =
  | "awaiting_payment"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

export type OrderFulfilmentStatus = "new";
export type OrderAddressKind = "billing" | "delivery";

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    checkoutSessionId: uuid("checkout_session_id")
      .notNull()
      .unique()
      .references(() => checkoutSessions.id, { onDelete: "restrict" }),
    checkoutSessionVersion: integer("checkout_session_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    customerId: text("customer_id").references(() => user.id, {
      onDelete: "set null",
    }),
    customerEmail: text("customer_email").notNull(),
    currency: text("currency").$type<"NZD">().default("NZD").notNull(),
    deliveryMethod: text("delivery_method").$type<DeliveryPreference>().notNull(),
    shippingQuoteId: uuid("shipping_quote_id"),
    shippingProvider: text("shipping_provider")
      .$type<ProviderShippingQuote["provider"]>(),
    shippingServiceCode: text("shipping_service_code").notNull(),
    shippingServiceName: text("shipping_service_name").notNull(),
    shippingProviderReference: text("shipping_provider_reference"),
    shippingIsTest: boolean("shipping_is_test").default(false).notNull(),
    shippingRequestDigest: text("shipping_request_digest"),
    productSubtotalExGstCents: bigint("product_subtotal_ex_gst_cents", {
      mode: "number",
    }).notNull(),
    productGstCents: bigint("product_gst_cents", { mode: "number" }).notNull(),
    productTotalInclGstCents: bigint("product_total_incl_gst_cents", {
      mode: "number",
    }).notNull(),
    shippingExGstCents: bigint("shipping_ex_gst_cents", { mode: "number" }).notNull(),
    shippingGstCents: bigint("shipping_gst_cents", { mode: "number" }).notNull(),
    shippingTotalInclGstCents: bigint("shipping_total_incl_gst_cents", {
      mode: "number",
    }).notNull(),
    totalExGstCents: bigint("total_ex_gst_cents", { mode: "number" }).notNull(),
    totalGstCents: bigint("total_gst_cents", { mode: "number" }).notNull(),
    totalInclGstCents: bigint("total_incl_gst_cents", { mode: "number" }).notNull(),
    paymentStatus: text("payment_status")
      .$type<OrderPaymentStatus>()
      .default("awaiting_payment")
      .notNull(),
    fulfilmentStatus: text("fulfilment_status")
      .$type<OrderFulfilmentStatus>()
      .default("new")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("orders_customer_id_idx").on(table.customerId),
    index("orders_created_at_idx").on(table.createdAt),
    uniqueIndex("orders_session_idempotency_unique").on(
      table.checkoutSessionId,
      table.idempotencyKey,
    ),
    unique("orders_checkout_session_id_id_unique").on(
      table.checkoutSessionId,
      table.id,
    ),
    unique("orders_id_total_incl_gst_currency_unique").on(
      table.id,
      table.totalInclGstCents,
      table.currency,
    ),
    foreignKey({
      name: "orders_shipping_quote_owner_fk",
      columns: [table.checkoutSessionId, table.shippingQuoteId],
      foreignColumns: [shippingQuotes.checkoutSessionId, shippingQuotes.id],
    }).onDelete("restrict"),
    check("orders_checkout_version_positive", sql`${table.checkoutSessionVersion} > 0`),
    check("orders_product_subtotal_nonnegative", sql`${table.productSubtotalExGstCents} >= 0`),
    check("orders_product_gst_nonnegative", sql`${table.productGstCents} >= 0`),
    check("orders_product_total_nonnegative", sql`${table.productTotalInclGstCents} >= 0`),
    check("orders_shipping_ex_gst_nonnegative", sql`${table.shippingExGstCents} >= 0`),
    check("orders_shipping_gst_nonnegative", sql`${table.shippingGstCents} >= 0`),
    check("orders_shipping_total_nonnegative", sql`${table.shippingTotalInclGstCents} >= 0`),
    check("orders_total_ex_gst_nonnegative", sql`${table.totalExGstCents} >= 0`),
    check("orders_total_gst_nonnegative", sql`${table.totalGstCents} >= 0`),
    check("orders_total_incl_gst_nonnegative", sql`${table.totalInclGstCents} >= 0`),
    check(
      "orders_product_amounts_balance",
      sql`${table.productTotalInclGstCents} = ${table.productSubtotalExGstCents} + ${table.productGstCents}`,
    ),
    check(
      "orders_shipping_amounts_balance",
      sql`${table.shippingTotalInclGstCents} = ${table.shippingExGstCents} + ${table.shippingGstCents}`,
    ),
    check(
      "orders_total_ex_gst_balance",
      sql`${table.totalExGstCents} = ${table.productSubtotalExGstCents} + ${table.shippingExGstCents}`,
    ),
    check(
      "orders_total_gst_balance",
      sql`${table.totalGstCents} = ${table.productGstCents} + ${table.shippingGstCents}`,
    ),
    check(
      "orders_total_incl_gst_balance",
      sql`${table.totalInclGstCents} = ${table.totalExGstCents} + ${table.totalGstCents}`,
    ),
    check("orders_currency_nzd", sql`${table.currency} = 'NZD'`),
    check(
      "orders_shipping_selection_valid",
      sql`(
        ${table.deliveryMethod} = 'pickup'
        AND ${table.shippingQuoteId} IS NULL
        AND ${table.shippingProvider} IS NULL
        AND ${table.shippingServiceCode} = 'pickup'
        AND ${table.shippingServiceName} = 'Pickup'
        AND ${table.shippingProviderReference} IS NULL
        AND ${table.shippingIsTest} = false
        AND ${table.shippingRequestDigest} IS NULL
        AND ${table.shippingExGstCents} = 0
        AND ${table.shippingGstCents} = 0
        AND ${table.shippingTotalInclGstCents} = 0
      ) OR (
        ${table.deliveryMethod} = 'post'
        AND ${table.shippingQuoteId} IS NOT NULL
        AND ${table.shippingProvider} IS NOT NULL
        AND length(${table.shippingServiceCode}) > 0
        AND length(${table.shippingServiceName}) > 0
        AND ${table.shippingProviderReference} IS NOT NULL
        AND ${table.shippingRequestDigest} IS NOT NULL
        AND ${table.shippingTotalInclGstCents} > 0
      )`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checkoutSessionId: uuid("checkout_session_id").notNull(),
    orderId: uuid("order_id").notNull(),
    position: integer("position").notNull(),
    clientItemId: uuid("client_item_id").notNull(),
    productKey: text("product_key").notNull(),
    productSlug: text("product_slug").notNull(),
    productTitle: text("product_title").notNull(),
    galleryDesignId: char("gallery_design_id", { length: 64 }),
    galleryDesignTitle: text("gallery_design_title"),
    galleryDesignContentHash: char("gallery_design_content_hash", { length: 64 }),
    galleryDesignProductSlug: text("gallery_design_product_slug"),
    sizeKey: text("size_key").notNull(),
    sizeLabel: text("size_label").notNull(),
    orientation: text("orientation").$type<Orientation>(),
    peoplePets: integer("people_pets").notNull(),
    photoSubmissionMethod: text("photo_submission_method")
      .$type<PhotoSubmissionMethod>()
      .notNull(),
    designText: text("design_text").notNull(),
    notes: text("notes").notNull(),
    neededDate: text("needed_date").notNull(),
    urgentServiceConfirmed: boolean("urgent_service_confirmed").notNull(),
    urgentWorkingDays: integer("urgent_working_days").notNull(),
    quantity: integer("quantity").notNull(),
    priceLines: jsonb("price_lines").$type<readonly PriceLine[]>().notNull(),
    uploadReferences: jsonb("upload_references").$type<readonly string[]>().notNull(),
    unitSubtotalExGstCents: bigint("unit_subtotal_ex_gst_cents", {
      mode: "number",
    }).notNull(),
    unitGstCents: bigint("unit_gst_cents", { mode: "number" }).notNull(),
    unitTotalInclGstCents: bigint("unit_total_incl_gst_cents", {
      mode: "number",
    }).notNull(),
    lineSubtotalExGstCents: bigint("line_subtotal_ex_gst_cents", {
      mode: "number",
    }).notNull(),
    lineGstCents: bigint("line_gst_cents", { mode: "number" }).notNull(),
    lineTotalInclGstCents: bigint("line_total_incl_gst_cents", {
      mode: "number",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_items_order_position_unique").on(table.orderId, table.position),
    uniqueIndex("order_items_order_client_item_unique").on(
      table.orderId,
      table.clientItemId,
    ),
    unique("order_items_checkout_session_id_id_unique").on(
      table.checkoutSessionId,
      table.id,
    ),
    foreignKey({
      name: "order_items_order_owner_fk",
      columns: [table.checkoutSessionId, table.orderId],
      foreignColumns: [orders.checkoutSessionId, orders.id],
    }).onDelete("cascade"),
    check("order_items_position_nonnegative", sql`${table.position} >= 0`),
    check("order_items_people_pets_valid", sql`${table.peoplePets} BETWEEN 0 AND 20`),
    check("order_items_urgent_days_positive", sql`${table.urgentWorkingDays} > 0`),
    check("order_items_quantity_valid", sql`${table.quantity} BETWEEN 1 AND 5`),
    check(
      "order_items_gallery_snapshot_complete",
      sql`(
        ${table.galleryDesignId} is null
        and ${table.galleryDesignTitle} is null
        and ${table.galleryDesignContentHash} is null
        and ${table.galleryDesignProductSlug} is null
      ) or (
        ${table.galleryDesignId} is not null
        and length(trim(${table.galleryDesignTitle})) > 0
        and ${table.galleryDesignContentHash} ~ '^[a-f0-9]{64}$'
        and length(trim(${table.galleryDesignProductSlug})) > 0
      )`,
    ),
    check("order_items_unit_subtotal_nonnegative", sql`${table.unitSubtotalExGstCents} >= 0`),
    check("order_items_unit_gst_nonnegative", sql`${table.unitGstCents} >= 0`),
    check("order_items_unit_total_nonnegative", sql`${table.unitTotalInclGstCents} >= 0`),
    check("order_items_line_subtotal_nonnegative", sql`${table.lineSubtotalExGstCents} >= 0`),
    check("order_items_line_gst_nonnegative", sql`${table.lineGstCents} >= 0`),
    check("order_items_line_total_nonnegative", sql`${table.lineTotalInclGstCents} >= 0`),
    check(
      "order_items_unit_amounts_balance",
      sql`${table.unitTotalInclGstCents} = ${table.unitSubtotalExGstCents} + ${table.unitGstCents}`,
    ),
    check(
      "order_items_line_subtotal_matches_quantity",
      sql`${table.lineSubtotalExGstCents} = ${table.unitSubtotalExGstCents} * ${table.quantity}`,
    ),
    check(
      "order_items_line_gst_matches_quantity",
      sql`${table.lineGstCents} = ${table.unitGstCents} * ${table.quantity}`,
    ),
    check(
      "order_items_line_total_matches_quantity",
      sql`${table.lineTotalInclGstCents} = ${table.unitTotalInclGstCents} * ${table.quantity}`,
    ),
  ],
);

export const orderAddresses = pgTable(
  "order_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: text("kind").$type<OrderAddressKind>().notNull(),
    country: text("country").$type<SupportedCountry>().notNull(),
    fullName: text("full_name").notNull(),
    building: text("building").notNull(),
    street: text("street").notNull(),
    suburb: text("suburb").notNull(),
    region: text("region").notNull(),
    postcode: text("postcode").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("order_addresses_order_kind_unique").on(table.orderId, table.kind),
    check("order_addresses_kind_valid", sql`${table.kind} IN ('billing', 'delivery')`),
    check("order_addresses_country_valid", sql`${table.country} IN ('NZ', 'AU')`),
  ],
);
