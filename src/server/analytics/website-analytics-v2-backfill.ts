import { and, asc, eq, gt, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { WebsiteAnalyticsCurrency } from "@/domain/analytics/website-analytics-v2";
import type { getDatabase } from "@/server/db/client";
import {
  adminAuditLogs,
  customerServiceConversations,
  customerServiceMessages,
  orders,
  paymentAttempts,
  paymentLedgerEntries,
  productionJobs,
  websiteAnalyticsConversions,
  websiteAnalyticsFinancialEvents,
  websiteAnalyticsReconciliationState,
} from "@/server/db/schema";
import type {
  PaymentLedgerDirection,
  PaymentLedgerEntryType,
} from "@/server/db/schema/payments";
import type { OrderFulfilmentStatus } from "@/server/db/schema/orders";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import type { WebsiteAnalyticsDirectPaymentTransition } from "./website-analytics-v2-business-recorder";
import { eligibleOrder } from "./website-analytics-business-rules";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Repository = Pick<
  ReturnType<typeof createWebsiteAnalyticsV2Repository>,
  "recordOrder" | "recordInquiry" | "recordFinancialEvent"
>;

export const WEBSITE_ANALYTICS_V2_BACKFILL_SOURCES = [
  "website_orders",
  "manual_orders",
  "manual_payment_updates",
  "website_inquiries",
  "ledger_events",
  "direct_payment_paid_transitions",
  "direct_payment_refund_transitions",
] as const;

export type WebsiteAnalyticsV2BackfillSource =
  (typeof WEBSITE_ANALYTICS_V2_BACKFILL_SOURCES)[number];

export type WebsiteAnalyticsV2BackfillCursor = Readonly<{
  occurredAt: string;
  id: string;
}>;

type Counts = Readonly<{
  scanned: number;
  created: number;
  wouldCreate: number;
  unchanged: number;
  skipped: number;
  failed: number;
}>;

export type WebsiteAnalyticsV2BackfillSourceResult = Counts & Readonly<{
  source: WebsiteAnalyticsV2BackfillSource;
  cursor: WebsiteAnalyticsV2BackfillCursor | null;
  complete: boolean;
  busy: boolean;
}>;

export type WebsiteAnalyticsV2BackfillResult = Readonly<{
  dryRun: boolean;
  totals: Counts;
  sources: readonly WebsiteAnalyticsV2BackfillSourceResult[];
  limitations: readonly string[];
}>;

type BackfillInput = Readonly<{
  dryRun: boolean;
  batchSize: number;
  sources?: readonly WebsiteAnalyticsV2BackfillSource[];
  stateKeyPrefix?: string;
  stateType?: "backfill" | "reconciliation";
  fromOccurredAt?: Date;
  historical?: boolean;
  restartCompleted?: boolean;
}>;

type Options = Readonly<{
  repository?: Repository;
  loadDirectTransitions?: (
    attemptId: string,
  ) => Promise<readonly WebsiteAnalyticsDirectPaymentTransition[]>;
}>;

type SourceRow = Readonly<{
  id: string;
  occurredAt: Date;
  value: unknown;
}>;

type SourceState = Readonly<{
  cursorOccurredAt: Date | null;
  cursorId: string | null;
  status: "pending" | "running" | "completed" | "failed";
}>;

type SourceLifecycle = Readonly<{
  shortCircuit: boolean;
  restarting: boolean;
  cursor: Readonly<{ occurredAt: Date; id: string }> | null;
  fromOccurredAt: Date | undefined;
}>;

type PlannedAction =
  | Readonly<{ kind: "order"; input: Parameters<Repository["recordOrder"]>[0] }>
  | Readonly<{ kind: "inquiry"; input: Parameters<Repository["recordInquiry"]>[0] }>
  | Readonly<{
      kind: "financial";
      input: Parameters<Repository["recordFinancialEvent"]>[0];
    }>;

const LIMITATIONS = Object.freeze([
  "Historical direct payment timing is not inferred from mutable payment status or updatedAt.",
  "Historical refund timing or amount is not inferred from mutable refund status or updatedAt.",
  "Historical manual partial-payment timing is unavailable and is not reconstructed.",
  "Manual rows without exact Website Analytics V2 audit evidence are skipped.",
  "Legacy ledger receipts derived from mutable timestamps are skipped.",
]);
const MINIMUM_UUID = "00000000-0000-0000-0000-000000000000";

function emptyCounts(): Counts {
  return { scanned: 0, created: 0, wouldCreate: 0, unchanged: 0, skipped: 0, failed: 0 };
}

function addCounts(left: Counts, right: Counts): Counts {
  return {
    scanned: left.scanned + right.scanned,
    created: left.created + right.created,
    wouldCreate: left.wouldCreate + right.wouldCreate,
    unchanged: left.unchanged + right.unchanged,
    skipped: left.skipped + right.skipped,
    failed: left.failed + right.failed,
  };
}

function safeBatchSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error("Analytics backfill batch size must be between 1 and 500");
  }
  return value;
}

function safeStateKeyPrefix(value: string | undefined): string {
  const prefix = value?.trim() || "website-analytics-v2";
  if (prefix.length > 180 || !/^[a-zA-Z0-9:_-]+$/.test(prefix)) {
    throw new Error("Analytics backfill state key prefix is invalid");
  }
  return prefix;
}

function cursorCondition(
  occurredAt: { _: unknown },
  id: { _: unknown },
  cursor: Readonly<{ occurredAt: Date; id: string }> | null,
) {
  if (!cursor) return undefined;
  return or(
    gt(occurredAt as never, cursor.occurredAt),
    and(eq(occurredAt as never, cursor.occurredAt), gt(id as never, cursor.id)),
  );
}

function asCursor(row: SourceRow | undefined): WebsiteAnalyticsV2BackfillCursor | null {
  return row
    ? Object.freeze({ occurredAt: row.occurredAt.toISOString(), id: row.id })
    : null;
}

function lowerBoundCursor(fromOccurredAt: Date | undefined) {
  return fromOccurredAt ? { occurredAt: fromOccurredAt, id: MINIMUM_UUID } : null;
}

function planSourceLifecycle(state: SourceState | undefined, input: BackfillInput): SourceLifecycle {
  const restarting = state?.status === "completed" && input.restartCompleted === true;
  const savedCursor = state?.cursorOccurredAt && state.cursorId !== null
    ? { occurredAt: state.cursorOccurredAt, id: state.cursorId }
    : null;
  const restartCursor = input.restartCompleted ? lowerBoundCursor(input.fromOccurredAt) : null;
  return Object.freeze({
    shortCircuit: state?.status === "completed" && !input.restartCompleted,
    restarting,
    cursor: restarting ? restartCursor : savedCursor ?? restartCursor,
    fromOccurredAt: state && !restarting ? undefined : input.fromOccurredAt,
  });
}

function ledgerEventType(input: Readonly<{
  entryType: PaymentLedgerEntryType;
  direction: PaymentLedgerDirection;
  paymentRequestId: string | null;
  paymentAttemptId: string | null;
  idempotencyKey: string | null;
  reversesEntryId: string | null;
}>): "receipt" | "refund" | "reversal" | null {
  if (input.entryType === "online_payment" && input.direction === "credit"
    && input.paymentAttemptId
    && (input.paymentRequestId !== null
      || input.idempotencyKey === `direct-payment-receipt:${input.paymentAttemptId}`)) {
    return "receipt";
  }
  if (input.entryType === "bank_transfer" && input.direction === "credit"
    && input.idempotencyKey) return "receipt";
  if (input.entryType === "refund" && input.direction === "debit"
    && input.idempotencyKey) return "refund";
  if (input.entryType === "reversal" && input.direction === "debit"
    && input.reversesEntryId) return "reversal";
  return null;
}

type ManualOrderEvidence = Readonly<{
  jobId: string;
  occurredAt: Date;
  amountPayableCents: number;
  amountPaidCents: number;
  initialStatus: OrderFulfilmentStatus;
  currency: WebsiteAnalyticsCurrency;
}>;

type ManualPaymentEvidence = Readonly<{
  jobId: string;
  idempotencyKey: string;
  occurredAt: Date;
  deltaCents: number;
  currency: WebsiteAnalyticsCurrency;
}>;

function auditObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactAuditDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function auditCurrency(value: unknown): WebsiteAnalyticsCurrency | null {
  return value === "NZD" || value === "AUD" ? value : null;
}

function manualOrderEvidence(value: unknown): ManualOrderEvidence | null {
  const row = auditObject(value);
  const evidence = auditObject(auditObject(row?.afterSummary)?.websiteAnalyticsV2);
  const occurredAt = exactAuditDate(evidence?.occurredAt);
  const currency = auditCurrency(evidence?.currency);
  if (typeof row?.jobId !== "string" || evidence?.version !== 1
    || evidence.event !== "manual_order_created" || !occurredAt || !currency
    || !Number.isSafeInteger(evidence.amountPayableCents)
    || !Number.isSafeInteger(evidence.amountPaidBeforeCents)
    || !Number.isSafeInteger(evidence.amountPaidAfterCents)
    || evidence.amountPaidBeforeCents !== 0
    || typeof evidence.initialStatus !== "string") return null;
  return Object.freeze({
    jobId: row.jobId,
    occurredAt,
    amountPayableCents: evidence.amountPayableCents as number,
    amountPaidCents: evidence.amountPaidAfterCents as number,
    initialStatus: evidence.initialStatus as OrderFulfilmentStatus,
    currency,
  });
}

function manualPaymentEvidence(value: unknown): ManualPaymentEvidence | null {
  const row = auditObject(value);
  const evidence = auditObject(auditObject(row?.afterSummary)?.websiteAnalyticsV2);
  const occurredAt = exactAuditDate(evidence?.occurredAt);
  const currency = auditCurrency(evidence?.currency);
  if (typeof row?.jobId !== "string" || typeof row.idempotencyKey !== "string"
    || evidence?.version !== 1 || evidence.event !== "manual_payment_increased"
    || !occurredAt || !currency || !Number.isSafeInteger(evidence.amountPaidBeforeCents)
    || !Number.isSafeInteger(evidence.amountPaidAfterCents)
    || !Number.isSafeInteger(evidence.deltaCents)
    || (evidence.amountPaidAfterCents as number) - (evidence.amountPaidBeforeCents as number)
      !== evidence.deltaCents
    || (evidence.deltaCents as number) <= 0) return null;
  return Object.freeze({
    jobId: row.jobId,
    idempotencyKey: row.idempotencyKey,
    occurredAt,
    deltaCents: evidence.deltaCents as number,
    currency,
  });
}

export function createWebsiteAnalyticsV2Backfill(database: Database, options: Options = {}) {
  const repository = options.repository ?? createWebsiteAnalyticsV2Repository(database);
  const paymentRepository = options.loadDirectTransitions
    ? null
    : createDrizzlePaymentRepository(database, {
        websiteAnalyticsV2Enabled: true,
        analyticsRecorder: { recordDirectPaymentTransition: async () => undefined },
      });
  const loadDirectTransitions = options.loadDirectTransitions
    ?? ((attemptId: string) => paymentRepository!
      .loadWebsiteAnalyticsDirectPaymentTransitions(attemptId));

  async function loadRows(
    executor: Database | Transaction,
    source: WebsiteAnalyticsV2BackfillSource,
    cursor: Readonly<{ occurredAt: Date; id: string }> | null,
    fromOccurredAt: Date | undefined,
    limit: number,
  ): Promise<readonly SourceRow[]> {
    if (source === "website_orders") {
      const rows = await executor.select({
        id: orders.id,
        occurredAt: orders.createdAt,
        market: orders.market,
        currency: orders.currency,
        amountCents: orders.totalInclGstCents,
      }).from(orders).innerJoin(
        productionJobs,
        and(eq(productionJobs.orderId, orders.id), eq(productionJobs.source, "web")),
      ).where(and(
        fromOccurredAt ? gte(orders.createdAt, fromOccurredAt) : undefined,
        cursorCondition(orders.createdAt, orders.id, cursor),
      )).orderBy(asc(orders.createdAt), asc(orders.id)).limit(limit);
      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        value: row,
      }));
    }
    if (source === "website_inquiries") {
      const rows = await executor.select({
        id: customerServiceConversations.id,
        occurredAt: customerServiceConversations.createdAt,
      }).from(customerServiceConversations).where(and(
        eq(customerServiceConversations.channel, "website"),
        sql`exists (
          select 1 from ${customerServiceMessages}
          where ${customerServiceMessages.conversationId} = ${customerServiceConversations.id}
            and ${customerServiceMessages.channel} = 'website'
        )`,
        fromOccurredAt ? gte(customerServiceConversations.createdAt, fromOccurredAt) : undefined,
        cursorCondition(customerServiceConversations.createdAt, customerServiceConversations.id, cursor),
      )).orderBy(
        asc(customerServiceConversations.createdAt),
        asc(customerServiceConversations.id),
      ).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    if (source === "manual_orders") {
      const rows = await executor.select({
        id: productionJobs.id,
        occurredAt: productionJobs.createdAt,
        jobId: productionJobs.id,
        afterSummary: adminAuditLogs.afterSummary,
      }).from(productionJobs).leftJoin(
        adminAuditLogs,
        and(
          eq(adminAuditLogs.resourceType, "production_job"),
          eq(adminAuditLogs.resourceId, sql`${productionJobs.id}::text`),
          eq(adminAuditLogs.action, "production_job.created"),
          eq(adminAuditLogs.result, "success"),
          sql`${adminAuditLogs.afterSummary} #>> '{websiteAnalyticsV2,event}'
            = 'manual_order_created'`,
        ),
      ).where(and(
        eq(productionJobs.source, "manual"),
        fromOccurredAt ? gte(productionJobs.createdAt, fromOccurredAt) : undefined,
        cursorCondition(productionJobs.createdAt, productionJobs.id, cursor),
      )).orderBy(asc(productionJobs.createdAt), asc(productionJobs.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    if (source === "manual_payment_updates") {
      const occurredAt = sql<Date>`(${adminAuditLogs.afterSummary}
        #>> '{websiteAnalyticsV2,occurredAt}')::timestamptz`
        .mapWith(adminAuditLogs.createdAt);
      const rows = await executor.select({
        id: adminAuditLogs.id,
        occurredAt,
        jobId: productionJobs.id,
        idempotencyKey: adminAuditLogs.idempotencyKey,
        afterSummary: adminAuditLogs.afterSummary,
      }).from(adminAuditLogs).innerJoin(
        productionJobs,
        eq(adminAuditLogs.resourceId, sql`${productionJobs.id}::text`),
      ).where(and(
        eq(adminAuditLogs.resourceType, "production_job"),
        eq(adminAuditLogs.action, "production_job.updated"),
        eq(adminAuditLogs.result, "success"),
        sql`${adminAuditLogs.afterSummary} #>> '{websiteAnalyticsV2,event}'
          = 'manual_payment_increased'`,
        fromOccurredAt ? gte(occurredAt, fromOccurredAt) : undefined,
        cursorCondition(occurredAt, adminAuditLogs.id, cursor),
      )).orderBy(asc(occurredAt), asc(adminAuditLogs.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    if (source === "ledger_events") {
      const rows = await executor.select({
        id: paymentLedgerEntries.id,
        occurredAt: paymentLedgerEntries.receivedAt,
        orderId: paymentLedgerEntries.orderId,
        paymentRequestId: paymentLedgerEntries.paymentRequestId,
        paymentAttemptId: paymentLedgerEntries.paymentAttemptId,
        entryType: paymentLedgerEntries.entryType,
        direction: paymentLedgerEntries.direction,
        amountCents: paymentLedgerEntries.amountCents,
        currency: paymentLedgerEntries.currency,
        idempotencyKey: paymentLedgerEntries.idempotencyKey,
        reversesEntryId: paymentLedgerEntries.reversesEntryId,
      }).from(paymentLedgerEntries).where(and(
        fromOccurredAt ? gte(paymentLedgerEntries.receivedAt, fromOccurredAt) : undefined,
        cursorCondition(paymentLedgerEntries.receivedAt, paymentLedgerEntries.id, cursor),
      )).orderBy(asc(paymentLedgerEntries.receivedAt), asc(paymentLedgerEntries.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    if (source === "direct_payment_paid_transitions"
      || source === "direct_payment_refund_transitions") {
      const occurredAt = source === "direct_payment_paid_transitions"
        ? paymentAttempts.websiteAnalyticsPaidAt
        : paymentAttempts.websiteAnalyticsRefundedAt;
      const rows = await executor.select({
        id: paymentAttempts.id,
        occurredAt,
      }).from(paymentAttempts).where(and(
        isNull(paymentAttempts.paymentRequestId),
        isNotNull(occurredAt),
        sql`not exists (
          select 1 from ${paymentLedgerEntries} as direct_ledger
          where direct_ledger.payment_attempt_id = ${paymentAttempts.id}
            and direct_ledger.payment_request_id is null
            and direct_ledger.order_id = ${paymentAttempts.orderId}
            and direct_ledger.entry_type = 'online_payment'
            and direct_ledger.direction = 'credit'
            and direct_ledger.amount_cents = ${paymentAttempts.expectedAmountCents}
            and direct_ledger.currency = ${paymentAttempts.currency}
            and direct_ledger.idempotency_key
              = 'direct-payment-receipt:' || ${paymentAttempts.id}::text
        )`,
        fromOccurredAt ? gte(occurredAt, fromOccurredAt) : undefined,
        cursor ? or(
          gt(occurredAt, cursor.occurredAt),
          and(eq(occurredAt, cursor.occurredAt), gt(paymentAttempts.id, cursor.id)),
        ) : undefined,
      )).orderBy(asc(occurredAt), asc(paymentAttempts.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt!, value: row }));
    }
    throw new Error("Unknown analytics backfill source");
  }

  async function planRow(
    source: WebsiteAnalyticsV2BackfillSource,
    row: SourceRow,
    historical: boolean,
  ): Promise<readonly PlannedAction[]> {
    if (source === "website_orders") {
      const value = row.value as Readonly<{
        id: string;
        occurredAt: Date;
        market: "NZ" | "AU";
        currency: WebsiteAnalyticsCurrency;
        amountCents: number;
      }>;
      if (!eligibleOrder({
        source: "website",
        checkoutCommitted: true,
        totalInclGstCents: value.amountCents,
      })) return [];
      return [{
        kind: "order",
        input: {
          source: "website",
          sourceId: value.id,
          orderId: value.id,
          occurredAt: value.occurredAt,
          market: value.market,
          currency: value.currency,
          orderedAmountInclGstCents: value.amountCents,
          consentLinked: false,
          historical,
        },
      }];
    }
    if (source === "website_inquiries") return [{
      kind: "inquiry",
      input: {
        sourceId: row.id,
        conversationId: row.id,
        occurredAt: row.occurredAt,
        consentLinked: false,
        historical,
      },
    }];
    if (source === "manual_orders") {
      const evidence = manualOrderEvidence(row.value);
      if (!evidence || !eligibleOrder({
        source: "manual",
        manualFinalizationCommitted: true,
        amountPayableCents: evidence.amountPayableCents,
        initialStatus: evidence.initialStatus,
      })) return [];
      const actions: PlannedAction[] = [{
        kind: "order",
        input: {
          source: "manual",
          sourceId: evidence.jobId,
          productionJobId: evidence.jobId,
          occurredAt: evidence.occurredAt,
          market: evidence.currency === "AUD" ? "AU" : "NZ",
          currency: evidence.currency,
          orderedAmountInclGstCents: evidence.amountPayableCents,
          historical,
        },
      }];
      if (evidence.amountPaidCents > 0) actions.push({
        kind: "financial",
        input: {
          productionJobId: evidence.jobId,
          eventType: "receipt",
          sourceType: "manual_payment_update",
          sourceId: `manual-create:${evidence.jobId}`,
          amountCents: evidence.amountPaidCents,
          currency: evidence.currency,
          occurredAt: evidence.occurredAt,
          historical,
        },
      });
      return actions;
    }
    if (source === "manual_payment_updates") {
      const evidence = manualPaymentEvidence(row.value);
      if (!evidence) return [];
      return [{
        kind: "financial",
        input: {
          productionJobId: evidence.jobId,
          eventType: "receipt",
          sourceType: "manual_payment_update",
          sourceId: `manual-update:${evidence.jobId}:${evidence.idempotencyKey}`,
          amountCents: evidence.deltaCents,
          currency: evidence.currency,
          occurredAt: evidence.occurredAt,
          historical,
        },
      }];
    }
    if (source === "ledger_events") {
      const value = row.value as Readonly<{
        id: string;
        occurredAt: Date;
        orderId: string | null;
        paymentRequestId: string | null;
        paymentAttemptId: string | null;
        entryType: PaymentLedgerEntryType;
        direction: PaymentLedgerDirection;
        amountCents: number;
        currency: WebsiteAnalyticsCurrency;
        idempotencyKey: string | null;
        reversesEntryId: string | null;
      }>;
      const eventType = ledgerEventType(value);
      if (!value.orderId || !eventType) return [];
      return [{
        kind: "financial",
        input: {
          orderId: value.orderId,
          eventType,
          sourceType: "payment_ledger_entry",
          sourceId: value.id,
          amountCents: value.amountCents,
          currency: value.currency,
          occurredAt: value.occurredAt,
          historical,
        },
      }];
    }
    const eventType = source === "direct_payment_paid_transitions" ? "receipt" : "refund";
    return (await loadDirectTransitions(row.id))
      .filter((transition) => transition.eventType === eventType)
      .map((transition) => ({
        kind: "financial" as const,
        input: {
          orderId: transition.orderId,
          eventType: transition.eventType,
          sourceType: "payment_attempt" as const,
          sourceId: transition.attemptId,
          amountCents: transition.amountCents,
          currency: transition.currency,
          occurredAt: transition.occurredAt,
          historical,
        },
      }));
  }

  async function existingCount(
    executor: Database | Transaction,
    actions: readonly PlannedAction[],
  ): Promise<number> {
    let count = 0;
    for (const action of actions) {
      if (action.kind === "order") {
        const existing = await executor.select({ id: websiteAnalyticsConversions.id })
          .from(websiteAnalyticsConversions).where(and(
            eq(websiteAnalyticsConversions.conversionType, "order"),
            eq(websiteAnalyticsConversions.sourceType,
              action.input.source === "website" ? "order" : "production_job"),
            eq(websiteAnalyticsConversions.sourceId, action.input.sourceId),
          )).limit(1);
        count += existing.length;
      } else if (action.kind === "inquiry") {
        const existing = await executor.select({ id: websiteAnalyticsConversions.id })
          .from(websiteAnalyticsConversions).where(and(
            eq(websiteAnalyticsConversions.conversionType, "inquiry"),
            eq(websiteAnalyticsConversions.sourceType, "customer_service_conversation"),
            eq(websiteAnalyticsConversions.sourceId, action.input.sourceId),
          )).limit(1);
        count += existing.length;
      } else {
        const existing = await executor.select({ id: websiteAnalyticsFinancialEvents.id })
          .from(websiteAnalyticsFinancialEvents).where(and(
            eq(websiteAnalyticsFinancialEvents.sourceType, action.input.sourceType),
            eq(websiteAnalyticsFinancialEvents.sourceId, action.input.sourceId),
            eq(websiteAnalyticsFinancialEvents.eventType, action.input.eventType),
          )).limit(1);
        count += existing.length;
      }
    }
    return count;
  }

  async function processRow(
    actions: readonly PlannedAction[],
    transaction: Transaction,
  ): Promise<Readonly<{ created: number; unchanged: number; skipped: number }>> {
    if (actions.length === 0) return { created: 0, unchanged: 0, skipped: 1 };
    let created = 0;
    let unchanged = 0;
    for (const action of actions) {
      const result = action.kind === "order"
        ? await repository.recordOrder(action.input, transaction)
        : action.kind === "inquiry"
          ? await repository.recordInquiry(action.input, transaction)
          : await repository.recordFinancialEvent(action.input, transaction);
      if (result.created) created += 1;
      else unchanged += 1;
    }
    return { created, unchanged, skipped: 0 };
  }

  async function dryRunSource(
    source: WebsiteAnalyticsV2BackfillSource,
    input: BackfillInput,
    batchSize: number,
    stateKeyPrefix: string,
  ): Promise<WebsiteAnalyticsV2BackfillSourceResult> {
    const stateType = input.stateType ?? "backfill";
    const stateKey = `${stateKeyPrefix}:${source}`;
    const [state] = await database.select({
      cursorOccurredAt: websiteAnalyticsReconciliationState.cursorOccurredAt,
      cursorId: websiteAnalyticsReconciliationState.cursorId,
      status: websiteAnalyticsReconciliationState.status,
    }).from(websiteAnalyticsReconciliationState).where(and(
      eq(websiteAnalyticsReconciliationState.stateType, stateType),
      eq(websiteAnalyticsReconciliationState.stateKey, stateKey),
    )).limit(1);
    const lifecycle = planSourceLifecycle(state, input);
    if (lifecycle.shortCircuit) return Object.freeze({
      source,
      ...emptyCounts(),
      cursor: lifecycle.cursor
        ? { occurredAt: lifecycle.cursor.occurredAt.toISOString(), id: lifecycle.cursor.id }
        : null,
      complete: true,
      busy: false,
    });
    let cursor = lifecycle.cursor;
    let fromOccurredAt = lifecycle.fromOccurredAt;
    let last: SourceRow | undefined;
    let counts = emptyCounts();
    for (;;) {
      const rows = await loadRows(
        database,
        source,
        cursor,
        fromOccurredAt,
        batchSize + 1,
      );
      const batch = rows.slice(0, batchSize);
      for (const row of batch) {
        const actions = await planRow(source, row, input.historical !== false);
        const existing = await existingCount(database, actions);
        const possible = actions.length;
        counts = addCounts(counts, {
          scanned: 1,
          created: 0,
          wouldCreate: Math.max(0, possible - existing),
          unchanged: Math.min(possible, existing),
          skipped: possible === 0 ? 1 : 0,
          failed: 0,
        });
      }
      last = batch.at(-1) ?? last;
      if (rows.length <= batchSize) break;
      if (!last) throw new Error("Analytics dry-run cursor did not advance");
      cursor = { occurredAt: last.occurredAt, id: last.id };
      fromOccurredAt = undefined;
    }
    return Object.freeze({
      source,
      ...counts,
      cursor: asCursor(last) ?? (lifecycle.cursor
        ? { occurredAt: lifecycle.cursor.occurredAt.toISOString(), id: lifecycle.cursor.id }
        : null),
      complete: true,
      busy: false,
    });
  }

  async function writeSource(
    source: WebsiteAnalyticsV2BackfillSource,
    input: BackfillInput,
    batchSize: number,
    stateKeyPrefix: string,
  ): Promise<WebsiteAnalyticsV2BackfillSourceResult> {
    const stateType = input.stateType ?? "backfill";
    const stateKey = `${stateKeyPrefix}:${source}`;
    const failureInitialCursor = lowerBoundCursor(input.fromOccurredAt);
    try {
      return await database.transaction(async (transaction) => {
      const lock = await transaction.execute<{ locked: boolean }>(sql`
        select pg_try_advisory_xact_lock(hashtextextended(${`${stateType}:${stateKey}`}, 0))
          as locked
      `);
      if (!lock.rows[0]?.locked) {
        return Object.freeze({
          source,
          ...emptyCounts(),
          cursor: null,
          complete: false,
          busy: true,
        });
      }
      const [state] = await transaction.select({
        cursorOccurredAt: websiteAnalyticsReconciliationState.cursorOccurredAt,
        cursorId: websiteAnalyticsReconciliationState.cursorId,
        status: websiteAnalyticsReconciliationState.status,
      }).from(websiteAnalyticsReconciliationState).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, stateType),
        eq(websiteAnalyticsReconciliationState.stateKey, stateKey),
      )).for("update").limit(1);
      const lifecycle = planSourceLifecycle(state, input);
      if (lifecycle.shortCircuit) {
        return Object.freeze({
          source,
          ...emptyCounts(),
          cursor: lifecycle.cursor
            ? { occurredAt: lifecycle.cursor.occurredAt.toISOString(), id: lifecycle.cursor.id }
            : null,
          complete: true,
          busy: false,
        });
      }
      const { cursor, restarting } = lifecycle;
      const startedAt = new Date();
      await transaction.insert(websiteAnalyticsReconciliationState).values({
        stateType,
        stateKey,
        status: "running",
        startedAt,
        cursorOccurredAt: cursor?.occurredAt ?? null,
        cursorId: cursor?.id ?? null,
      }).onConflictDoUpdate({
        target: [
          websiteAnalyticsReconciliationState.stateType,
          websiteAnalyticsReconciliationState.stateKey,
        ],
        set: {
          status: "running",
          startedAt,
          completedAt: null,
          lastErrorCode: null,
          updatedAt: startedAt,
          ...(restarting
            ? {
                cursorOccurredAt: cursor?.occurredAt ?? null,
                cursorId: cursor?.id ?? null,
                scannedCount: 0,
                createdCount: 0,
                unchangedCount: 0,
                skippedCount: 0,
                failedCount: 0,
              }
            : {}),
        },
      });
      const rows = await loadRows(
        transaction,
        source,
        cursor,
        lifecycle.fromOccurredAt,
        batchSize + 1,
      );
      const batch = rows.slice(0, batchSize);
      let counts = emptyCounts();
      for (const row of batch) {
        const actions = await planRow(source, row, input.historical !== false);
        const outcome = await processRow(actions, transaction);
        counts = addCounts(counts, {
          scanned: 1,
          created: outcome.created,
          wouldCreate: 0,
          unchanged: outcome.unchanged,
          skipped: outcome.skipped,
          failed: 0,
        });
      }
      const last = batch.at(-1);
      const complete = rows.length <= batchSize;
      const completedAt = complete ? new Date() : null;
      await transaction.update(websiteAnalyticsReconciliationState).set({
        cursorOccurredAt: last?.occurredAt ?? state?.cursorOccurredAt ?? null,
        cursorId: last?.id ?? state?.cursorId ?? null,
        status: complete ? "completed" : "pending",
        scannedCount: sql`${websiteAnalyticsReconciliationState.scannedCount} + ${counts.scanned}`,
        createdCount: sql`${websiteAnalyticsReconciliationState.createdCount} + ${counts.created}`,
        unchangedCount: sql`${websiteAnalyticsReconciliationState.unchangedCount} + ${counts.unchanged}`,
        skippedCount: sql`${websiteAnalyticsReconciliationState.skippedCount} + ${counts.skipped}`,
        failedCount: sql`${websiteAnalyticsReconciliationState.failedCount} + ${counts.failed}`,
        startedAt: complete ? startedAt : null,
        completedAt,
        lastErrorCode: null,
        updatedAt: new Date(),
      }).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, stateType),
        eq(websiteAnalyticsReconciliationState.stateKey, stateKey),
      ));
      return Object.freeze({
        source,
        ...counts,
        cursor: asCursor(last) ?? (cursor
          ? { occurredAt: cursor.occurredAt.toISOString(), id: cursor.id }
          : null),
        complete,
        busy: false,
      });
      });
    } catch {
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${`${stateType}:${stateKey}`}, 0))
        `);
        const [state] = await transaction.select({
          cursorOccurredAt: websiteAnalyticsReconciliationState.cursorOccurredAt,
          cursorId: websiteAnalyticsReconciliationState.cursorId,
          status: websiteAnalyticsReconciliationState.status,
        }).from(websiteAnalyticsReconciliationState).where(and(
          eq(websiteAnalyticsReconciliationState.stateType, stateType),
          eq(websiteAnalyticsReconciliationState.stateKey, stateKey),
        )).for("update").limit(1);
        const restarting = state?.status === "completed" && input.restartCompleted === true;
        const cursor = restarting
          ? lowerBoundCursor(input.fromOccurredAt)
          : state?.cursorOccurredAt && state.cursorId !== null
            ? { occurredAt: state.cursorOccurredAt, id: state.cursorId }
            : failureInitialCursor;
        if (state?.status !== "completed" || restarting) {
          const failedAt = new Date();
          await transaction.insert(websiteAnalyticsReconciliationState).values({
            stateType,
            stateKey,
            status: "failed",
            cursorOccurredAt: cursor?.occurredAt ?? null,
            cursorId: cursor?.id ?? null,
            failedCount: 1,
            startedAt: failedAt,
            lastErrorCode: "SOURCE_ROW_FAILED",
          }).onConflictDoUpdate({
            target: [
              websiteAnalyticsReconciliationState.stateType,
              websiteAnalyticsReconciliationState.stateKey,
            ],
            set: {
              status: "failed",
              startedAt: failedAt,
              completedAt: null,
              lastErrorCode: "SOURCE_ROW_FAILED",
              updatedAt: failedAt,
              ...(restarting
                ? {
                    cursorOccurredAt: cursor?.occurredAt ?? null,
                    cursorId: cursor?.id ?? null,
                    scannedCount: 0,
                    createdCount: 0,
                    unchangedCount: 0,
                    skippedCount: 0,
                    failedCount: 1,
                  }
                : {
                    failedCount: sql`${websiteAnalyticsReconciliationState.failedCount} + 1`,
                  }),
            },
          });
        }
        return Object.freeze({
          source,
          ...emptyCounts(),
          failed: 1,
          cursor: cursor
            ? { occurredAt: cursor.occurredAt.toISOString(), id: cursor.id }
            : null,
          complete: state?.status === "completed" && !restarting,
          busy: false,
        });
      });
    }
  }

  async function run(input: BackfillInput): Promise<WebsiteAnalyticsV2BackfillResult> {
    const batchSize = safeBatchSize(input.batchSize);
    const stateKeyPrefix = safeStateKeyPrefix(input.stateKeyPrefix);
    if (input.fromOccurredAt && Number.isNaN(input.fromOccurredAt.getTime())) {
      throw new Error("Analytics backfill start time is invalid");
    }
    const sources = input.sources ?? WEBSITE_ANALYTICS_V2_BACKFILL_SOURCES;
    if (new Set(sources).size !== sources.length
      || sources.some((source) => !WEBSITE_ANALYTICS_V2_BACKFILL_SOURCES.includes(source))) {
      throw new Error("Analytics backfill sources are invalid");
    }
    const results: WebsiteAnalyticsV2BackfillSourceResult[] = [];
    for (const source of sources) {
      results.push(input.dryRun
        ? await dryRunSource(source, input, batchSize, stateKeyPrefix)
        : await writeSource(source, input, batchSize, stateKeyPrefix));
    }
    return Object.freeze({
      dryRun: input.dryRun,
      totals: results.reduce<Counts>(addCounts, emptyCounts()),
      sources: Object.freeze(results),
      limitations: LIMITATIONS,
    });
  }

  return Object.freeze({ run });
}
