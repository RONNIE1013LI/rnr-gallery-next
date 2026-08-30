import { eq } from "drizzle-orm";
import { ADVERTISING_CONSENT_COOKIE, parseAdvertisingConsent } from "@/domain/consent/advertising-consent";
import type { WebsiteAnalyticsCurrency } from "@/domain/analytics/website-analytics-v2";
import type { getDatabase } from "@/server/db/client";
import { orders, paymentAttempts, paymentLedgerEntries } from "@/server/db/schema";
import type { OrderFulfilmentStatus, OrderPaymentStatus } from "@/server/db/schema/orders";
import type { PaymentLedgerDirection, PaymentLedgerEntryType } from "@/server/db/schema/payments";
import type { VerifiedPaymentStatus } from "@/server/payments/types";
import { eligibleOrder } from "./website-analytics-business-rules";
import {
  parseWebsiteAnalyticsSession,
  parseWebsiteAnalyticsVisitor,
  WEBSITE_ANALYTICS_SESSION_COOKIE,
  WEBSITE_ANALYTICS_VISITOR_COOKIE,
  websiteAnalyticsVisitorDigest,
} from "./website-analytics-cookies";
import {
  readWebsiteAnalyticsConfig,
  type WebsiteAnalyticsRuntimeConfig,
} from "./website-analytics-config";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";

type Database = ReturnType<typeof getDatabase>;
type FactRepository = Pick<
  ReturnType<typeof createWebsiteAnalyticsV2Repository>,
  "recordOrder" | "recordInquiry" | "recordFinancialEvent"
>;

type WebsiteOrderEvidence = Readonly<{
  orderId: string;
  market: "NZ" | "AU";
  currency: WebsiteAnalyticsCurrency;
  amountCents: number;
  occurredAt: Date;
}>;

type DirectPaymentEvidence = Readonly<{
  attemptId: string;
  orderId: string;
  paymentRequestId: string | null;
  amountCents: number;
  currency: WebsiteAnalyticsCurrency;
  occurredAt: Date;
  orderPaymentStatus: OrderPaymentStatus;
}>;

type LedgerEvidence = Readonly<{
  entryId: string;
  orderId: string | null;
  entryType: PaymentLedgerEntryType;
  direction: PaymentLedgerDirection;
  amountCents: number;
  currency: WebsiteAnalyticsCurrency;
  occurredAt: Date;
}>;

type RecorderOptions = Readonly<{
  config?: WebsiteAnalyticsRuntimeConfig;
  repository?: FactRepository;
  loadWebsiteOrder?: (orderId: string) => Promise<WebsiteOrderEvidence | null>;
  loadDirectPaymentAttempt?: (attemptId: string) => Promise<DirectPaymentEvidence | null>;
  loadLedgerEntry?: (entryId: string) => Promise<LedgerEvidence | null>;
}>;

export type WebsiteAnalyticsBehavioralContext = Readonly<{
  consentLinked: boolean;
  visitorDigest?: string;
  convertingSessionId?: string;
}>;

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
}

export function resolveWebsiteAnalyticsBehavioralContext(
  cookieHeader: string | null,
  config: WebsiteAnalyticsRuntimeConfig,
  now = new Date(),
): WebsiteAnalyticsBehavioralContext {
  if (!config.v2Enabled || !config.enabled || !config.cookieSecret) {
    return Object.freeze({ consentLinked: false });
  }
  const consent = parseAdvertisingConsent(cookieValue(cookieHeader, ADVERTISING_CONSENT_COOKIE));
  if (!consent?.analytics) return Object.freeze({ consentLinked: false });
  const visitor = parseWebsiteAnalyticsVisitor(
    cookieValue(cookieHeader, WEBSITE_ANALYTICS_VISITOR_COOKIE),
    config.cookieSecret,
    now,
  );
  const session = parseWebsiteAnalyticsSession(
    cookieValue(cookieHeader, WEBSITE_ANALYTICS_SESSION_COOKIE),
    config.cookieSecret,
    now,
  );
  if (!visitor || !session) return Object.freeze({ consentLinked: false });
  return Object.freeze({
    consentLinked: true,
    visitorDigest: websiteAnalyticsVisitorDigest(visitor.visitorId, config.cookieSecret),
    convertingSessionId: session.sessionId,
  });
}

export function createWebsiteAnalyticsV2BusinessRecorder(
  database: Database,
  options: RecorderOptions = {},
) {
  const config = options.config ?? readWebsiteAnalyticsConfig();
  const repository = options.repository ?? createWebsiteAnalyticsV2Repository(database, {
    attributionLookbackDays: config.attributionLookbackDays,
  });
  const loadWebsiteOrder = options.loadWebsiteOrder ?? (async (orderId: string) => {
    const [row] = await database.select({
      orderId: orders.id,
      market: orders.market,
      currency: orders.currency,
      amountCents: orders.totalInclGstCents,
      occurredAt: orders.createdAt,
    }).from(orders).where(eq(orders.id, orderId)).limit(1);
    return row ?? null;
  });
  const loadDirectPaymentAttempt = options.loadDirectPaymentAttempt ?? (async (attemptId: string) => {
    const [row] = await database.select({
      attemptId: paymentAttempts.id,
      orderId: paymentAttempts.orderId,
      paymentRequestId: paymentAttempts.paymentRequestId,
      amountCents: paymentAttempts.expectedAmountCents,
      currency: paymentAttempts.currency,
      occurredAt: paymentAttempts.updatedAt,
      orderPaymentStatus: orders.paymentStatus,
    }).from(paymentAttempts)
      .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);
    return row?.orderId && (row.currency === "NZD" || row.currency === "AUD")
      ? { ...row, orderId: row.orderId, currency: row.currency }
      : null;
  });
  const loadLedgerEntry = options.loadLedgerEntry ?? (async (entryId: string) => {
    const [row] = await database.select({
      entryId: paymentLedgerEntries.id,
      orderId: paymentLedgerEntries.orderId,
      entryType: paymentLedgerEntries.entryType,
      direction: paymentLedgerEntries.direction,
      amountCents: paymentLedgerEntries.amountCents,
      currency: paymentLedgerEntries.currency,
      occurredAt: paymentLedgerEntries.receivedAt,
    }).from(paymentLedgerEntries).where(eq(paymentLedgerEntries.id, entryId)).limit(1);
    return row ?? null;
  });

  async function failSoft(action: () => Promise<unknown>): Promise<void> {
    if (!config.v2Enabled) return;
    try {
      await action();
    } catch {
      // Reconciliation repairs missed analytics facts; business availability wins.
    }
  }

  async function recordWebsiteOrder(input: Readonly<{
    orderId: string;
    behavioralContext: WebsiteAnalyticsBehavioralContext;
  }>): Promise<void> {
    await failSoft(async () => {
      const evidence = await loadWebsiteOrder(input.orderId);
      if (!evidence || !eligibleOrder({
        source: "website",
        checkoutCommitted: true,
        totalInclGstCents: evidence.amountCents,
      })) return;
      await repository.recordOrder({
        source: "website",
        sourceId: evidence.orderId,
        orderId: evidence.orderId,
        occurredAt: evidence.occurredAt,
        market: evidence.market,
        currency: evidence.currency,
        orderedAmountInclGstCents: evidence.amountCents,
        ...input.behavioralContext,
      });
    });
  }

  async function recordManualOrder(input: Readonly<{
    jobId: string;
    occurredAt: Date;
    amountPayableCents: number;
    amountPaidCents: number;
    initialStatus: OrderFulfilmentStatus;
    currency: WebsiteAnalyticsCurrency;
  }>): Promise<void> {
    if (!eligibleOrder({
      source: "manual",
      manualFinalizationCommitted: true,
      amountPayableCents: input.amountPayableCents,
      initialStatus: input.initialStatus,
    })) return;
    const market = input.currency === "AUD" ? "AU" as const : "NZ" as const;
    await failSoft(() => repository.recordOrder({
      source: "manual",
      sourceId: input.jobId,
      productionJobId: input.jobId,
      occurredAt: input.occurredAt,
      market,
      currency: input.currency,
      orderedAmountInclGstCents: input.amountPayableCents,
    }));
    if (Number.isSafeInteger(input.amountPaidCents) && input.amountPaidCents > 0) {
      await failSoft(() => repository.recordFinancialEvent({
        productionJobId: input.jobId,
        eventType: "receipt",
        sourceType: "manual_payment_update",
        sourceId: `manual-create:${input.jobId}`,
        amountCents: input.amountPaidCents,
        currency: input.currency,
        occurredAt: input.occurredAt,
      }));
    }
  }

  async function recordManualPaymentUpdate(input: Readonly<{
    jobId: string;
    idempotencyKey: string;
    deltaCents: number;
    currency: WebsiteAnalyticsCurrency;
    occurredAt: Date;
  }>): Promise<void> {
    if (!Number.isSafeInteger(input.deltaCents) || input.deltaCents <= 0) return;
    await failSoft(() => repository.recordFinancialEvent({
      productionJobId: input.jobId,
      eventType: "receipt",
      sourceType: "manual_payment_update",
      sourceId: `manual-update:${input.jobId}:${input.idempotencyKey}`,
      amountCents: input.deltaCents,
      currency: input.currency,
      occurredAt: input.occurredAt,
    }));
  }

  async function recordDirectPaymentAttempt(input: Readonly<{
    attemptId: string;
    verifiedStatus: VerifiedPaymentStatus;
  }>): Promise<void> {
    if (input.verifiedStatus !== "paid" && input.verifiedStatus !== "refunded") return;
    await failSoft(async () => {
      const evidence = await loadDirectPaymentAttempt(input.attemptId);
      if (!evidence || evidence.paymentRequestId !== null) return;
      const eventType = input.verifiedStatus === "paid" ? "receipt" as const : "refund" as const;
      const expectedOrderStatus = input.verifiedStatus === "paid" ? "paid" : "refunded";
      if (evidence.orderPaymentStatus !== expectedOrderStatus) return;
      await repository.recordFinancialEvent({
        orderId: evidence.orderId,
        eventType,
        sourceType: "payment_attempt",
        sourceId: evidence.attemptId,
        amountCents: evidence.amountCents,
        currency: evidence.currency,
        occurredAt: evidence.occurredAt,
      });
    });
  }

  async function recordLedgerEntry(input: Readonly<{ entryId: string }>): Promise<void> {
    await failSoft(async () => {
      const evidence = await loadLedgerEntry(input.entryId);
      if (!evidence?.orderId) return;
      const eventType = evidence.entryType === "refund" && evidence.direction === "debit"
        ? "refund" as const
        : evidence.entryType === "reversal" && evidence.direction === "debit"
          ? "reversal" as const
          : (evidence.entryType === "online_payment" || evidence.entryType === "bank_transfer")
              && evidence.direction === "credit"
            ? "receipt" as const
            : null;
      if (!eventType) return;
      await repository.recordFinancialEvent({
        orderId: evidence.orderId,
        eventType,
        sourceType: "payment_ledger_entry",
        sourceId: evidence.entryId,
        amountCents: evidence.amountCents,
        currency: evidence.currency,
        occurredAt: evidence.occurredAt,
      });
    });
  }

  async function recordInquiry(input: Readonly<{
    conversationId: string;
    occurredAt: Date;
    behavioralContext: WebsiteAnalyticsBehavioralContext;
  }>): Promise<void> {
    await failSoft(() => repository.recordInquiry({
      sourceId: input.conversationId,
      conversationId: input.conversationId,
      occurredAt: input.occurredAt,
      ...input.behavioralContext,
    }));
  }

  return Object.freeze({
    recordWebsiteOrder,
    recordManualOrder,
    recordManualPaymentUpdate,
    recordDirectPaymentAttempt,
    recordLedgerEntry,
    recordInquiry,
  });
}

export type WebsiteAnalyticsV2BusinessRecorder = ReturnType<
  typeof createWebsiteAnalyticsV2BusinessRecorder
>;
