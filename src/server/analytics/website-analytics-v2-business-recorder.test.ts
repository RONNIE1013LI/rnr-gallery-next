import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";
import {
  createWebsiteAnalyticsIdentity,
  WEBSITE_ANALYTICS_SESSION_COOKIE,
  WEBSITE_ANALYTICS_VISITOR_COOKIE,
  websiteAnalyticsVisitorDigest,
} from "./website-analytics-cookies";
import {
  createWebsiteAnalyticsV2BusinessRecorder,
  resolveWebsiteAnalyticsBehavioralContext,
} from "./website-analytics-v2-business-recorder";

const cookieSecret = "website-analytics-v2-test-cookie-secret-value";
const enabledConfig = {
  enabled: true,
  cookieSecret,
  v2Enabled: true,
  attributionLookbackDays: 90,
} as const;

function repository() {
  return {
    recordOrder: vi.fn().mockResolvedValue({ created: true, factId: randomUUID() }),
    recordInquiry: vi.fn().mockResolvedValue({ created: true, factId: randomUUID() }),
    recordFinancialEvent: vi.fn().mockResolvedValue({ created: true, eventId: randomUUID() }),
  };
}

describe("website analytics v2 business recorder", () => {
  it("accepts only a persisted analytics grant with a valid signed V1 visitor/session pair", () => {
    const now = new Date("2026-08-30T01:02:03.000Z");
    const identity = createWebsiteAnalyticsIdentity(cookieSecret, now);
    const consent = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-30T00:00:00.000Z",
    }));
    const granted = resolveWebsiteAnalyticsBehavioralContext(
      `${WEBSITE_ANALYTICS_VISITOR_COOKIE}=${identity.visitorCookie}; ${WEBSITE_ANALYTICS_SESSION_COOKIE}=${identity.sessionCookie}; rnr-consent-v1=${consent}`,
      enabledConfig,
      now,
    );
    expect(granted).toEqual({
      consentLinked: true,
      visitorDigest: websiteAnalyticsVisitorDigest(identity.visitorId, cookieSecret),
      convertingSessionId: identity.sessionId,
    });

    const denied = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: false,
      advertising: false,
      decidedAt: "2026-08-30T00:00:00.000Z",
    }));
    expect(resolveWebsiteAnalyticsBehavioralContext(
      `${WEBSITE_ANALYTICS_VISITOR_COOKIE}=${identity.visitorCookie}; ${WEBSITE_ANALYTICS_SESSION_COOKIE}=${identity.sessionCookie}; rnr-consent-v1=${denied}`,
      enabledConfig,
      now,
    )).toEqual({ consentLinked: false });
    expect(resolveWebsiteAnalyticsBehavioralContext(
      `${WEBSITE_ANALYTICS_VISITOR_COOKIE}=forged; ${WEBSITE_ANALYTICS_SESSION_COOKIE}=${identity.sessionCookie}; rnr-consent-v1=${consent}`,
      enabledConfig,
      now,
    )).toEqual({ consentLinked: false });
  });

  it("performs zero loaders or V2 repository calls when the V2 flag is false", async () => {
    const facts = repository();
    const loadWebsiteOrder = vi.fn();
    const loadDirectPaymentAttempt = vi.fn();
    const loadLedgerEntry = vi.fn();
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: { ...enabledConfig, v2Enabled: false },
      repository: facts,
      loadWebsiteOrder,
      loadDirectPaymentAttempt,
      loadLedgerEntry,
    });

    await recorder.recordWebsiteOrder({ orderId: randomUUID(), behavioralContext: { consentLinked: false } });
    await recorder.recordDirectPaymentAttempt({ attemptId: randomUUID(), verifiedStatus: "paid" });
    await recorder.recordLedgerEntry({ entryId: randomUUID() });
    await recorder.recordManualOrder({
      jobId: randomUUID(),
      occurredAt: new Date("2026-08-30T01:00:00.000Z"),
      amountPayableCents: 10_000,
      amountPaidCents: 2_000,
      initialStatus: "new",
      currency: "NZD",
    });
    await recorder.recordInquiry({
      conversationId: randomUUID(),
      occurredAt: new Date("2026-08-30T01:00:00.000Z"),
      behavioralContext: { consentLinked: false },
    });

    expect(loadWebsiteOrder).not.toHaveBeenCalled();
    expect(loadDirectPaymentAttempt).not.toHaveBeenCalled();
    expect(loadLedgerEntry).not.toHaveBeenCalled();
    expect(facts.recordOrder).not.toHaveBeenCalled();
    expect(facts.recordInquiry).not.toHaveBeenCalled();
    expect(facts.recordFinancialEvent).not.toHaveBeenCalled();
  });

  it("records eligible manual order and initial paid amount with stable non-PII IDs", async () => {
    const facts = repository();
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: enabledConfig,
      repository: facts,
    });
    const jobId = randomUUID();
    const occurredAt = new Date("2026-08-30T03:04:05.000Z");

    await expect(recorder.recordManualOrder({
      jobId,
      occurredAt,
      amountPayableCents: 12_500,
      amountPaidCents: 4_000,
      initialStatus: "new",
      currency: "NZD",
    })).resolves.toBeUndefined();

    expect(facts.recordOrder).toHaveBeenCalledWith({
      source: "manual",
      sourceId: jobId,
      productionJobId: jobId,
      occurredAt,
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 12_500,
    });
    expect(facts.recordFinancialEvent).toHaveBeenCalledWith({
      productionJobId: jobId,
      eventType: "receipt",
      sourceType: "manual_payment_update",
      sourceId: `manual-create:${jobId}`,
      amountCents: 4_000,
      currency: "NZD",
      occurredAt,
    });
  });

  it("maps exact direct-payment and ledger evidence and ignores mutable unsupported states", async () => {
    const facts = repository();
    const orderId = randomUUID();
    const attemptId = randomUUID();
    const ledgerId = randomUUID();
    const paidAt = new Date("2026-08-30T04:00:00.000Z");
    const refundedAt = new Date("2026-09-02T04:00:00.000Z");
    const loadDirectPaymentAttempt = vi.fn().mockResolvedValue({
      attemptId,
      orderId,
      paymentRequestId: null,
      amountCents: 8_500,
      currency: "AUD",
      occurredAt: paidAt,
      orderPaymentStatus: "paid",
    });
    const loadLedgerEntry = vi.fn().mockResolvedValue({
      entryId: ledgerId,
      orderId,
      entryType: "refund",
      direction: "debit",
      amountCents: 2_500,
      currency: "AUD",
      occurredAt: refundedAt,
    });
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: enabledConfig,
      repository: facts,
      loadDirectPaymentAttempt,
      loadLedgerEntry,
    });

    await recorder.recordDirectPaymentAttempt({ attemptId, verifiedStatus: "processing" });
    await recorder.recordDirectPaymentAttempt({ attemptId, verifiedStatus: "failed" });
    await recorder.recordDirectPaymentAttempt({ attemptId, verifiedStatus: "cancelled" });
    expect(loadDirectPaymentAttempt).not.toHaveBeenCalled();
    await recorder.recordDirectPaymentAttempt({ attemptId, verifiedStatus: "paid" });
    await recorder.recordLedgerEntry({ entryId: ledgerId });

    expect(facts.recordFinancialEvent).toHaveBeenNthCalledWith(1, {
      orderId,
      eventType: "receipt",
      sourceType: "payment_attempt",
      sourceId: attemptId,
      amountCents: 8_500,
      currency: "AUD",
      occurredAt: paidAt,
    });
    expect(facts.recordFinancialEvent).toHaveBeenNthCalledWith(2, {
      orderId,
      eventType: "refund",
      sourceType: "payment_ledger_entry",
      sourceId: ledgerId,
      amountCents: 2_500,
      currency: "AUD",
      occurredAt: refundedAt,
    });
  });

  it("swallows analytics errors so business success remains available", async () => {
    const facts = repository();
    facts.recordInquiry.mockRejectedValueOnce(new Error("analytics unavailable"));
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: enabledConfig,
      repository: facts,
    });

    const conversationId = randomUUID();
    const occurredAt = new Date("2026-08-30T05:00:00.000Z");
    await expect(recorder.recordInquiry({
      conversationId,
      occurredAt,
      behavioralContext: { consentLinked: false },
    })).resolves.toBeUndefined();
    expect(facts.recordInquiry).toHaveBeenCalledWith({
      sourceId: conversationId,
      conversationId,
      occurredAt,
      consentLinked: false,
    });
  });
});
