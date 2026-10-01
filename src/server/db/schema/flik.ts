import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { paymentAttempts } from "./payments";
import { orders } from "./orders";

// Test sessions have no commerce target: they cannot enter order fulfilment or revenue.
export const flikCheckoutSessions = pgTable("flik_checkout_sessions", {
  id: uuid("id").primaryKey(),
  paymentAttemptId: uuid("payment_attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
  orderId: uuid("order_id"),
  merchantReference: text("merchant_reference").notNull(),
  adminUserId: text("admin_user_id"),
  testMode: boolean("test_mode").notNull(),
  market: text("market").notNull(),
  billingCountry: text("billing_country").notNull(),
  deliveryCountry: text("delivery_country").notNull(),
  currency: text("currency").notNull(),
  expectedAmountCents: bigint("expected_amount_cents", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  returnUrl: text("return_url").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  hostedUrl: text("hosted_url"),
  providerReference: text("provider_reference"),
  providerStatus: text("provider_status").default("created").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  creationLeaseId: uuid("creation_lease_id"),
  creationLeaseExpiresAt: timestamp("creation_lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "flik_checkout_sessions_expected_order_amount_fk",
    columns: [table.orderId, table.expectedAmountCents, table.currency],
    foreignColumns: [orders.id, orders.totalInclGstCents, orders.currency],
  }).onDelete("restrict"),
  uniqueIndex("flik_checkout_sessions_attempt_unique").on(table.paymentAttemptId),
  uniqueIndex("flik_checkout_sessions_provider_reference_unique").on(table.providerReference),
  uniqueIndex("flik_checkout_sessions_idempotency_unique").on(table.idempotencyKey),
  index("flik_checkout_sessions_pending_idx").on(table.updatedAt).where(sql`${table.appliedAt} IS NULL`),
  check("flik_checkout_sessions_target_valid", sql`(${table.testMode} AND ${table.paymentAttemptId} IS NULL AND ${table.orderId} IS NULL AND ${table.adminUserId} IS NOT NULL AND length(trim(${table.adminUserId})) > 0) OR (NOT ${table.testMode} AND ${table.paymentAttemptId} IS NOT NULL AND ${table.orderId} IS NOT NULL AND ${table.id} = ${table.paymentAttemptId} AND ${table.adminUserId} IS NULL)`),
  check("flik_checkout_sessions_nz_only", sql`${table.market} = 'NZ' AND ${table.billingCountry} = 'NZ' AND ${table.deliveryCountry} = 'NZ' AND ${table.currency} = 'NZD'`),
  check("flik_checkout_sessions_amount_valid", sql`${table.expectedAmountCents} BETWEEN 1 AND 1000000`),
  check("flik_checkout_sessions_lease_pair", sql`(${table.creationLeaseId} IS NULL) = (${table.creationLeaseExpiresAt} IS NULL)`),
]);

// Only signed routing identifiers and a body digest are retained, never raw payer data.
export const flikWebhookEvents = pgTable("flik_webhook_events", {
  transactionId: text("transaction_id").primaryKey(),
  payloadSha256: text("payload_sha256").notNull(),
  checkoutSessionId: text("checkout_session_id").notNull(),
  foreignTransactionId: uuid("foreign_transaction_id").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("flik_webhook_events_pending_idx").on(table.updatedAt).where(sql`${table.processedAt} IS NULL`),
  check("flik_webhook_events_sha256_valid", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
]);
