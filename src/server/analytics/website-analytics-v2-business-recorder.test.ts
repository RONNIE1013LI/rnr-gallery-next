import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";
import {
  createWebsiteAnalyticsIdentity,
  createWebsiteAnalyticsInternalDevice,
  WEBSITE_ANALYTICS_INTERNAL_COOKIE,
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
  afterEach(() => vi.unstubAllEnvs());

  it.each(["false", "true"])(
    "constructs a disabled no-op recorder when V2=%s and default V1 config is invalid",
    async (v2Enabled) => {
      vi.stubEnv("FIRST_PARTY_ANALYTICS_ENABLED", "true");
      vi.stubEnv("FIRST_PARTY_ANALYTICS_COOKIE_SECRET", "short");
      vi.stubEnv("WEBSITE_ANALYTICS_V2_ENABLED", v2Enabled);
      const facts = repository();

      const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
        repository: facts,
      });
      await expect(recorder.recordInquiry({
        conversationId: randomUUID(),
        occurredAt: new Date("2026-08-30T00:00:00.000Z"),
        behavioralContext: { consentLinked: false },
      })).resolves.toBeUndefined();
      expect(facts.recordInquiry).not.toHaveBeenCalled();
    },
  );

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
      isInternal: false,
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
    )).toEqual({ consentLinked: false, isInternal: false });
    expect(resolveWebsiteAnalyticsBehavioralContext(
      `${WEBSITE_ANALYTICS_VISITOR_COOKIE}=forged; ${WEBSITE_ANALYTICS_SESSION_COOKIE}=${identity.sessionCookie}; rnr-consent-v1=${consent}`,
      enabledConfig,
      now,
    )).toEqual({ consentLinked: false, isInternal: false });
  });

  it("keeps the trusted internal-device marker independent of analytics consent and session linkage", () => {
    const now = new Date("2026-08-30T01:02:03.000Z");
    const marker = createWebsiteAnalyticsInternalDevice(cookieSecret, now);
    const denied = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: false,
      advertising: false,
      decidedAt: "2026-08-30T00:00:00.000Z",
    }));

    expect(resolveWebsiteAnalyticsBehavioralContext(
      `${WEBSITE_ANALYTICS_INTERNAL_COOKIE}=${marker}; rnr-consent-v1=${denied}`,
      enabledConfig,
      now,
    )).toEqual({ consentLinked: false, isInternal: true });
    expect(resolveWebsiteAnalyticsBehavioralContext(
      `${WEBSITE_ANALYTICS_INTERNAL_COOKIE}=forged; rnr-consent-v1=${denied}`,
      enabledConfig,
      now,
    )).toEqual({ consentLinked: false, isInternal: false });
  });

  it("performs zero loaders or V2 repository calls when the V2 flag is false", async () => {
    const facts = repository();
    const loadWebsiteOrder = vi.fn();
    const loadLedgerEntry = vi.fn();
    const loadLedgerEntryForAttempt = vi.fn();
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: { ...enabledConfig, v2Enabled: false },
      repository: facts,
      loadWebsiteOrder,
      loadLedgerEntry,
      loadLedgerEntryForAttempt,
    });

    await recorder.recordWebsiteOrder({ orderId: randomUUID(), behavioralContext: { consentLinked: false } });
    await recorder.recordDirectPaymentTransition({
      attemptId: randomUUID(),
      orderId: randomUUID(),
      paymentRequestId: null,
      eventType: "receipt",
      amountCents: 8_500,
      currency: "NZD",
      occurredAt: new Date("2026-08-30T01:00:00.000Z"),
    });
    await recorder.recordLedgerEntry({ entryId: randomUUID() });
    await recorder.recordPaymentRequestAttemptLedger({ attemptId: randomUUID() });
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
    expect(loadLedgerEntry).not.toHaveBeenCalled();
    expect(loadLedgerEntryForAttempt).not.toHaveBeenCalled();
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

  it("records direct financial facts from the immutable committed transition", async () => {
    const facts = repository();
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: enabledConfig,
      repository: facts,
    });
    const orderId = randomUUID();
    const attemptId = randomUUID();
    const occurredAt = new Date("2026-08-30T03:30:00.000Z");

    await recorder.recordDirectPaymentTransition({
      attemptId,
      orderId,
      paymentRequestId: null,
      eventType: "receipt",
      amountCents: 8_500,
      currency: "AUD",
      occurredAt,
    });

    expect(facts.recordFinancialEvent).toHaveBeenCalledWith({
      orderId,
      eventType: "receipt",
      sourceType: "payment_attempt",
      sourceId: attemptId,
      amountCents: 8_500,
      currency: "AUD",
      occurredAt,
    });

    await recorder.recordDirectPaymentTransition({
      attemptId: randomUUID(),
      orderId,
      paymentRequestId: randomUUID(),
      eventType: "receipt",
      amountCents: 8_500,
      currency: "AUD",
      occurredAt,
    });
    expect(facts.recordFinancialEvent).toHaveBeenCalledTimes(1);
  });

  it("maps exact ledger evidence", async () => {
    const facts = repository();
    const orderId = randomUUID();
    const ledgerId = randomUUID();
    const refundedAt = new Date("2026-09-02T04:00:00.000Z");
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
      loadLedgerEntry,
    });

    await recorder.recordLedgerEntry({ entryId: ledgerId });

    expect(facts.recordFinancialEvent).toHaveBeenCalledWith({
      orderId,
      eventType: "refund",
      sourceType: "payment_ledger_entry",
      sourceId: ledgerId,
      amountCents: 2_500,
      currency: "AUD",
      occurredAt: refundedAt,
    });
  });

  it("loads a payment-request ledger entry only after entering the V2 recorder gate", async () => {
    const facts = repository();
    const attemptId = randomUUID();
    const entryId = randomUUID();
    const orderId = randomUUID();
    const occurredAt = new Date("2026-09-02T05:00:00.000Z");
    const loadLedgerEntryForAttempt = vi.fn().mockResolvedValue({
      entryId,
      orderId,
      entryType: "online_payment",
      direction: "credit",
      amountCents: 4_500,
      currency: "NZD",
      occurredAt,
    });
    const recorder = createWebsiteAnalyticsV2BusinessRecorder({} as never, {
      config: enabledConfig,
      repository: facts,
      loadLedgerEntryForAttempt,
    });

    await recorder.recordPaymentRequestAttemptLedger({ attemptId });

    expect(loadLedgerEntryForAttempt).toHaveBeenCalledWith(attemptId);
    expect(facts.recordFinancialEvent).toHaveBeenCalledWith({
      orderId,
      eventType: "receipt",
      sourceType: "payment_ledger_entry",
      sourceId: entryId,
      amountCents: 4_500,
      currency: "NZD",
      occurredAt,
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
