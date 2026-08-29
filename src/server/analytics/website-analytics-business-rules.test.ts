import { describe, expect, it } from "vitest";

import {
  analyticsPaymentDirection,
  canAggregateAnalyticsCurrency,
  eligibleOrder,
  eligibleWebsiteInquiry,
  isPaidOrder,
  orderedAmountCents,
  orderIsInScope,
} from "./website-analytics-business-rules";

describe("website analytics v2 business rules", () => {
  it.each([
    [{ source: "website", checkoutCommitted: true, totalInclGstCents: 12500 }, true],
    [{ source: "website", checkoutCommitted: false, totalInclGstCents: 12500 }, false],
    [{ source: "website", checkoutCommitted: true, totalInclGstCents: 0 }, false],
    [{ source: "website", checkoutCommitted: true, totalInclGstCents: 12.5 }, false],
    [{ source: "website", checkoutCommitted: true, totalInclGstCents: Infinity }, false],
    [{ source: "website", checkoutCommitted: true, totalInclGstCents: Number.MAX_SAFE_INTEGER + 1 }, false],
    [{ source: "manual", manualFinalizationCommitted: true, amountPayableCents: 12500, initialStatus: "new" }, true],
    [{ source: "manual", manualFinalizationCommitted: false, amountPayableCents: 12500, initialStatus: "new" }, false],
    [{ source: "manual", manualFinalizationCommitted: true, amountPayableCents: 12500, initialStatus: "cancelled" }, false],
    [{ source: "manual", manualFinalizationCommitted: true, amountPayableCents: 12500 }, false],
    [{ source: "manual", manualFinalizationCommitted: true, amountPayableCents: 12500, initialStatus: "unknown" as never }, false],
  ] as const)("recognises observable eligible-order predicates", (order, expected) => {
    expect(eligibleOrder(order)).toBe(expected);
  });

  it.each([
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: true, isStaffCreated: false, isKnownSpam: false }, true],
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: false, isStaffCreated: false, isKnownSpam: false }, false],
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: true, isStaffCreated: true, isKnownSpam: false }, false],
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: true, isStaffCreated: false, isKnownSpam: true }, false],
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: true, isStaffCreated: false, isKnownSpam: false, isKnownTest: true }, false],
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: true, isStaffCreated: false, isKnownSpam: false, isKnownTest: false }, true],
    [{ source: "website", firstInboundMessageCommitted: true, isFirstConversationMessage: true, isStaffCreated: false, isKnownSpam: false, isKnownTest: undefined }, true],
  ] as const)("counts only committed first inbound website conversations as inquiries", (inquiry, expected) => {
    expect(eligibleWebsiteInquiry(inquiry)).toBe(expected);
  });

  it("keeps stored final amounts and payment/refund directions without recalculating GST", () => {
    expect(orderedAmountCents({ source: "website", totalInclGstCents: 12500 })).toBe(12500);
    expect(orderedAmountCents({ source: "manual", amountPayableCents: 9800 })).toBe(9800);
    expect(analyticsPaymentDirection("receipt")).toBe(1);
    expect(analyticsPaymentDirection("refund")).toBe(-1);
    expect(analyticsPaymentDirection("reversal")).toBe(-1);
  });

  it("counts a paid order once only when net collected amount reaches the stored ordered amount", () => {
    expect(isPaidOrder({ orderedAmountCents: 12500, collectedCents: 12500, refundedCents: 0 })).toBe(true);
    expect(isPaidOrder({ orderedAmountCents: 12500, collectedCents: 13000, refundedCents: 500 })).toBe(true);
    expect(isPaidOrder({ orderedAmountCents: 12500, collectedCents: 13000, refundedCents: 600 })).toBe(false);
    expect(isPaidOrder({ orderedAmountCents: 12500, collectedCents: 12499, refundedCents: 0 })).toBe(false);
    expect(isPaidOrder({ orderedAmountCents: 12500, collectedCents: -1, refundedCents: -1 })).toBe(false);
    expect(isPaidOrder({ orderedAmountCents: 12500, collectedCents: 12500.5, refundedCents: 0 })).toBe(false);
    expect(isPaidOrder({ orderedAmountCents: Infinity, collectedCents: Infinity, refundedCents: 0 })).toBe(false);
  });

  it("keeps website and all-business scopes distinct and never mixes currencies", () => {
    expect(orderIsInScope({ source: "website" }, "website")).toBe(true);
    expect(orderIsInScope({ source: "manual" }, "website")).toBe(false);
    expect(orderIsInScope({ source: "manual" }, "all_business")).toBe(true);
    expect(canAggregateAnalyticsCurrency("NZD", "NZD")).toBe(true);
    expect(canAggregateAnalyticsCurrency("NZD", "AUD")).toBe(false);
  });
});
