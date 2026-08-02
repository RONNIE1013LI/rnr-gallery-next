import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SupportedCountry } from "@/domain/address/types";
import { orders } from "./orders";

export type PaymentProviderKey = "stripe" | "afterpay" | "zip" | "local-test";
export type PaymentMethodKey = "card" | "afterpay" | "zip";
export type PaymentAttemptStatus =
  | "created"
  | "requires_action"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled";
export type WebhookProcessingResult = "applied" | "ignored" | "failed";

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    provider: text("provider").$type<PaymentProviderKey>().notNull(),
    method: text("method").$type<PaymentMethodKey>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerReference: text("provider_reference"),
    providerSessionLeaseId: uuid("provider_session_lease_id"),
    providerSessionLeaseExpiresAt: timestamp("provider_session_lease_expires_at", {
      withTimezone: true,
    }),
    returnStateDigest: text("return_state_digest"),
    returnStateConsumedAt: timestamp("return_state_consumed_at", {
      withTimezone: true,
    }),
    expectedAmountCents: bigint("expected_amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").$type<"NZD">().notNull(),
    country: text("country").$type<SupportedCountry>().notNull(),
    status: text("status").$type<PaymentAttemptStatus>().notNull(),
    sanitizedFailureCode: text("sanitized_failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("payment_attempts_order_id_idx").on(table.orderId),
    uniqueIndex("payment_attempts_provider_idempotency_unique").on(
      table.provider,
      table.idempotencyKey,
    ),
    uniqueIndex("payment_attempts_provider_reference_unique").on(
      table.provider,
      table.providerReference,
    ),
    uniqueIndex("payment_attempts_one_nonterminal_unique")
      .on(table.orderId)
      .where(
        sql`${table.status} in ('created', 'requires_action', 'processing')`,
      ),
    foreignKey({
      name: "payment_attempts_expected_order_amount_fk",
      columns: [table.orderId, table.expectedAmountCents, table.currency],
      foreignColumns: [orders.id, orders.totalInclGstCents, orders.currency],
    }).onDelete("restrict"),
    check(
      "payment_attempts_expected_amount_positive",
      sql`${table.expectedAmountCents} > 0`,
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").$type<PaymentProviderKey>().notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").references(
      () => paymentAttempts.id,
      { onDelete: "set null" },
    ),
    processingResult: text("processing_result").$type<WebhookProcessingResult>(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("webhook_events_payment_attempt_id_idx").on(table.paymentAttemptId),
    uniqueIndex("webhook_events_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
    check(
      "webhook_events_sha256_format",
      sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
