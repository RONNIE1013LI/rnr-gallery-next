import type { WebsiteAnalyticsCurrency, WebsiteAnalyticsScope } from "@/domain/analytics/website-analytics-v2";
import type { OrderFulfilmentStatus } from "@/server/db/schema/orders";

type OrderSource = "website" | "manual";

export const ANALYTICS_MANUAL_INITIAL_STATUSES = [
  "new", "designing", "awaiting_customer", "ready_to_print", "printing", "on_hold", "shipped", "completed",
] as const satisfies readonly Exclude<OrderFulfilmentStatus, "cancelled">[];

export type AnalyticsOrderCandidate = Readonly<{
  source: OrderSource;
  checkoutCommitted?: boolean;
  totalInclGstCents?: number;
  manualFinalizationCommitted?: boolean;
  amountPayableCents?: number;
  initialStatus?: OrderFulfilmentStatus;
}>;

export type AnalyticsInquiryCandidate = Readonly<{
  source: "website";
  firstInboundMessageCommitted: boolean;
  isFirstConversationMessage: boolean;
  isStaffCreated: boolean;
  isKnownSpam: boolean;
  isKnownTest?: boolean;
}>;

export type AnalyticsFinancialEventType = "receipt" | "refund" | "reversal";

function isPositiveCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function eligibleOrder(order: AnalyticsOrderCandidate): boolean {
  if (order.source === "website") {
    return order.checkoutCommitted === true && isPositiveCents(order.totalInclGstCents);
  }
  return order.manualFinalizationCommitted === true
    && isPositiveCents(order.amountPayableCents)
    && (ANALYTICS_MANUAL_INITIAL_STATUSES as readonly string[]).includes(order.initialStatus ?? "");
}

export function eligibleWebsiteInquiry(inquiry: AnalyticsInquiryCandidate): boolean {
  return inquiry.source === "website"
    && inquiry.firstInboundMessageCommitted
    && inquiry.isFirstConversationMessage
    && !inquiry.isStaffCreated
    && !inquiry.isKnownSpam
    && inquiry.isKnownTest !== true;
}

export function orderedAmountCents(order: Pick<AnalyticsOrderCandidate, "source" | "totalInclGstCents" | "amountPayableCents">): number | null {
  const amount = order.source === "website" ? order.totalInclGstCents : order.amountPayableCents;
  return isPositiveCents(amount) ? amount : null;
}

export function analyticsPaymentDirection(eventType: AnalyticsFinancialEventType): 1 | -1 {
  return eventType === "receipt" ? 1 : -1;
}

export function isPaidOrder(input: Readonly<{
  orderedAmountCents: number;
  collectedCents: number;
  refundedCents: number;
}>): boolean {
  return isPositiveCents(input.orderedAmountCents)
    && isNonNegativeCents(input.collectedCents)
    && isNonNegativeCents(input.refundedCents)
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
