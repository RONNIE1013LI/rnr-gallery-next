import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
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
import type { NormalizedAddress } from "@/domain/address/types";
import type { RepricedCheckoutCart } from "@/domain/checkout/types";
import type { DeliveryPreference } from "@/domain/configuration/types";
import type { MarketCurrency } from "@/domain/markets/types";
import type { ProviderShippingQuote } from "@/server/shipping/types";
import { user } from "./auth";

export const shippingQuotes = pgTable(
  "shipping_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checkoutSessionId: uuid("checkout_session_id")
      .notNull()
      .references((): AnyPgColumn => checkoutSessions.id, { onDelete: "cascade" }),
    requestDigest: text("request_digest").notNull(),
    provider: text("provider").$type<ProviderShippingQuote["provider"]>().notNull(),
    serviceCode: text("service_code").notNull(),
    serviceName: text("service_name").notNull(),
    currency: text("currency").$type<MarketCurrency>().default("NZD").notNull(),
    amountExGstCents: bigint("amount_ex_gst_cents", { mode: "number" }).notNull(),
    gstCents: bigint("gst_cents", { mode: "number" }).notNull(),
    amountInclGstCents: bigint("amount_incl_gst_cents", { mode: "number" }).notNull(),
    providerReference: text("provider_reference").notNull(),
    rawResponseHash: text("raw_response_hash").notNull(),
    isTest: boolean("is_test").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("shipping_quotes_checkout_session_id_idx").on(table.checkoutSessionId),
    index("shipping_quotes_expires_at_idx").on(table.expiresAt),
    uniqueIndex("shipping_quotes_provider_reference_unique").on(
      table.checkoutSessionId,
      table.provider,
      table.providerReference,
    ),
    unique("shipping_quotes_session_id_id_unique").on(
      table.checkoutSessionId,
      table.id,
    ),
    check("shipping_quotes_amount_ex_gst_nonnegative", sql`${table.amountExGstCents} >= 0`),
    check("shipping_quotes_gst_nonnegative", sql`${table.gstCents} >= 0`),
    check("shipping_quotes_amount_incl_gst_positive", sql`${table.amountInclGstCents} > 0`),
    check(
      "shipping_quotes_amounts_balance",
      sql`${table.amountInclGstCents} = ${table.amountExGstCents} + ${table.gstCents}`,
    ),
    check("shipping_quotes_currency_supported", sql`${table.currency} in ('NZD', 'AUD')`),
  ],
);

export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenDigest: text("token_digest").notNull().unique(),
    customerId: text("customer_id").references(() => user.id, {
      onDelete: "set null",
    }),
    version: integer("version").default(1).notNull(),
    cartDigest: text("cart_digest"),
    cartSnapshot: jsonb("cart_snapshot").$type<RepricedCheckoutCart>(),
    billingAddress: jsonb("billing_address").$type<NormalizedAddress>(),
    deliveryAddress: jsonb("delivery_address").$type<NormalizedAddress>(),
    deliveryMethod: text("delivery_method").$type<DeliveryPreference>(),
    selectedShippingQuoteId: uuid("selected_shipping_quote_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("checkout_sessions_customer_id_idx").on(table.customerId),
    index("checkout_sessions_expires_at_idx").on(table.expiresAt),
    foreignKey({
      name: "checkout_sessions_selected_quote_owner_fk",
      columns: [table.id, table.selectedShippingQuoteId],
      foreignColumns: [shippingQuotes.checkoutSessionId, shippingQuotes.id],
    }),
    check("checkout_sessions_version_positive", sql`${table.version} > 0`),
  ],
);
