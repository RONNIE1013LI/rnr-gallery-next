import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SupportedCountry } from "@/domain/address/types";
import type { MarketCurrency } from "@/domain/markets/types";
import { user } from "./auth";
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
export type PaymentRequestKind = "order_balance" | "standalone";
export type PaymentRequestStatus =
  | "pending"
  | "paid"
  | "expired"
  | "cancelled"
  | "invalidated";
export type PaymentLedgerEntryType =
  | "online_payment"
  | "bank_transfer"
  | "reversal"
  | "legacy_backfill"
  | "refund";
export type PaymentLedgerDirection = "credit" | "debit";
export type PaymentPayerSnapshot = Readonly<{
  fullName: string;
  email: string;
  phone: string;
  address?: Readonly<{
    country: SupportedCountry;
    building: string;
    street: string;
    suburb: string;
    region: string;
    postcode: string;
  }>;
}>;

export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestNumber: text("request_number").notNull().unique(),
    publicTokenDigest: text("public_token_digest").notNull().unique(),
    tokenRotatedAt: timestamp("token_rotated_at", { withTimezone: true }),
    kind: text("kind").$type<PaymentRequestKind>().notNull(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    description: text("description").notNull(),
    currency: text("currency").$type<MarketCurrency>().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    enabledPaymentMethods: jsonb("enabled_payment_methods")
      .$type<readonly PaymentMethodKey[]>()
      .notNull(),
    status: text("status").$type<PaymentRequestStatus>().default("pending").notNull(),
    statusReason: text("status_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    internalNote: text("internal_note"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    cancelledBy: text("cancelled_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("payment_requests_order_id_idx").on(table.orderId),
    index("payment_requests_status_idx").on(table.status),
    unique("payment_requests_expected_amount_unique").on(
      table.id,
      table.amountCents,
      table.currency,
    ),
    check(
      "payment_requests_target_matches_kind",
      sql`(
        (${table.kind} = 'order_balance' AND ${table.orderId} IS NOT NULL)
        OR (${table.kind} = 'standalone' AND ${table.orderId} IS NULL)
      )`,
    ),
    check("payment_requests_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "payment_requests_currency_valid",
      sql`${table.currency} in ('NZD', 'AUD')`,
    ),
    check(
      "payment_requests_status_valid",
      sql`${table.status} in ('pending', 'paid', 'expired', 'cancelled', 'invalidated')`,
    ),
    check(
      "payment_requests_token_digest_format",
      sql`${table.publicTokenDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "payment_requests_methods_valid",
      sql`jsonb_typeof(${table.enabledPaymentMethods}) = 'array'
        AND jsonb_array_length(${table.enabledPaymentMethods}) > 0
        AND ${table.enabledPaymentMethods} <@ '["card", "afterpay", "zip"]'::jsonb`,
    ),
    check(
      "payment_requests_terminal_timestamps_valid",
      sql`(
        (${table.status} = 'paid' AND ${table.paidAt} IS NOT NULL)
        OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL)
        OR (${table.status} = 'invalidated' AND ${table.invalidatedAt} IS NOT NULL)
        OR (${table.status} in ('pending', 'expired'))
      )`,
    ),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id"),
    paymentRequestId: uuid("payment_request_id"),
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
    currency: text("currency").$type<MarketCurrency>().notNull(),
    country: text("country").$type<SupportedCountry>().notNull(),
    payerSnapshot: jsonb("payer_snapshot").$type<PaymentPayerSnapshot>(),
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
    index("payment_attempts_payment_request_id_idx").on(table.paymentRequestId),
    uniqueIndex("payment_attempts_provider_idempotency_unique").on(
      table.provider,
      table.idempotencyKey,
    ),
    uniqueIndex("payment_attempts_provider_reference_unique").on(
      table.provider,
      table.providerReference,
    ),
    uniqueIndex("payment_attempts_provider_return_state_digest_unique")
      .on(table.provider, table.returnStateDigest)
      .where(sql`${table.returnStateDigest} IS NOT NULL`),
    uniqueIndex("payment_attempts_one_nonterminal_order_unique")
      .on(table.orderId)
      .where(
        sql`${table.orderId} IS NOT NULL AND ${table.status} in ('created', 'requires_action', 'processing')`,
      ),
    uniqueIndex("payment_attempts_one_nonterminal_request_unique")
      .on(table.paymentRequestId)
      .where(
        sql`${table.paymentRequestId} IS NOT NULL AND ${table.status} in ('created', 'requires_action', 'processing')`,
      ),
    foreignKey({
      name: "payment_attempts_expected_order_amount_fk",
      columns: [table.orderId, table.expectedAmountCents, table.currency],
      foreignColumns: [orders.id, orders.totalInclGstCents, orders.currency],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_attempts_expected_payment_request_amount_fk",
      columns: [table.paymentRequestId, table.expectedAmountCents, table.currency],
      foreignColumns: [
        paymentRequests.id,
        paymentRequests.amountCents,
        paymentRequests.currency,
      ],
    }).onDelete("restrict"),
    check(
      "payment_attempts_exactly_one_target",
      sql`num_nonnulls(${table.orderId}, ${table.paymentRequestId}) = 1`,
    ),
    check(
      "payment_attempts_expected_amount_positive",
      sql`${table.expectedAmountCents} > 0`,
    ),
    check(
      "payment_attempts_provider_valid",
      sql`${table.provider} in ('stripe', 'afterpay', 'zip', 'local-test')`,
    ),
    check(
      "payment_attempts_method_valid",
      sql`${table.method} in ('card', 'afterpay', 'zip')`,
    ),
    check(
      "payment_attempts_provider_method_valid",
      sql`(
        ${table.provider} NOT in ('stripe', 'afterpay', 'zip', 'local-test')
        OR ${table.method} NOT in ('card', 'afterpay', 'zip')
        OR (${table.provider} = 'stripe' AND ${table.method} = 'card')
        OR (${table.provider} = 'afterpay' AND ${table.method} = 'afterpay')
        OR (${table.provider} = 'zip' AND ${table.method} = 'zip')
        OR (${table.provider} = 'local-test' AND ${table.method} in ('card', 'afterpay', 'zip'))
      )`,
    ),
    check(
      "payment_attempts_country_valid",
      sql`${table.country} in ('NZ', 'AU')`,
    ),
    check(
      "payment_attempts_currency_valid",
      sql`${table.currency} in ('NZD', 'AUD')`,
    ),
    check(
      "payment_attempts_status_valid",
      sql`${table.status} in ('created', 'requires_action', 'processing', 'paid', 'failed', 'cancelled')`,
    ),
    check(
      "payment_attempts_lease_pair_valid",
      sql`(
        (${table.providerSessionLeaseId} IS NULL AND ${table.providerSessionLeaseExpiresAt} IS NULL)
        OR (${table.providerSessionLeaseId} IS NOT NULL AND ${table.providerSessionLeaseExpiresAt} IS NOT NULL)
      )`,
    ),
    check(
      "payment_attempts_return_state_digest_format",
      sql`${table.returnStateDigest} IS NULL OR ${table.returnStateDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "payment_attempts_return_state_consumption_valid",
      sql`${table.returnStateConsumedAt} IS NULL OR ${table.returnStateDigest} IS NOT NULL`,
    ),
  ],
);

export const paymentLedgerEntries = pgTable(
  "payment_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    paymentRequestId: uuid("payment_request_id").references(
      () => paymentRequests.id,
      { onDelete: "restrict" },
    ),
    paymentAttemptId: uuid("payment_attempt_id").references(
      () => paymentAttempts.id,
      { onDelete: "restrict" },
    ),
    entryType: text("entry_type").$type<PaymentLedgerEntryType>().notNull(),
    direction: text("direction").$type<PaymentLedgerDirection>().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").$type<MarketCurrency>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    reference: text("reference"),
    payerName: text("payer_name"),
    note: text("note"),
    reversesEntryId: uuid("reverses_entry_id"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("payment_ledger_entries_order_id_idx").on(table.orderId),
    index("payment_ledger_entries_payment_request_id_idx").on(
      table.paymentRequestId,
    ),
    uniqueIndex("payment_ledger_entries_payment_attempt_unique")
      .on(table.paymentAttemptId)
      .where(sql`${table.paymentAttemptId} IS NOT NULL`),
    uniqueIndex("payment_ledger_entries_reversal_unique")
      .on(table.reversesEntryId)
      .where(sql`${table.reversesEntryId} IS NOT NULL`),
    foreignKey({
      name: "payment_ledger_entries_reverses_entry_fk",
      columns: [table.reversesEntryId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    check(
      "payment_ledger_entries_target_valid",
      sql`num_nonnulls(${table.orderId}, ${table.paymentRequestId}) >= 1`,
    ),
    check(
      "payment_ledger_entries_amount_positive",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "payment_ledger_entries_currency_valid",
      sql`${table.currency} in ('NZD', 'AUD')`,
    ),
    check(
      "payment_ledger_entries_type_valid",
      sql`${table.entryType} in ('online_payment', 'bank_transfer', 'reversal', 'legacy_backfill', 'refund')`,
    ),
    check(
      "payment_ledger_entries_direction_valid",
      sql`(
        (${table.entryType} in ('online_payment', 'bank_transfer', 'legacy_backfill') AND ${table.direction} = 'credit')
        OR (${table.entryType} in ('reversal', 'refund') AND ${table.direction} = 'debit')
      )`,
    ),
    check(
      "payment_ledger_entries_reversal_link_valid",
      sql`(
        (${table.entryType} = 'reversal' AND ${table.reversesEntryId} IS NOT NULL)
        OR (${table.entryType} <> 'reversal' AND ${table.reversesEntryId} IS NULL)
      )`,
    ),
    check(
      "payment_ledger_entries_online_attempt_valid",
      sql`(
        (${table.entryType} = 'online_payment' AND ${table.paymentAttemptId} IS NOT NULL)
        OR (${table.entryType} <> 'online_payment')
      )`,
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
    check(
      "webhook_events_provider_valid",
      sql`${table.provider} in ('stripe', 'afterpay', 'zip', 'local-test')`,
    ),
    check(
      "webhook_events_processing_result_valid",
      sql`${table.processingResult} IS NULL OR ${table.processingResult} in ('applied', 'ignored', 'failed')`,
    ),
    check(
      "webhook_events_processing_pair_valid",
      sql`(
        (${table.processingResult} IS NULL AND ${table.processedAt} IS NULL)
        OR (${table.processingResult} IS NOT NULL AND ${table.processedAt} IS NOT NULL)
      )`,
    ),
  ],
);
