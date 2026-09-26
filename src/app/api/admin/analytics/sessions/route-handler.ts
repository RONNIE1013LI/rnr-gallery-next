import { z } from "zod";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { getWebsiteAnalyticsExplorer } from "@/server/analytics/website-analytics-explorer";
import {
  analyticsApiErrorResponse, analyticsNoStoreHeaders, assertInternalTrafficQueryAccess,
  assertSameOriginAnalyticsRequest, parseAdminAnalyticsRequest,
} from "../route-handler";

const text = z.string();
const optionalText = text.nullable();
const count = z.number().int().nonnegative();
const amount = z.number().int();
const money = z.object({ currency: z.enum(["NZD", "AUD"]), orderedRevenueCents: amount, collectedRevenueCents: amount, refundedRevenueCents: amount, netCollectedRevenueCents: amount }).strict();
const page = z.object({ id: text, occurredAt: text, pathname: text, previousPage: optionalText, nextPage: optionalText }).strict();
const session = z.object({
  sessionId: text, visitorId: text, startedAt: text, lastSeenAt: text, countryCode: optionalText,
  channel: text, source: optionalText, medium: optionalText, campaign: optionalText, clickIdType: optionalText,
  entryPage: optionalText, exitPage: optionalText, pageViews: count, sessionPageViews: count, observedDurationSeconds: z.number().nonnegative().nullable(),
  singlePage: z.boolean(), product: z.boolean(), cart: z.boolean(), checkout: z.boolean().nullable(),
  orders: count, paidOrders: count, money: z.array(money), matchedPage: page.omit({ id: true }).nullable(),
}).strict();
const quality = z.object({
  visitors: count, sessions: count, pageViews: count, pagesPerSession: z.number().nullable(),
  singlePageSessions: count, multiPageSessions: count, singlePageRate: z.number().nullable(),
  observedReturningVisitors: count, observedNewVisitors: count, avgObservedDurationSeconds: z.number().nullable(),
  productSessions: count, cartSessions: count, checkoutSessions: count.nullable(), orderSessions: count, paidSessions: count,
  orders: count, paidOrders: count, money: z.array(money),
}).strict();
const metadata = z.object({
  timezone: z.literal("Pacific/Auckland"), coverageFrom: optionalText, completeRange: z.boolean(),
  trafficBasis: z.literal("session_acquisition"), durationBasis: z.literal("first_to_last_recorded_pageview"),
  conversionBasis: z.enum(["converting_session_as_of_range_end", "converting_session_current_history"]),
}).strict();
const pagination = { total: count, page: count, pageSize: count, pageCount: count };
const listSchema = z.object({
  items: z.array(session), ...pagination, summary: quality,
  acquisition: z.array(quality.extend({ channel: text, source: optionalText, medium: optionalText, campaign: optionalText }).strict()),
  metadata, notices: z.array(text),
}).strict();
const touch = z.object({ at: text, landingPath: text, referrerOrigin: optionalText, source: optionalText, medium: optionalText, campaign: optionalText }).strict();
const conversion = z.object({
  conversionId: text, orderId: optionalText, orderNumber: text, adminHref: optionalText, occurredAt: text,
  orderedAmountCents: amount, currency: z.enum(["NZD", "AUD"]), paymentStatus: z.enum(["unpaid", "partial", "paid", "refunded"]), paidAt: optionalText,
  attribution: z.object({ model: z.enum(["first_touch", "last_touch"]), channel: text, source: optionalText, medium: optionalText, campaign: optionalText }).strict(),
  orderAcquisition: z.object({ clickIds: z.array(z.object({ type: z.enum(["gclid", "gbraid", "wbraid", "fbclid"]), value: text.max(200) }).strict()), firstTouch: touch.nullable(), lastTouch: touch.nullable(), lastNonDirectTouch: touch.nullable() }).strict(),
}).strict();
const detailSchema = z.object({
  visitor: z.object({ visitorId: text, firstSeenAt: text, lastSeenAt: text, sessionCount: count, observedReturning: z.boolean() }).strict().nullable(),
  sessions: z.array(session.extend({ pageviews: z.array(page), pageviewsTotal: count, pageviewsTruncated: z.boolean(), conversions: z.array(conversion),
    financialEvents: z.array(z.object({ id: text, orderId: optionalText, occurredAt: text, type: z.enum(["receipt", "refund", "reversal"]), amountCents: amount, currency: z.enum(["NZD", "AUD"]) }).strict()),
  }).strict()), ...pagination, truncated: z.boolean(), metadata, notices: z.array(text),
}).strict();

// This endpoint intentionally exposes anonymous identities and consented order click evidence.
// The existing aggregate API's broader privacy denylist remains unchanged.
export function assertExplorerResponsePrivacy(value: unknown, detail: boolean) {
  (detail ? detailSchema : listSchema).parse(value);
}
type Explorer = ReturnType<typeof getWebsiteAnalyticsExplorer>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<unknown>;
  enabled: () => boolean; listSessions: Explorer["listSessions"]; now: () => Date;
}>;
function defaults(): Dependencies {
  return { requirePermission: requireAdminPermission, enabled: () => readWebsiteAnalyticsBusinessConfig().v2Enabled,
    listSessions: (query, now) => getWebsiteAnalyticsExplorer().listSessions(query, now), now: () => new Date() };
}
export function createAdminAnalyticsSessionsRoute(dependencies?: Dependencies) {
  return { async GET(request: Request) {
    const deps = dependencies ?? defaults();
    try {
      const access = await deps.requirePermission("view_analytics");
      assertSameOriginAnalyticsRequest(request);
      if (!deps.enabled()) return Response.json({ error: "Website Analytics V2 is unavailable" }, { status: 404, headers: analyticsNoStoreHeaders });
      const now = deps.now(); const query = parseAdminAnalyticsRequest(request, now);
      assertInternalTrafficQueryAccess(access, query);
      const result = await deps.listSessions(query, now);
      assertExplorerResponsePrivacy(result, false);
      return Response.json(result, { headers: analyticsNoStoreHeaders });
    } catch (error) { return analyticsApiErrorResponse(error, "Website analytics sessions could not be loaded"); }
  } };
}
export const GET = createAdminAnalyticsSessionsRoute().GET;
