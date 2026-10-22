import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { paymentAttempts } from "./payments";

// Schema declarations only. Formal migrations remain frozen; these tables are not provisioned by this change.
export const wisePayIdIntents = pgTable("wise_payid_intents", {
  id: uuid("id").primaryKey().references(() => paymentAttempts.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  profileId: bigint("profile_id", { mode: "number" }).notNull(),
  balanceId: bigint("balance_id", { mode: "number" }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: text("currency").default("AUD").notNull(),
  merchantReference: text("merchant_reference").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("wise_payid_intents_aud", sql`${t.currency} = 'AUD' AND ${t.amountCents} > 0`),
  check("wise_payid_intents_reference", sql`${t.reference} ~ '^RRA[0-9A-F]{16}$'`), index("wise_payid_intents_order_idx").on(t.orderId)]);

export const wisePayIdReceipts = pgTable("wise_payid_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  profileId: bigint("profile_id", { mode: "number" }).notNull(),
  balanceId: bigint("balance_id", { mode: "number" }).notNull(),
  transactionId: text("transaction_id").notNull(),
  digest: text("digest").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }),
  currency: text("currency").notNull(),
  reference: text("reference"),
  payerName: text("payer_name"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  eligible: boolean("eligible").notNull(),
  // Immutable reservation: a receipt cannot be consumed by a second order.
  intentId: uuid("intent_id").references(() => wisePayIdIntents.id, { onDelete: "restrict" }),
  status: text("status").$type<"unmatched" | "review" | "reserved" | "applied" | "ignored">().default("unmatched").notNull(),
  reason: text("reason"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("wise_payid_receipts_transaction_unique").on(t.profileId, t.balanceId, t.transactionId),
  uniqueIndex("wise_payid_receipts_intent_unique").on(t.intentId).where(sql`${t.intentId} IS NOT NULL`),
  index("wise_payid_receipts_review_idx").on(t.status, t.createdAt),
  index("wise_payid_receipts_reference_idx").on(t.profileId, t.balanceId, t.reference),
  check("wise_payid_receipts_status", sql`${t.status} in ('unmatched','review','reserved','applied','ignored')`),
  check("wise_payid_receipts_binding", sql`(${t.status} in ('reserved','applied') AND ${t.intentId} IS NOT NULL) OR ${t.status} = 'review' OR (${t.status} in ('unmatched','ignored') AND ${t.intentId} IS NULL)`),
  check("wise_payid_receipts_applied", sql`(${t.status} = 'applied') = (${t.appliedAt} IS NOT NULL)`)]);

export const wisePayIdAudit = pgTable("wise_payid_audit", {
  id: uuid("id").defaultRandom().primaryKey(), receiptId: uuid("receipt_id").references(() => wisePayIdReceipts.id, { onDelete: "restrict" }),
  intentId: uuid("intent_id").references(() => wisePayIdIntents.id, { onDelete: "restrict" }),
  actorId: text("actor_id").notNull(), action: text("action").notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const wisePayIdPollState = pgTable("wise_payid_poll_state", {
  key: text("key").primaryKey(), lastStartedAt: timestamp("last_started_at", { withTimezone: true }).notNull(),
  successfulAt: timestamp("successful_at", { withTimezone: true }), consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
});
