import type { WebsiteAnalyticsAttributionModel, WebsiteAnalyticsCurrency } from "./website-analytics-v2";

export const WEBSITE_ANALYTICS_TRAFFIC_SORTS = ["started_at_desc", "started_at_asc", "pageviews_desc", "duration_desc"] as const;
export type WebsiteAnalyticsTrafficSort = (typeof WEBSITE_ANALYTICS_TRAFFIC_SORTS)[number];
export type ExplorerMoney = Readonly<{
  currency: WebsiteAnalyticsCurrency;
  orderedRevenueCents: number;
  collectedRevenueCents: number;
  refundedRevenueCents: number;
  netCollectedRevenueCents: number;
}>;
export type ExplorerPageview = Readonly<{
  id: string; occurredAt: string; pathname: string;
  previousPage: string | null; nextPage: string | null;
}>;
export type ExplorerSession = Readonly<{
  sessionId: string; visitorId: string; startedAt: string; lastSeenAt: string;
  countryCode: string | null; channel: string; source: string | null;
  medium: string | null; campaign: string | null; clickIdType: string | null;
  entryPage: string | null; exitPage: string | null; pageViews: number; sessionPageViews: number;
  observedDurationSeconds: number | null; singlePage: boolean;
  product: boolean; cart: boolean; checkout: boolean | null;
  orders: number; paidOrders: number; money: readonly ExplorerMoney[];
  matchedPage: Omit<ExplorerPageview, "id"> | null;
}>;
export type ExplorerQuality = Readonly<{
  visitors: number; sessions: number; pageViews: number; pagesPerSession: number | null;
  singlePageSessions: number; multiPageSessions: number; singlePageRate: number | null;
  observedReturningVisitors: number; observedNewVisitors: number;
  avgObservedDurationSeconds: number | null;
  productSessions: number; cartSessions: number; checkoutSessions: number | null;
  orderSessions: number; paidSessions: number; orders: number; paidOrders: number;
  money: readonly ExplorerMoney[];
}>;
export type ExplorerMetadata = Readonly<{
  timezone: "Pacific/Auckland"; coverageFrom: string | null; completeRange: boolean;
  trafficBasis: "session_acquisition";
  durationBasis: "first_to_last_recorded_pageview";
  conversionBasis: "converting_session_as_of_range_end" | "converting_session_current_history";
}>;
export type ExplorerSessionsResponse = Readonly<{
  items: readonly ExplorerSession[]; total: number; page: number; pageSize: number; pageCount: number;
  summary: ExplorerQuality;
  acquisition: readonly (ExplorerQuality & Readonly<{ channel: string; source: string | null; medium: string | null; campaign: string | null }>)[];
  metadata: ExplorerMetadata; notices: readonly string[];
}>;
export type ExplorerTouch = Readonly<{
  at: string; landingPath: string; referrerOrigin: string | null;
  source: string | null; medium: string | null; campaign: string | null;
}>;
export type ExplorerOrderAcquisition = Readonly<{
  clickIds: readonly Readonly<{ type: "gclid" | "gbraid" | "wbraid" | "fbclid"; value: string }>[];
  firstTouch: ExplorerTouch | null; lastTouch: ExplorerTouch | null; lastNonDirectTouch: ExplorerTouch | null;
}>;
export type ExplorerConversion = Readonly<{
  conversionId: string; orderId: string | null; orderNumber: string;
  adminHref: string | null; occurredAt: string; orderedAmountCents: number;
  currency: WebsiteAnalyticsCurrency; paymentStatus: "unpaid" | "partial" | "paid" | "refunded";
  paidAt: string | null;
  attribution: Readonly<{ model: WebsiteAnalyticsAttributionModel; channel: string; source: string | null; medium: string | null; campaign: string | null }>;
  orderAcquisition: ExplorerOrderAcquisition;
}>;
export type ExplorerFinancialEvent = Readonly<{
  id: string; orderId: string | null; occurredAt: string;
  type: "receipt" | "refund" | "reversal"; amountCents: number; currency: WebsiteAnalyticsCurrency;
}>;
export type ExplorerVisitorResponse = Readonly<{
  visitor: Readonly<{ visitorId: string; firstSeenAt: string; lastSeenAt: string; sessionCount: number; observedReturning: boolean }> | null;
  sessions: readonly (ExplorerSession & Readonly<{
    pageviews: readonly ExplorerPageview[]; conversions: readonly ExplorerConversion[];
    financialEvents: readonly ExplorerFinancialEvent[];
    pageviewsTotal: number; pageviewsTruncated: boolean;
  }>)[];
  total: number; page: number; pageSize: number; pageCount: number; truncated: boolean;
  metadata: ExplorerMetadata; notices: readonly string[];
}>;
