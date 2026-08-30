import { and, asc, eq, gt, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { WebsiteAnalyticsCurrency } from "@/domain/analytics/website-analytics-v2";
import type { getDatabase } from "@/server/db/client";
import {
  customerServiceConversations,
  customerServiceMessages,
  invoices,
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
  "website_inquiries",
  "ledger_events",
  "direct_payment_transitions",
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

const LIMITATIONS = Object.freeze([
  "Historical direct payment timing is not inferred from mutable payment status or updatedAt.",
  "Historical refund timing or amount is not inferred from mutable refund status or updatedAt.",
  "Historical manual partial-payment timing is unavailable and is not reconstructed.",
]);

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

function ledgerEventType(input: Readonly<{
  entryType: PaymentLedgerEntryType;
  direction: PaymentLedgerDirection;
}>): "receipt" | "refund" | "reversal" | null {
  if ((input.entryType === "online_payment" || input.entryType === "bank_transfer"
      || input.entryType === "legacy_backfill") && input.direction === "credit") {
    return "receipt";
  }
  if (input.entryType === "refund" && input.direction === "debit") return "refund";
  if (input.entryType === "reversal" && input.direction === "debit") return "reversal";
  return null;
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
        initialStatus: productionJobs.manualStatus,
        amountPayableCents: productionJobs.amountPayableCents,
        amountPaidCents: productionJobs.amountPaidCents,
        paymentStatus: productionJobs.manualPaymentStatus,
        currency: invoices.currency,
      }).from(productionJobs).leftJoin(
        invoices,
        eq(invoices.jobId, productionJobs.id),
      ).where(and(
        eq(productionJobs.source, "manual"),
        fromOccurredAt ? gte(productionJobs.createdAt, fromOccurredAt) : undefined,
        cursorCondition(productionJobs.createdAt, productionJobs.id, cursor),
      )).orderBy(asc(productionJobs.createdAt), asc(productionJobs.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    if (source === "ledger_events") {
      const rows = await executor.select({
        id: paymentLedgerEntries.id,
        occurredAt: paymentLedgerEntries.receivedAt,
        orderId: paymentLedgerEntries.orderId,
        entryType: paymentLedgerEntries.entryType,
        direction: paymentLedgerEntries.direction,
        amountCents: paymentLedgerEntries.amountCents,
        currency: paymentLedgerEntries.currency,
      }).from(paymentLedgerEntries).where(and(
        fromOccurredAt ? gte(paymentLedgerEntries.receivedAt, fromOccurredAt) : undefined,
        cursorCondition(paymentLedgerEntries.receivedAt, paymentLedgerEntries.id, cursor),
      )).orderBy(asc(paymentLedgerEntries.receivedAt), asc(paymentLedgerEntries.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    if (source === "direct_payment_transitions") {
      const occurredAt = sql<Date>`least(
        coalesce(${paymentAttempts.websiteAnalyticsPaidAt}, 'infinity'::timestamptz),
        coalesce(${paymentAttempts.websiteAnalyticsRefundedAt}, 'infinity'::timestamptz)
      )`.mapWith(paymentAttempts.websiteAnalyticsPaidAt);
      const rows = await executor.select({
        id: paymentAttempts.id,
        occurredAt,
      }).from(paymentAttempts).where(and(
        isNull(paymentAttempts.paymentRequestId),
        or(
          isNotNull(paymentAttempts.websiteAnalyticsPaidAt),
          isNotNull(paymentAttempts.websiteAnalyticsRefundedAt),
        ),
        fromOccurredAt ? gte(occurredAt, fromOccurredAt) : undefined,
        cursor ? or(
          gt(occurredAt, cursor.occurredAt),
          and(eq(occurredAt, cursor.occurredAt), gt(paymentAttempts.id, cursor.id)),
        ) : undefined,
      )).orderBy(asc(occurredAt), asc(paymentAttempts.id)).limit(limit);
      return rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt, value: row }));
    }
    throw new Error("Unknown analytics backfill source");
  }

  async function existingCount(
    executor: Database | Transaction,
    source: WebsiteAnalyticsV2BackfillSource,
    row: SourceRow,
  ): Promise<number> {
    if (source === "website_orders" || source === "manual_orders"
      || source === "website_inquiries") {
      const existing = await executor.select({ id: websiteAnalyticsConversions.id })
        .from(websiteAnalyticsConversions)
        .where(eq(websiteAnalyticsConversions.sourceId, row.id)).limit(1);
      return existing.length;
    }
    if (source === "ledger_events") {
      const existing = await executor.select({ id: websiteAnalyticsFinancialEvents.id })
        .from(websiteAnalyticsFinancialEvents).where(and(
          eq(websiteAnalyticsFinancialEvents.sourceType, "payment_ledger_entry"),
          eq(websiteAnalyticsFinancialEvents.sourceId, row.id),
        ));
      return existing.length;
    }
    const existing = await executor.select({ id: websiteAnalyticsFinancialEvents.id })
      .from(websiteAnalyticsFinancialEvents).where(and(
        eq(websiteAnalyticsFinancialEvents.sourceType, "payment_attempt"),
        eq(websiteAnalyticsFinancialEvents.sourceId, row.id),
      ));
    return existing.length;
  }

  async function processRow(
    source: WebsiteAnalyticsV2BackfillSource,
    row: SourceRow,
    historical: boolean,
    transaction: Transaction,
  ): Promise<Readonly<{ created: number; unchanged: number; skipped: number }>> {
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
      })) return { created: 0, unchanged: 0, skipped: 1 };
      const result = await repository.recordOrder({
        source: "website",
        sourceId: value.id,
        orderId: value.id,
        occurredAt: value.occurredAt,
        market: value.market,
        currency: value.currency,
        orderedAmountInclGstCents: value.amountCents,
        consentLinked: false,
        historical,
      }, transaction);
      return result.created
        ? { created: 1, unchanged: 0, skipped: 0 }
        : { created: 0, unchanged: 1, skipped: 0 };
    }
    if (source === "website_inquiries") {
      const result = await repository.recordInquiry({
        sourceId: row.id,
        conversationId: row.id,
        occurredAt: row.occurredAt,
        consentLinked: false,
        historical,
      }, transaction);
      return result.created
        ? { created: 1, unchanged: 0, skipped: 0 }
        : { created: 0, unchanged: 1, skipped: 0 };
    }
    if (source === "manual_orders") {
      const value = row.value as Readonly<{
        id: string;
        occurredAt: Date;
        initialStatus: Parameters<typeof eligibleOrder>[0]["initialStatus"];
        amountPayableCents: number | null;
        amountPaidCents: number | null;
        paymentStatus: string | null;
        currency: WebsiteAnalyticsCurrency | null;
      }>;
      if (!eligibleOrder({
        source: "manual",
        manualFinalizationCommitted: true,
        amountPayableCents: value.amountPayableCents ?? undefined,
        initialStatus: value.initialStatus,
      })) return { created: 0, unchanged: 0, skipped: 1 };
      const currency = value.currency ?? "NZD";
      const result = await repository.recordOrder({
        source: "manual",
        sourceId: value.id,
        productionJobId: value.id,
        occurredAt: value.occurredAt,
        market: currency === "AUD" ? "AU" : "NZ",
        currency,
        orderedAmountInclGstCents: value.amountPayableCents!,
        historical,
      }, transaction);
      const unsupportedHistoricFinance = (value.amountPaidCents ?? 0) > 0
        || value.paymentStatus === "paid"
        || value.paymentStatus === "refunded";
      return result.created
        ? { created: 1, unchanged: 0, skipped: unsupportedHistoricFinance ? 1 : 0 }
        : { created: 0, unchanged: 1, skipped: unsupportedHistoricFinance ? 1 : 0 };
    }
    if (source === "ledger_events") {
      const value = row.value as Readonly<{
        id: string;
        occurredAt: Date;
        orderId: string | null;
        entryType: PaymentLedgerEntryType;
        direction: PaymentLedgerDirection;
        amountCents: number;
        currency: WebsiteAnalyticsCurrency;
      }>;
      const eventType = ledgerEventType(value);
      if (!value.orderId || !eventType) return { created: 0, unchanged: 0, skipped: 1 };
      const result = await repository.recordFinancialEvent({
        orderId: value.orderId,
        eventType,
        sourceType: "payment_ledger_entry",
        sourceId: value.id,
        amountCents: value.amountCents,
        currency: value.currency,
        occurredAt: value.occurredAt,
        historical,
      }, transaction);
      return result.created
        ? { created: 1, unchanged: 0, skipped: 0 }
        : { created: 0, unchanged: 1, skipped: 0 };
    }
    if (source === "direct_payment_transitions") {
      const transitions = await loadDirectTransitions(row.id);
      let created = 0;
      let unchanged = 0;
      for (const transition of transitions) {
        const result = await repository.recordFinancialEvent({
          orderId: transition.orderId,
          eventType: transition.eventType,
          sourceType: "payment_attempt",
          sourceId: transition.attemptId,
          amountCents: transition.amountCents,
          currency: transition.currency,
          occurredAt: transition.occurredAt,
          historical,
        }, transaction);
        if (result.created) created += 1;
        else unchanged += 1;
      }
      return transitions.length === 0
        ? { created: 0, unchanged: 0, skipped: 1 }
        : { created, unchanged, skipped: 0 };
    }
    throw new Error("Unknown analytics backfill source");
  }

  async function dryRunSource(
    source: WebsiteAnalyticsV2BackfillSource,
    input: BackfillInput,
    batchSize: number,
  ): Promise<WebsiteAnalyticsV2BackfillSourceResult> {
    const rows = await loadRows(database, source, null, input.fromOccurredAt, batchSize + 1);
    const batch = rows.slice(0, batchSize);
    let counts = emptyCounts();
    for (const row of batch) {
      const existing = await existingCount(database, source, row);
      const possible = source === "direct_payment_transitions"
        ? (await loadDirectTransitions(row.id)).length
        : 1;
      counts = addCounts(counts, {
        scanned: 1,
        created: 0,
        wouldCreate: Math.max(0, possible - existing),
        unchanged: Math.min(possible, existing),
        skipped: possible === 0 ? 1 : 0,
        failed: 0,
      });
    }
    return Object.freeze({
      source,
      ...counts,
      cursor: asCursor(batch.at(-1)),
      complete: rows.length <= batchSize,
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
    return database.transaction(async (transaction) => {
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
      if (state?.status === "completed") {
        return Object.freeze({
          source,
          ...emptyCounts(),
          cursor: state.cursorOccurredAt && state.cursorId
            ? { occurredAt: state.cursorOccurredAt.toISOString(), id: state.cursorId }
            : null,
          complete: true,
          busy: false,
        });
      }
      const cursor = state?.cursorOccurredAt && state.cursorId
        ? { occurredAt: state.cursorOccurredAt, id: state.cursorId }
        : null;
      const startedAt = new Date();
      await transaction.insert(websiteAnalyticsReconciliationState).values({
        stateType,
        stateKey,
        status: "running",
        startedAt,
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
        },
      });
      const rows = await loadRows(
        transaction,
        source,
        cursor,
        input.fromOccurredAt,
        batchSize + 1,
      );
      const batch = rows.slice(0, batchSize);
      let counts = emptyCounts();
      for (const row of batch) {
        const outcome = await processRow(source, row, input.historical !== false, transaction);
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
        ? await dryRunSource(source, input, batchSize)
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
