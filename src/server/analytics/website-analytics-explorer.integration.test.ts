import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkoutSessions, orders as orderTable, websiteAnalyticsSessions as sessions, websiteAnalyticsPageviews as pages, websiteAnalyticsConversions as conversions, websiteAnalyticsAttributionSnapshots as snapshots, websiteAnalyticsFinancialEvents as financial } from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { assertExplorerResponsePrivacy } from "@/app/api/admin/analytics/sessions/route-handler";
import { createWebsiteAnalyticsExplorer } from "./website-analytics-explorer";
import { parseWebsiteAnalyticsV2Query } from "./website-analytics-v2-query";

const url = process.env.TEST_DATABASE_URL;
if (!url || !isDedicatedTestDatabase(url, process.env.DATABASE_URL)) throw new Error("Dedicated analytics test database required");
const pool = new Pool({ connectionString: url, max: 2 });
const database = drizzle(pool); const explorer = createWebsiteAnalyticsExplorer(database);
const visitor = randomUUID().replaceAll("-", "").repeat(2); const other = randomUUID().replaceAll("-", "").repeat(2);
const internal = randomUUID().replaceAll("-", "").repeat(2);
const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const conversionIds = [randomUUID(), randomUUID()]; const financialIds = [randomUUID(), randomUUID()];
const day = "2398-09-27"; const now = new Date(`${day}T08:00:00Z`); const orderNumber = `explorer-${randomUUID()}`;
let checkoutId: string; let orderId: string;
const savedClickId = `test-click-${randomUUID()}`;
const time = (minute: number) => new Date(`${day}T01:${String(minute).padStart(2, "0")}:00Z`);
const query = (extra = "") => parseWebsiteAnalyticsV2Query(new URLSearchParams(`preset=custom&from=${day}&to=${day}&${extra}`), { now });
beforeAll(async () => {
  const [checkout] = await database.insert(checkoutSessions).values({ tokenDigest: randomUUID().replaceAll("-", "").repeat(2), expiresAt: new Date("2399-01-01T00:00:00Z"), completedAt: time(14) }).returning({ id: checkoutSessions.id });
  checkoutId = checkout.id;
  const [order] = await database.insert(orderTable).values({
    orderNumber, checkoutSessionId: checkoutId, checkoutSessionVersion: 1, idempotencyKey: randomUUID(), customerEmail: "analytics-fixture@example.test",
    market: "NZ", currency: "NZD", taxJurisdiction: "NZ_GST", taxRateBasisPoints: 0,
    pricingSnapshot: { schemaVersion: 1, market: "NZ", currency: "NZD", priceBookRevision: 0, taxJurisdiction: "NZ_GST", taxRateBasisPoints: 0, items: [], productSubtotalExTaxCents: 10000, productTaxCents: 0, productTotalInclTaxCents: 10000, designSurchargeCents: 0, discountCents: 0, shipping: { method: "pickup", serviceCode: "pickup", currency: "NZD", amountExTaxCents: 0, taxCents: 0, amountInclTaxCents: 0 }, taxAmountCents: 0, finalTotalCents: 10000 },
    deliveryMethod: "pickup", shippingServiceCode: "pickup", shippingServiceName: "Pickup", productSubtotalExGstCents: 10000, productGstCents: 0, productTotalInclGstCents: 10000, shippingExGstCents: 0, shippingGstCents: 0, shippingTotalInclGstCents: 0, totalExGstCents: 10000, totalGstCents: 0, totalInclGstCents: 10000, createdAt: time(14),
    attribution: { gclid: savedClickId, measurement: { version: 1, advertisingConsent: true, decidedAt: time(0).toISOString() } },
  }).returning({ id: orderTable.id });
  orderId = order.id;
  await database.insert(sessions).values(ids.map((id, index) => ({ id, visitorDigest: index < 2 ? visitor : index === 2 ? other : internal,
    startedAt: time(index * 10), localDate: day, channel: index === 0 ? "google_ads" as const : "direct" as const,
    source: index === 0 ? "google" : "direct", medium: index === 0 ? "paid_click" : null, utmCampaign: index === 0 ? "Campaign A" : null,
    countryCode: "NZ", clickIdType: index === 0 ? "gclid" : null, isInternal: index === 3 })));
  const paths = [["/", "/products/canvas", "/cart"], ["/", "/cart", "/checkout", "/cart"], ["/"], ["/cart"]];
  await database.insert(pages).values(paths.flatMap((paths, index) => paths.map((pathname, offset) => ({ id: randomUUID(), sessionId: ids[index], occurredAt: time(index * 10 + offset), localDate: day, pathname }))));
  await database.insert(conversions).values(conversionIds.map((id, index) => ({ id, conversionType: "order" as const, sourceType: "order" as const, sourceId: index ? `${orderNumber}-crosslinked` : orderNumber,
    orderId: index === 0 ? orderId : null, occurredAt: time(14), localDate: day, scope: "website" as const, market: "NZ" as const, currency: "NZD" as const, orderedAmountInclGstCents: 10000,
    visitorDigest: index ? other : visitor, convertingSessionId: ids[1], firstSessionId: ids[0], lastSessionId: ids[1], lastNonDirectSessionId: ids[0], consentLinked: true })));
  await database.insert(snapshots).values(conversionIds.flatMap(conversionId => (["first_touch", "last_touch"] as const).map(attributionModel => ({ conversionId, attributionModel, channel: "google_ads" as const, source: "google", medium: "paid_click", campaign: attributionModel === "first_touch" ? "First campaign" : "Last campaign", attributedAt: time(14) }))));
  await database.insert(financial).values(financialIds.map((id, index) => ({ id, conversionId: conversionIds[0], eventType: "receipt" as const, sourceType: "payment_attempt" as const, sourceId: id, amountCents: index ? 6000 : 4000, currency: "NZD" as const, occurredAt: time(15 + index), localDate: day })));
});
afterAll(async () => {
  await database.delete(financial).where(inArray(financial.id, financialIds));
  await database.delete(conversions).where(inArray(conversions.id, conversionIds));
  await database.delete(sessions).where(inArray(sessions.id, ids));
  if (orderId) await database.delete(orderTable).where(eq(orderTable.id, orderId));
  if (checkoutId) await database.delete(checkoutSessions).where(eq(checkoutSessions.id, checkoutId));
  await pool.end();
});
describe("retained visitor explorer SQL", () => {
  it("counts one returning visitor, two sessions and seven real pageviews without join fan-out", async () => {
    const result = await explorer.listSessions(query(`visitor=${visitor}`), now);
    expect(result.summary).toMatchObject({ visitors: 1, sessions: 2, pageViews: 7, observedReturningVisitors: 1, orders: 1, paidOrders: 1, cartSessions: 2, checkoutSessions: 1 });
    expect(result.summary.money).toEqual([{ currency: "NZD", orderedRevenueCents: 10000, collectedRevenueCents: 10000, refundedRevenueCents: 0, netCollectedRevenueCents: 10000 }]);
    expect(result.items.find(item => item.sessionId === ids[1])).toMatchObject({ source: "direct", orders: 1, paidOrders: 1 });
    assertExplorerResponsePrivacy(result, false);
  });
  it("counts a one-page visit once, leaves duration and unrecorded checkout unavailable", async () => {
    const result = await explorer.listSessions(query(`visitor=${other}`), now);
    expect(result.summary).toMatchObject({ visitors: 1, sessions: 1, pageViews: 1, singlePageSessions: 1, observedNewVisitors: 1, orders: 0, checkoutSessions: null });
    expect(result.items[0]).toMatchObject({ singlePage: true, observedDurationSeconds: null, checkout: null });
  });
  it("cart drilldown returns distinct sessions, full source and true neighboring pages", async () => {
    const result = await explorer.listSessions(query(`path=/cart&visitor=${visitor}&trafficSort=started_at_asc`), now);
    expect(result.total).toBe(2); expect(result.summary.visitors).toBe(1);
    expect(result.items[0]).toMatchObject({ source: "google", clickIdType: "gclid", matchedPage: { previousPage: "/products/canvas", nextPage: null } });
    expect(result.items[1].matchedPage).toMatchObject({ previousPage: "/", nextPage: "/checkout" });
  });
  it("sorts and paginates deterministically and keeps conversion attribution separate", async () => {
    const result = await explorer.listSessions(query(`visitor=${visitor}&trafficPageSize=1&trafficSort=pageviews_desc`), now);
    expect(result).toMatchObject({ total: 2, pageCount: 2 }); expect(result.items[0].sessionId).toBe(ids[1]);
    const detail = await explorer.visitorDetail(visitor, query("attribution=first_touch"), now);
    expect(detail.sessions.find(item => item.sessionId === ids[1])?.conversions[0]).toMatchObject({ attribution: { campaign: "First campaign" }, paymentStatus: "paid", paidAt: time(16).toISOString() });
    expect(detail.sessions.find(item => item.sessionId === ids[1])?.financialEvents).toHaveLength(2);
    expect(detail.sessions.find(item => item.sessionId === ids[1])?.pageviews.map(page => page.pathname)).toEqual(["/", "/cart", "/checkout", "/cart"]);
    assertExplorerResponsePrivacy(detail, true);
  });
  it("keeps the full visitor summary when selecting one session", async () => {
    const result = await explorer.visitorDetail(visitor, query(`session=${ids[1]}`), now);
    expect(result.sessions).toHaveLength(1);
    expect(result.visitor).toMatchObject({ sessionCount: 2, observedReturning: true, firstSeenAt: time(0).toISOString() });
  });
  it("filters internal traffic, absent campaign, source and nonmatching financial currency", async () => {
    expect((await explorer.listSessions(query(`visitor=${internal}`), now)).total).toBe(0);
    expect((await explorer.listSessions(query(`visitor=${internal}&includeInternal=true`), now)).total).toBe(1);
    const result = await explorer.listSessions(query(`visitor=${visitor}&campaign=${encodeURIComponent("(not set)")}&currency=AUD`), now);
    expect(result.total).toBe(1); expect(result.items[0].source).toBe("direct"); expect(result.items[0].orders).toBe(0);
    expect((await explorer.listSessions(query(`visitor=${visitor}&channel=google_ads&source=google`), now)).total).toBe(1);
  });
  it("uses full observed session history for quality across the range boundary", async () => {
    const boundaryId = randomUUID(); const boundaryVisitor = randomUUID().replaceAll("-", "").repeat(2);
    const start = query().start; const before = new Date(start.getTime() - 120000);
    const previousDay = new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    try {
      await database.insert(sessions).values({ id: boundaryId, visitorDigest: boundaryVisitor, startedAt: before, localDate: previousDay, channel: "direct", source: "direct" });
      await database.insert(pages).values([0, 1, 2].map(offset => ({ id: randomUUID(), sessionId: boundaryId, occurredAt: new Date(before.getTime() + offset * 60000), localDate: offset < 2 ? previousDay : day, pathname: offset === 2 ? "/cart" : "/" })));
      const result = await explorer.listSessions(query(`visitor=${boundaryVisitor}`), now);
      expect(result.summary).toMatchObject({ pageViews: 1, sessions: 1, singlePageSessions: 0, multiPageSessions: 1 });
      expect(result.items[0]).toMatchObject({ pageViews: 1, sessionPageViews: 3, singlePage: false, observedDurationSeconds: 120 });
    } finally { await database.delete(sessions).where(eq(sessions.id, boundaryId)); }
  });
  it("never treats a mismatched-currency receipt as the order currency", async () => {
    const receiptId = randomUUID();
    try {
      await database.insert(financial).values({ id: receiptId, conversionId: conversionIds[0], eventType: "receipt", sourceType: "payment_attempt", sourceId: receiptId, amountCents: 900000, currency: "AUD", occurredAt: time(17), localDate: day });
      const result = await explorer.listSessions(query(`visitor=${visitor}`), now);
      expect(result.summary.money[0].collectedRevenueCents).toBe(10000);
      expect((await explorer.visitorDetail(visitor, query(), now)).sessions.flatMap(s => s.financialEvents).some(f => f.id === receiptId)).toBe(false);
    } finally { await database.delete(financial).where(eq(financial.id, receiptId)); }
  });
  it("searches real order references and consented click IDs without returning unrelated sessions", async () => {
    for (const text of [orderNumber, savedClickId]) {
      const result = await explorer.listSessions(query(`q=${encodeURIComponent(text)}`), now);
      expect(result.total).toBe(1); expect(result.items[0].sessionId).toBe(ids[1]);
    }
    expect((await explorer.listSessions(query("q=%25"), now)).total).toBe(0);
    const detail = await explorer.visitorDetail(visitor, query(), now);
    expect(detail.sessions.flatMap(session => session.conversions)[0].orderAcquisition.clickIds).toEqual([{ type: "gclid", value: savedClickId }]);
    expect(JSON.stringify(detail)).not.toMatch(/customerEmail|analytics-fixture|measurement|tokenDigest/);
  });
  it("bounds cohort receipts by Auckland range end while detail explicitly shows current retained facts", async () => {
    const receiptId = randomUUID();
    try {
      await database.insert(financial).values({ id: receiptId, conversionId: conversionIds[0], eventType: "receipt", sourceType: "payment_attempt", sourceId: receiptId, amountCents: 1000, currency: "NZD", occurredAt: new Date(query().end.getTime() + 60000), localDate: "2398-09-28" });
      expect((await explorer.listSessions(query(`visitor=${visitor}`), now)).summary.money[0].collectedRevenueCents).toBe(10000);
      const detail = await explorer.visitorDetail(visitor, query(), now);
      expect(detail.metadata.conversionBasis).toBe("converting_session_current_history");
      expect(detail.sessions.flatMap(session => session.financialEvents).some(event => event.id === receiptId)).toBe(true);
    } finally { await database.delete(financial).where(eq(financial.id, receiptId)); }
  });
  it("returns empty data safely and rejects an unrelated visitor-to-session link", async () => {
    const result = await explorer.listSessions(query(`visitor=${other}&session=${ids[1]}`), now);
    expect(result.total).toBe(0); expect(result.summary).toMatchObject({ visitors: 0, sessions: 0, orders: 0 });
    expect((await explorer.visitorDetail("f".repeat(64), query(), now)).visitor).toBeNull();
  });
});
