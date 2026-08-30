import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildWebsiteAnalyticsFinancialEvent,
  buildWebsiteAnalyticsInquiryFact,
  buildWebsiteAnalyticsOrderFact,
} from "./website-analytics-fact-builders";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

describe("website analytics fact builders", () => {
  it("builds the approved website order snapshot and Auckland date", () => {
    const orderId = randomUUID();
    const sessionId = randomUUID();
    const visitorDigest = digest("website-order");

    expect(buildWebsiteAnalyticsOrderFact({
      source: "website",
      sourceId: `order:${orderId}`,
      orderId,
      occurredAt: new Date("2026-08-29T12:30:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 12_500,
      consentLinked: true,
      visitorDigest,
      convertingSessionId: sessionId,
    })).toEqual({
      conversionType: "order",
      sourceType: "order",
      sourceId: `order:${orderId}`,
      orderId,
      productionJobId: null,
      conversationId: null,
      occurredAt: new Date("2026-08-29T12:30:00.000Z"),
      localDate: "2026-08-30",
      scope: "website",
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 12_500,
      visitorDigest,
      convertingSessionId: sessionId,
      historical: false,
      consentLinked: true,
    });
  });

  it("removes every behavioral link when consent is absent", () => {
    expect(buildWebsiteAnalyticsOrderFact({
      source: "website",
      sourceId: "legacy-order-1",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
      market: "AU",
      currency: "AUD",
      orderedAmountInclGstCents: 8_000,
      consentLinked: false,
      visitorDigest: digest("must-not-be-linked"),
      convertingSessionId: randomUUID(),
      historical: true,
    })).toMatchObject({
      orderId: null,
      visitorDigest: null,
      convertingSessionId: null,
      historical: true,
      consentLinked: false,
    });
  });

  it("keeps manual and inquiry parent links nullable for legacy facts", () => {
    expect(buildWebsiteAnalyticsOrderFact({
      source: "manual",
      sourceId: "legacy-job-1",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
      market: "NZ",
      currency: "NZD",
      orderedAmountInclGstCents: 9_000,
      historical: true,
    })).toMatchObject({
      sourceType: "production_job",
      productionJobId: null,
      scope: "all_business",
      visitorDigest: null,
      convertingSessionId: null,
      consentLinked: false,
    });
    expect(buildWebsiteAnalyticsInquiryFact({
      sourceId: "legacy-conversation-1",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
      consentLinked: false,
      historical: true,
    })).toMatchObject({
      conversionType: "inquiry",
      sourceType: "customer_service_conversation",
      conversationId: null,
      market: null,
      currency: null,
      orderedAmountInclGstCents: null,
      visitorDigest: null,
      convertingSessionId: null,
    });
  });

  it("builds immutable positive financial facts without deriving or combining currency", () => {
    expect(buildWebsiteAnalyticsFinancialEvent({
      eventType: "refund",
      sourceType: "payment_ledger_entry",
      sourceId: "ledger-1",
      amountCents: 2_500,
      currency: "AUD",
      occurredAt: new Date("2026-08-30T12:30:00.000Z"),
    })).toEqual({
      conversionId: null,
      orderId: null,
      productionJobId: null,
      eventType: "refund",
      sourceType: "payment_ledger_entry",
      sourceId: "ledger-1",
      amountCents: 2_500,
      currency: "AUD",
      occurredAt: new Date("2026-08-30T12:30:00.000Z"),
      localDate: "2026-08-31",
      historical: false,
    });
  });

  it("rejects invalid order money and invalid financial amounts before persistence", () => {
    expect(() => buildWebsiteAnalyticsOrderFact({
      source: "website",
      sourceId: "bad-order",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
      market: "NZ",
      currency: "AUD",
      orderedAmountInclGstCents: 10_000,
      consentLinked: false,
    })).toThrow(/market.*currency/i);
    expect(() => buildWebsiteAnalyticsFinancialEvent({
      eventType: "receipt",
      sourceType: "payment_attempt",
      sourceId: "bad-receipt",
      amountCents: 0,
      currency: "NZD",
      occurredAt: new Date("2026-08-30T00:00:00.000Z"),
    })).toThrow(/positive/i);
  });
});
