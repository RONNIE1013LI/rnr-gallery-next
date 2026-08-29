import type { WebsiteAnalyticsCurrency, WebsiteAnalyticsScope } from "@/domain/analytics/website-analytics-v2";

type OrderSource = "website" | "manual";

export type AnalyticsOrderCandidate = Readonly<{
  source: OrderSource;
  checkoutCommitted?: boolean;
  totalInclGstCents?: number;
  manualFinalizationCommitted?: boolean;
  amountPayableCents?: number;
  initialStatus?: string;
}>;

export type AnalyticsInquiryCandidate = Readonly<{
  source: "website";
  firstInboundMessageCommitted: boolean;
  isFirstConversationMessage: boolean;
  isStaffCreated: boolean;
  isKnownSpam: boolean;
}>;

export type AnalyticsFinancialEventType = "receipt" | "refund" | "reversal";

export function eligibleOrder(order: AnalyticsOrderCandidate): boolean {
  if (order.source === "website") {
    return order.checkoutCommitted === true && (order.totalInclGstCents ?? 0) > 0;
  }
  return order.manualFinalizationCommitted === true
    && (order.amountPayableCents ?? 0) > 0
    && order.initialStatus !== "cancelled";
}

export function eligibleWebsiteInquiry(inquiry: AnalyticsInquiryCandidate): boolean {
  return inquiry.source === "website"
    && inquiry.firstInboundMessageCommitted
    && inquiry.isFirstConversationMessage
    && !inquiry.isStaffCreated
    && !inquiry.isKnownSpam;
}

export function orderedAmountCents(order: Pick<AnalyticsOrderCandidate, "source" | "totalInclGstCents" | "amountPayableCents">): number | null {
  const amount = order.source === "website" ? order.totalInclGstCents : order.amountPayableCents;
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function analyticsPaymentDirection(eventType: AnalyticsFinancialEventType): 1 | -1 {
  return eventType === "receipt" ? 1 : -1;
}

export function isPaidOrder(input: Readonly<{
  orderedAmountCents: number;
  collectedCents: number;
  refundedCents: number;
}>): boolean {
  return input.orderedAmountCents > 0
    && input.collectedCents - input.refundedCents >= input.orderedAmountCents;
}

export function orderIsInScope(order: Pick<AnalyticsOrderCandidate, "source">, scope: WebsiteAnalyticsScope): boolean {
  return scope === "all_business" || order.source === "website";
}

export function canAggregateAnalyticsCurrency(
  left: WebsiteAnalyticsCurrency,
  right: WebsiteAnalyticsCurrency,
): boolean {
  return left === right;
}
