import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import {
  ANALYTICS_DIMENSION_SENTINELS,
  normalizeAnalyticsDimension,
  type WebsiteAnalyticsCurrency,
} from "@/domain/analytics/website-analytics-v2";
import { getDatabase } from "@/server/db/client";
import { websiteAnalyticsDailyAggregates } from "@/server/db/schema";
import type { WebsiteAnalyticsV2DailyAggregateRow } from "./website-analytics-v2-reconciliation";
import { createWebsiteAnalyticsV2Reconciliation } from "./website-analytics-v2-reconciliation";
import type { WebsiteAnalyticsV2Query } from "./website-analytics-v2-query";
import { previousAnalyticsDateRange } from "./website-analytics-date-range";
import { websiteAnalyticsLocalDate } from "./website-local-date";
import {
  analyticsPaymentStatusSql,
  isPaidOrderSql,
} from "./website-analytics-business-rules";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AggregateRow = WebsiteAnalyticsV2DailyAggregateRow;

type MoneyMetrics = Readonly<{
  currency: WebsiteAnalyticsCurrency;
  orderedRevenueCents: number;
  collectedRevenueCents: number;
  refundedRevenueCents: number;
  netCollectedRevenueCents: number;
  orderedAovCents: number | null;
}>;

type MutableMetrics = {
  visitors: number;
  sessions: number;
  pageViews: number;
  inquiries: number;
  orders: number;
  paidOrders: number;
  money: Map<WebsiteAnalyticsCurrency, MutableMoney>;
};

type MutableMoney = {
  orderedRevenueCents: number;
  collectedRevenueCents: number;
  refundedRevenueCents: number;
  netCollectedRevenueCents: number;
  orders: number;
};

type ExactTraffic = Readonly<{
  visitors: number;
  sessions: number;
}>;

type ExactBreakdownTraffic = ExactTraffic & Readonly<{
  pageViews: number;
  dimensions: Partial<Breakdown>;
}>;

type Breakdown = MutableMetrics & {
  channel?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  market?: string;
};

const aggregateFields = {
  localDate: websiteAnalyticsDailyAggregates.localDate,
  scope: websiteAnalyticsDailyAggregates.scope,
  market: websiteAnalyticsDailyAggregates.market,
  currency: websiteAnalyticsDailyAggregates.currency,
  channel: websiteAnalyticsDailyAggregates.channel,
  source: websiteAnalyticsDailyAggregates.source,
  medium: websiteAnalyticsDailyAggregates.medium,
  campaign: websiteAnalyticsDailyAggregates.campaign,
  attributionModel: websiteAnalyticsDailyAggregates.attributionModel,
  visitors: websiteAnalyticsDailyAggregates.visitors,
  sessions: websiteAnalyticsDailyAggregates.sessions,
  pageViews: websiteAnalyticsDailyAggregates.pageViews,
  inquiries: websiteAnalyticsDailyAggregates.inquiries,
  orders: websiteAnalyticsDailyAggregates.orders,
  paidOrders: websiteAnalyticsDailyAggregates.paidOrders,
  orderedRevenueCents: websiteAnalyticsDailyAggregates.orderedRevenueCents,
  collectedRevenueCents: websiteAnalyticsDailyAggregates.collectedRevenueCents,
  refundedRevenueCents: websiteAnalyticsDailyAggregates.refundedRevenueCents,
  netCollectedRevenueCents: websiteAnalyticsDailyAggregates.netCollectedRevenueCents,
  internalVisitors: websiteAnalyticsDailyAggregates.internalVisitors,
  internalSessions: websiteAnalyticsDailyAggregates.internalSessions,
  internalPageViews: websiteAnalyticsDailyAggregates.internalPageViews,
  internalInquiries: websiteAnalyticsDailyAggregates.internalInquiries,
  internalOrders: websiteAnalyticsDailyAggregates.internalOrders,
  internalPaidOrders: websiteAnalyticsDailyAggregates.internalPaidOrders,
  internalOrderedRevenueCents: websiteAnalyticsDailyAggregates.internalOrderedRevenueCents,
  internalCollectedRevenueCents: websiteAnalyticsDailyAggregates.internalCollectedRevenueCents,
  internalRefundedRevenueCents: websiteAnalyticsDailyAggregates.internalRefundedRevenueCents,
  internalNetCollectedRevenueCents: websiteAnalyticsDailyAggregates.internalNetCollectedRevenueCents,
};

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Analytics result exceeds the safe integer range");
  }
  return parsed;
}

function emptyMetrics(): MutableMetrics {
  return {
    visitors: 0,
    sessions: 0,
    pageViews: 0,
    inquiries: 0,
    orders: 0,
    paidOrders: 0,
    money: new Map(),
  };
}

function moneyFor(metrics: MutableMetrics, currency: WebsiteAnalyticsCurrency): MutableMoney {
  const existing = metrics.money.get(currency);
  if (existing) return existing;
  const created = {
    orderedRevenueCents: 0,
    collectedRevenueCents: 0,
    refundedRevenueCents: 0,
    netCollectedRevenueCents: 0,
    orders: 0,
  };
  metrics.money.set(currency, created);
  return created;
}

function addTraffic(metrics: MutableMetrics, row: AggregateRow) {
  metrics.visitors += row.visitors;
  metrics.sessions += row.sessions;
  metrics.pageViews += row.pageViews;
}

function addInquiry(metrics: MutableMetrics, row: AggregateRow) {
  metrics.inquiries += row.inquiries;
}

function addCommercial(metrics: MutableMetrics, row: AggregateRow) {
  metrics.orders += row.orders;
  metrics.paidOrders += row.paidOrders;
  if (row.currency !== "NZD" && row.currency !== "AUD") return;
  const money = moneyFor(metrics, row.currency);
  money.orders += row.orders;
  money.orderedRevenueCents += row.orderedRevenueCents;
  money.collectedRevenueCents += row.collectedRevenueCents;
  money.refundedRevenueCents += row.refundedRevenueCents;
  money.netCollectedRevenueCents += row.netCollectedRevenueCents;
}

function frozenMoney(metrics: MutableMetrics): readonly MoneyMetrics[] {
  return (["NZD", "AUD"] as const).flatMap((currency) => {
    const value = metrics.money.get(currency);
    if (!value) return [];
    return [Object.freeze({
      currency,
      orderedRevenueCents: value.orderedRevenueCents,
      collectedRevenueCents: value.collectedRevenueCents,
      refundedRevenueCents: value.refundedRevenueCents,
      netCollectedRevenueCents: value.netCollectedRevenueCents,
      orderedAovCents: value.orders > 0
        ? Math.round(value.orderedRevenueCents / value.orders)
        : null,
    })];
  });
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function freezeMetrics(
  metrics: MutableMetrics,
  websiteRateMetrics = metrics,
  exactTraffic: ExactTraffic | null | undefined = undefined,
) {
  const visitors = exactTraffic === undefined ? metrics.visitors : exactTraffic?.visitors ?? null;
  const sessions = exactTraffic === undefined ? metrics.sessions : exactTraffic?.sessions ?? null;
  const paidOrders = Math.min(metrics.paidOrders, metrics.orders);
  const websitePaidOrders = Math.min(websiteRateMetrics.paidOrders, websiteRateMetrics.orders);
  return Object.freeze({
    visitors,
    sessions,
    pageViews: metrics.pageViews,
    inquiries: metrics.inquiries,
    orders: metrics.orders,
    paidOrders,
    inquiryConversionRate: sessions === null ? null : rate(websiteRateMetrics.inquiries, sessions),
    orderConversionRate: sessions === null ? null : rate(websiteRateMetrics.orders, sessions),
    paidOrderConversionRate: sessions === null ? null : rate(websitePaidOrders, sessions),
    money: Object.freeze(frozenMoney(metrics)),
  });
}

function commercialMatches(row: AggregateRow, query: WebsiteAnalyticsV2Query): boolean {
  return (!query.market || row.market === query.market)
    && (!query.currency || row.currency === query.currency);
}

function isTrafficTotal(row: AggregateRow): boolean {
  return row.scope === "website"
    && row.channel === ANALYTICS_DIMENSION_SENTINELS.total;
}

function isTrafficDimension(row: AggregateRow): boolean {
  return row.scope === "website"
    && row.channel !== ANALYTICS_DIMENSION_SENTINELS.total
    && (row.visitors > 0 || row.sessions > 0 || row.pageViews > 0);
}

function displayChannel(value: string): string {
  if (value === "manual") return ANALYTICS_DIMENSION_SENTINELS.manualOffline;
  if (value === "unattributed") return ANALYTICS_DIMENSION_SENTINELS.unattributed;
  return normalizeAnalyticsDimension(value, "channel");
}

function metricsForRows(rows: readonly AggregateRow[], query: WebsiteAnalyticsV2Query) {
  const selected = emptyMetrics();
  const website = emptyMetrics();
  for (const row of rows) {
    if (isTrafficTotal(row)) {
      addTraffic(selected, row);
      addTraffic(website, row);
    }
    if (row.scope === "website") addInquiry(selected, row);
    if (row.scope === "website") addInquiry(website, row);
    if (row.scope === query.scope && commercialMatches(row, query)) {
      addCommercial(selected, row);
    }
    if (row.scope === "website" && commercialMatches(row, query)) {
      addCommercial(website, row);
    }
  }
  return { selected, website };
}

function addBreakdownRows(
  rows: readonly AggregateRow[],
  query: WebsiteAnalyticsV2Query,
  keyFor: (row: AggregateRow) => readonly [string, Partial<Breakdown>],
  exactTrafficByGroup?: ReadonlyMap<string, ExactBreakdownTraffic>,
  trafficMetricsAvailable = true,
  pageViewsAvailable = true,
) {
  const groups = new Map<string, Breakdown>();
  for (const row of rows) {
    if (isTrafficTotal(row)) continue;
    const [key, dimensions] = keyFor(row);
    const group = groups.get(key) ?? { ...emptyMetrics(), ...dimensions };
    if (isTrafficDimension(row)) addTraffic(group, row);
    if (row.scope === "website") addInquiry(group, row);
    if (row.scope === query.scope && commercialMatches(row, query)
      && (row.orders > 0 || row.paidOrders > 0 || row.orderedRevenueCents !== 0
        || row.collectedRevenueCents !== 0 || row.refundedRevenueCents !== 0
        || row.netCollectedRevenueCents !== 0)) {
      addCommercial(group, row);
    }
    groups.set(key, group);
  }
  if (exactTrafficByGroup && trafficMetricsAvailable) {
    for (const group of groups.values()) {
      group.visitors = 0;
      group.sessions = 0;
      group.pageViews = 0;
    }
    for (const [key, exact] of exactTrafficByGroup) {
      const group = groups.get(key) ?? { ...emptyMetrics(), ...exact.dimensions };
      group.visitors = exact.visitors;
      group.sessions = exact.sessions;
      group.pageViews = exact.pageViews;
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter((row) => row.visitors > 0 || row.sessions > 0
      || row.pageViews > 0 || row.inquiries > 0 || row.orders > 0 || row.paidOrders > 0
      || row.money.size > 0)
    .map((row) => Object.freeze({
      ...(row.channel ? { channel: row.channel } : {}),
      ...(row.source ? { source: row.source } : {}),
      ...(row.medium ? { medium: row.medium } : {}),
      ...(row.campaign ? { campaign: row.campaign } : {}),
      ...(row.market ? { market: row.market } : {}),
      visitors: trafficMetricsAvailable ? row.visitors : null,
      sessions: trafficMetricsAvailable ? row.sessions : null,
      pageViews: pageViewsAvailable ? row.pageViews : null,
      inquiries: row.inquiries,
      orders: row.orders,
      paidOrders: Math.min(row.paidOrders, row.orders),
      money: Object.freeze(frozenMoney(row)),
    }));
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

const TRAFFIC_RETENTION_MS = 90 * 24 * 60 * 60_000;

function theoreticalTrafficCoverageFrom(now: Date) {
  const partialCutoffDate = websiteAnalyticsLocalDate(
    new Date(now.getTime() - TRAFFIC_RETENTION_MS),
  );
  return shiftDate(partialCutoffDate, 1);
}

function effectiveTrafficCoverageFrom(now: Date, earliestTrafficDate: string | null) {
  if (!earliestTrafficDate) return null;
  const theoretical = theoreticalTrafficCoverageFrom(now);
  return earliestTrafficDate > theoretical ? earliestTrafficDate : theoretical;
}

function bucketFor(localDate: string, granularity: WebsiteAnalyticsV2Query["resolvedGranularity"]): string {
  if (granularity === "day") return localDate;
  if (granularity === "month") return localDate.slice(0, 7);
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftDate(localDate, -mondayOffset);
}

function bucketSelectionStart(bucket: string, query: WebsiteAnalyticsV2Query) {
  const bucketStart = query.resolvedGranularity === "month" ? `${bucket}-01` : bucket;
  return bucketStart < query.from ? query.from : bucketStart;
}

function timeSeries(
  rows: readonly AggregateRow[],
  query: WebsiteAnalyticsV2Query,
  trafficByBucket: ReadonlyMap<string, ExactTraffic>,
  trafficCoverageFrom: string | null,
) {
  const grouped = new Map<string, AggregateRow[]>();
  for (const row of rows) {
    const bucket = bucketFor(row.localDate, query.resolvedGranularity);
    const existing = grouped.get(bucket) ?? [];
    existing.push(row);
    grouped.set(bucket, existing);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketRows]) => {
      const { selected, website } = metricsForRows(bucketRows, query);
      const exactTraffic = !trafficCoverageFrom
        || bucketSelectionStart(bucket, query) < trafficCoverageFrom
        ? null
        : trafficByBucket.get(bucket) ?? { visitors: 0, sessions: 0 };
      return Object.freeze({ bucket, ...freezeMetrics(selected, website, exactTraffic) });
    });
}

function visibleMetric(total: number, internal: number, includeInternal: boolean) {
  return includeInternal ? total : Math.max(0, total - internal);
}

function visibleAggregateRow(row: AggregateRow, includeInternal: boolean): AggregateRow {
  if (includeInternal) return row;
  return Object.freeze({
    ...row,
    visitors: visibleMetric(row.visitors, row.internalVisitors, false),
    sessions: visibleMetric(row.sessions, row.internalSessions, false),
    pageViews: visibleMetric(row.pageViews, row.internalPageViews, false),
    inquiries: visibleMetric(row.inquiries, row.internalInquiries, false),
    orders: visibleMetric(row.orders, row.internalOrders, false),
    paidOrders: visibleMetric(row.paidOrders, row.internalPaidOrders, false),
    orderedRevenueCents: visibleMetric(
      row.orderedRevenueCents,
      row.internalOrderedRevenueCents,
      false,
    ),
    collectedRevenueCents: visibleMetric(
      row.collectedRevenueCents,
      row.internalCollectedRevenueCents,
      false,
    ),
    refundedRevenueCents: visibleMetric(
      row.refundedRevenueCents,
      row.internalRefundedRevenueCents,
      false,
    ),
    netCollectedRevenueCents: row.netCollectedRevenueCents
      - row.internalNetCollectedRevenueCents,
  });
}

function mapAggregateRow(
  row: typeof websiteAnalyticsDailyAggregates.$inferSelect,
  includeInternal: boolean,
): AggregateRow {
  return visibleAggregateRow(Object.freeze({
    localDate: row.localDate,
    scope: row.scope,
    market: row.market,
    currency: row.currency,
    channel: row.channel,
    source: row.source,
    medium: row.medium,
    campaign: row.campaign,
    attributionModel: row.attributionModel,
    visitors: safeNumber(row.visitors),
    sessions: safeNumber(row.sessions),
    pageViews: safeNumber(row.pageViews),
    inquiries: safeNumber(row.inquiries),
    orders: safeNumber(row.orders),
    paidOrders: 0,
    orderedRevenueCents: safeNumber(row.orderedRevenueCents),
    collectedRevenueCents: safeNumber(row.collectedRevenueCents),
    refundedRevenueCents: safeNumber(row.refundedRevenueCents),
    netCollectedRevenueCents: safeNumber(row.netCollectedRevenueCents),
    internalVisitors: safeNumber(row.internalVisitors),
    internalSessions: safeNumber(row.internalSessions),
    internalPageViews: safeNumber(row.internalPageViews),
    internalInquiries: safeNumber(row.internalInquiries),
    internalOrders: safeNumber(row.internalOrders),
    internalPaidOrders: safeNumber(row.internalPaidOrders),
    internalOrderedRevenueCents: safeNumber(row.internalOrderedRevenueCents),
    internalCollectedRevenueCents: safeNumber(row.internalCollectedRevenueCents),
    internalRefundedRevenueCents: safeNumber(row.internalRefundedRevenueCents),
    internalNetCollectedRevenueCents: safeNumber(row.internalNetCollectedRevenueCents),
  }), includeInternal);
}

async function aggregateRows(
  transaction: Transaction,
  query: WebsiteAnalyticsV2Query,
  today: string,
) {
  const hasCurrentDay = query.from <= today && query.to >= today;
  const stored = await transaction.select(aggregateFields)
    .from(websiteAnalyticsDailyAggregates)
    .where(and(
      gte(websiteAnalyticsDailyAggregates.localDate, query.from),
      lte(websiteAnalyticsDailyAggregates.localDate, query.to),
      eq(websiteAnalyticsDailyAggregates.attributionModel, query.attribution),
      hasCurrentDay ? ne(websiteAnalyticsDailyAggregates.localDate, today) : undefined,
    ))
    .orderBy(asc(websiteAnalyticsDailyAggregates.localDate));
  const prior = stored.map((row) => mapAggregateRow(
    row as typeof websiteAnalyticsDailyAggregates.$inferSelect,
    query.includeInternal,
  ));
  if (!hasCurrentDay) return Object.freeze(prior);
  const raw = await createWebsiteAnalyticsV2Reconciliation(
    transaction as unknown as Database,
  ).readRawDailyRows(today);
  return Object.freeze([
    ...prior,
    ...raw.filter((row) => row.attributionModel === query.attribution)
      .map((row) => visibleAggregateRow(Object.freeze({ ...row, paidOrders: 0 }),
        query.includeInternal)),
  ]);
}

type PaidOrderRow = Readonly<{
  localDate: unknown;
  scope: unknown;
  market: unknown;
  currency: unknown;
  channel: unknown;
  source: unknown;
  medium: unknown;
  campaign: unknown;
  paidOrders: unknown;
}>;

async function paidOrderRows(
  transaction: Transaction,
  query: WebsiteAnalyticsV2Query,
): Promise<readonly AggregateRow[]> {
  const result = await transaction.execute<PaidOrderRow>(sql`
    with balances as (
      select conversions.id,
        conversions.local_date,
        conversions.scope as conversion_scope,
        conversions.market,
        conversions.currency,
        conversions.ordered_amount_incl_gst_cents as ordered,
        snapshots.channel,
        snapshots.source,
        snapshots.medium,
        snapshots.campaign,
        coalesce(sum(financial.amount_cents)
          filter (where financial.event_type = 'receipt'), 0)::bigint as collected,
        coalesce(sum(financial.amount_cents)
          filter (where financial.event_type in ('refund', 'reversal')), 0)::bigint as refunded
      from website_analytics_conversions conversions
      inner join website_analytics_attribution_snapshots snapshots
        on snapshots.conversion_id = conversions.id
        and snapshots.attribution_model = ${query.attribution}
      left join website_analytics_financial_events financial on (
        financial.conversion_id = conversions.id
        or (financial.conversion_id is null and financial.order_id is not null
          and financial.order_id = conversions.order_id)
        or (financial.conversion_id is null and financial.production_job_id is not null
          and financial.production_job_id = conversions.production_job_id)
      ) and financial.occurred_at < ${query.end}
      where conversions.conversion_type = 'order'
        and conversions.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not conversions.is_internal)
      group by conversions.id, conversions.local_date, conversions.scope,
        conversions.market, conversions.currency,
        conversions.ordered_amount_incl_gst_cents,
        snapshots.channel, snapshots.source, snapshots.medium, snapshots.campaign
    ), paid as (
      select * from balances
      where ${isPaidOrderSql({
        orderedAmountCents: sql`ordered`,
        collectedCents: sql`collected`,
        refundedCents: sql`refunded`,
      })}
    )
    select
      paid.local_date::text as "localDate",
      scopes.scope,
      paid.market::text as market,
      paid.currency::text as currency,
      paid.channel::text as channel,
      coalesce(nullif(trim(paid.source), ''), 'Unattributed')::text as source,
      coalesce(nullif(trim(paid.medium), ''), '(not set)')::text as medium,
      coalesce(nullif(trim(paid.campaign), ''), '(not set)')::text as campaign,
      count(*)::bigint as "paidOrders"
    from paid
    cross join lateral (
      select 'website'::text as scope where paid.conversion_scope = 'website'
      union all select 'all_business'::text
    ) scopes
    group by paid.local_date, scopes.scope, paid.market, paid.currency,
      paid.channel, paid.source, paid.medium, paid.campaign
    order by paid.local_date, scopes.scope, paid.market, paid.currency,
      paid.channel, paid.source, paid.medium, paid.campaign
  `);
  return Object.freeze(result.rows.map((row) => Object.freeze({
    localDate: String(row.localDate),
    scope: String(row.scope) as AggregateRow["scope"],
    market: String(row.market),
    currency: String(row.currency),
    channel: String(row.channel),
    source: String(row.source),
    medium: String(row.medium),
    campaign: String(row.campaign),
    attributionModel: query.attribution,
    visitors: 0,
    sessions: 0,
    pageViews: 0,
    inquiries: 0,
    orders: 0,
    paidOrders: safeNumber(row.paidOrders),
    orderedRevenueCents: 0,
    collectedRevenueCents: 0,
    refundedRevenueCents: 0,
    netCollectedRevenueCents: 0,
    internalVisitors: 0,
    internalSessions: 0,
    internalPageViews: 0,
    internalInquiries: 0,
    internalOrders: 0,
    internalPaidOrders: 0,
    internalOrderedRevenueCents: 0,
    internalCollectedRevenueCents: 0,
    internalRefundedRevenueCents: 0,
    internalNetCollectedRevenueCents: 0,
  })));
}

type SupportRow = Readonly<{
  pages: unknown;
  countries: unknown;
  channelTraffic: unknown;
  campaignTraffic: unknown;
  earliestTrafficDate: unknown;
  traffic: unknown;
  trafficBuckets: unknown;
}>;

function rawTrafficBucketSql(query: WebsiteAnalyticsV2Query) {
  if (query.resolvedGranularity === "day") return sql`pageviews.local_date::text`;
  if (query.resolvedGranularity === "month") {
    return sql`to_char(pageviews.local_date, 'YYYY-MM')`;
  }
  return sql`(
    pageviews.local_date - (extract(isodow from pageviews.local_date)::int - 1)
  )::text`;
}

function legacyFirstPartySelfReferralSql() {
  return sql`sessions.channel = 'other'
    and lower(trim(sessions.source)) in (
      'rnrgallery.com', 'www.rnrgallery.com', 'rrgallery.co.nz', 'www.rrgallery.co.nz'
    )
    and lower(trim(sessions.medium)) = 'referral'
    and nullif(trim(sessions.utm_campaign), '') is null
    and sessions.click_id_type is null`;
}

function exactTrafficChannelSql() {
  return sql`case when ${legacyFirstPartySelfReferralSql()}
    then 'direct' else sessions.channel::text end`;
}

function exactTrafficSourceSql() {
  return sql`case when ${legacyFirstPartySelfReferralSql()}
    then 'direct' else sessions.source::text end`;
}

function exactTrafficMediumSql() {
  return sql`case when ${legacyFirstPartySelfReferralSql()}
    then null else sessions.medium::text end`;
}

function exactTrafficCampaignSql() {
  return sql`case when ${legacyFirstPartySelfReferralSql()}
    then null else sessions.utm_campaign::text end`;
}

function exactTraffic(value: unknown): ExactTraffic {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.freeze({
    visitors: safeNumber(row.visitors ?? 0),
    sessions: safeNumber(row.sessions ?? 0),
  });
}

function exactTrafficBuckets(value: unknown): ReadonlyMap<string, ExactTraffic> {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return [String(row.bucket), exactTraffic(row)] as const;
  }));
}

function stringDimension(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function exactChannelTraffic(value: unknown): ReadonlyMap<string, ExactBreakdownTraffic> {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const channel = displayChannel(String(row.channel ?? ""));
    return [channel, Object.freeze({
      ...exactTraffic(row),
      pageViews: safeNumber(row.pageViews ?? 0),
      dimensions: Object.freeze({ channel }),
    })] as const;
  }));
}

function exactCampaignTraffic(value: unknown): ReadonlyMap<string, ExactBreakdownTraffic> {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const channel = displayChannel(String(row.channel ?? ""));
    const source = normalizeAnalyticsDimension(stringDimension(row.source), "source");
    const medium = normalizeAnalyticsDimension(stringDimension(row.medium), "medium");
    const campaign = normalizeAnalyticsDimension(stringDimension(row.campaign), "campaign");
    const key = `${channel}\u0000${source}\u0000${medium}\u0000${campaign}`;
    return [key, Object.freeze({
      ...exactTraffic(row),
      pageViews: safeNumber(row.pageViews ?? 0),
      dimensions: Object.freeze({ channel, source, medium, campaign }),
    })] as const;
  }));
}

async function supportingTraffic(transaction: Transaction, query: WebsiteAnalyticsV2Query) {
  const result = await transaction.execute<SupportRow>(sql`
    with range_traffic as (
      select count(distinct sessions.visitor_digest)::int as visitors,
        count(distinct sessions.id)::int as sessions
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not sessions.is_internal)
    ), traffic_bucket_rows as (
      select ${rawTrafficBucketSql(query)} as bucket,
        count(distinct sessions.visitor_digest)::int as visitors,
        count(distinct sessions.id)::int as sessions
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not sessions.is_internal)
      group by ${rawTrafficBucketSql(query)}
      order by ${rawTrafficBucketSql(query)}
    ), page_rows as (
      select pageviews.pathname,
        count(distinct sessions.visitor_digest)::int as visitors,
        count(pageviews.id)::int as "pageViews"
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not sessions.is_internal)
      group by pageviews.pathname
      order by count(pageviews.id) desc, pageviews.pathname
      limit 20
    ), country_rows as (
      select coalesce(sessions.country_code, 'Unknown')::text as "countryCode",
        count(distinct sessions.visitor_digest)::int as visitors,
        count(distinct sessions.id)::int as sessions,
        count(pageviews.id)::int as "pageViews"
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not sessions.is_internal)
      group by coalesce(sessions.country_code, 'Unknown')
      order by count(pageviews.id) desc, coalesce(sessions.country_code, 'Unknown')
    ), channel_rows as (
      select ${exactTrafficChannelSql()} as channel,
        count(distinct sessions.visitor_digest)::int as visitors,
        count(distinct sessions.id)::int as sessions,
        count(pageviews.id)::int as "pageViews"
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not sessions.is_internal)
      group by ${exactTrafficChannelSql()}
      order by ${exactTrafficChannelSql()}
    ), campaign_rows as (
      select ${exactTrafficChannelSql()} as channel,
        ${exactTrafficSourceSql()} as source,
        ${exactTrafficMediumSql()} as medium,
        ${exactTrafficCampaignSql()} as campaign,
        count(distinct sessions.visitor_digest)::int as visitors,
        count(distinct sessions.id)::int as sessions,
        count(pageviews.id)::int as "pageViews"
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
        and (${query.includeInternal}::boolean or not sessions.is_internal)
      group by ${exactTrafficChannelSql()}, ${exactTrafficSourceSql()},
        ${exactTrafficMediumSql()}, ${exactTrafficCampaignSql()}
      order by ${exactTrafficChannelSql()}, ${exactTrafficSourceSql()},
        ${exactTrafficMediumSql()}, ${exactTrafficCampaignSql()}
    )
    select
      coalesce((select jsonb_agg(jsonb_build_object(
        'pathname', pathname, 'visitors', visitors, 'pageViews', "pageViews"
      ) order by "pageViews" desc, pathname) from page_rows), '[]'::jsonb) as pages,
      coalesce((select jsonb_agg(jsonb_build_object(
        'countryCode', "countryCode", 'visitors', visitors, 'sessions', sessions,
        'pageViews', "pageViews"
      ) order by "pageViews" desc, "countryCode") from country_rows), '[]'::jsonb) as countries,
      coalesce((select jsonb_agg(jsonb_build_object(
        'channel', channel, 'visitors', visitors, 'sessions', sessions,
        'pageViews', "pageViews"
      ) order by channel) from channel_rows), '[]'::jsonb) as "channelTraffic",
      coalesce((select jsonb_agg(jsonb_build_object(
        'channel', channel, 'source', source, 'medium', medium, 'campaign', campaign,
        'visitors', visitors, 'sessions', sessions, 'pageViews', "pageViews"
      ) order by channel, source, medium, campaign) from campaign_rows), '[]'::jsonb)
        as "campaignTraffic",
      (select jsonb_build_object('visitors', visitors, 'sessions', sessions)
        from range_traffic) as traffic,
      coalesce((select jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'visitors', visitors, 'sessions', sessions
      ) order by bucket) from traffic_bucket_rows), '[]'::jsonb) as "trafficBuckets",
      (select min(local_date)::text from website_analytics_sessions
        where ${query.includeInternal}::boolean or not is_internal) as "earliestTrafficDate"
  `);
  const row = result.rows[0];
  return {
    pages: Array.isArray(row?.pages) ? row.pages : [],
    countries: Array.isArray(row?.countries) ? row.countries : [],
    channelTraffic: exactChannelTraffic(row?.channelTraffic),
    campaignTraffic: exactCampaignTraffic(row?.campaignTraffic),
    traffic: exactTraffic(row?.traffic),
    trafficByBucket: exactTrafficBuckets(row?.trafficBuckets),
    earliestTrafficDate: typeof row?.earliestTrafficDate === "string"
      ? row.earliestTrafficDate
      : null,
  };
}

async function comparisonTraffic(transaction: Transaction, query: WebsiteAnalyticsV2Query) {
  const result = await transaction.execute<{ visitors: unknown; sessions: unknown }>(sql`
    select count(distinct sessions.visitor_digest)::int as visitors,
      count(distinct sessions.id)::int as sessions
    from website_analytics_pageviews pageviews
    inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
    where pageviews.local_date between ${query.from}::date and ${query.to}::date
      and (${query.includeInternal}::boolean or not sessions.is_internal)
  `);
  return exactTraffic(result.rows[0]);
}

type PaymentRow = Readonly<{ status: unknown; orders: unknown }>;

async function paymentBreakdown(transaction: Transaction, query: WebsiteAnalyticsV2Query) {
  const result = await transaction.execute<PaymentRow>(sql`
    with balances as (
      select conversions.id,
        conversions.ordered_amount_incl_gst_cents as ordered,
        coalesce(sum(financial.amount_cents)
          filter (where financial.event_type = 'receipt'), 0)::bigint as collected,
        coalesce(sum(financial.amount_cents)
          filter (where financial.event_type in ('refund', 'reversal')), 0)::bigint as refunded
      from website_analytics_conversions conversions
      left join website_analytics_financial_events financial on (
        financial.conversion_id = conversions.id
        or (financial.conversion_id is null and financial.order_id is not null
          and financial.order_id = conversions.order_id)
        or (financial.conversion_id is null and financial.production_job_id is not null
          and financial.production_job_id = conversions.production_job_id)
      ) and financial.occurred_at < ${query.end}
      where conversions.conversion_type = 'order'
        and conversions.local_date between ${query.from}::date and ${query.to}::date
        and (${query.scope}::text = 'all_business' or conversions.scope = 'website')
        and (${query.market}::text is null or conversions.market = ${query.market}::text)
        and (${query.currency}::text is null or conversions.currency = ${query.currency}::text)
        and (${query.includeInternal}::boolean or not conversions.is_internal)
      group by conversions.id, conversions.ordered_amount_incl_gst_cents
    ), statuses as (
      select ${analyticsPaymentStatusSql({
        orderedAmountCents: sql`ordered`,
        collectedCents: sql`collected`,
        refundedCents: sql`refunded`,
      })} as status
      from balances
    )
    select status, count(*)::int as orders
    from statuses
    group by status
    order by case status
      when 'paid' then 1 when 'partial' then 2 when 'unpaid' then 3 else 4 end
  `);
  return result.rows.map((row) => Object.freeze({
    status: String(row.status) as "paid" | "partial" | "unpaid" | "refunded",
    orders: safeNumber(row.orders),
  }));
}

function aggregateThrough(query: WebsiteAnalyticsV2Query, today: string): string | null {
  const lastClosed = shiftDate(today, -1);
  if (query.from > lastClosed) return null;
  return query.to < lastClosed ? query.to : lastClosed;
}

const orderSortSql = {
  occurred_at_desc: sql`"occurredAt" desc, "conversionId" desc`,
  occurred_at_asc: sql`"occurredAt" asc, "conversionId" asc`,
  ordered_amount_desc: sql`"orderedAmountCents" desc, "occurredAt" desc, "conversionId" desc`,
  ordered_amount_asc: sql`"orderedAmountCents" asc, "occurredAt" desc, "conversionId" desc`,
  collected_amount_desc: sql`"collectedAmountCents" desc, "occurredAt" desc, "conversionId" desc`,
  refunded_amount_desc: sql`"refundedAmountCents" desc, "occurredAt" desc, "conversionId" desc`,
} as const;

type OrdersResultRow = Readonly<{ total: unknown; items: unknown }>;

export function createWebsiteAnalyticsV2Dashboard(database: Database) {
  return Object.freeze({
    async load(query: WebsiteAnalyticsV2Query, now = new Date()) {
      if (Number.isNaN(now.getTime())) throw new Error("Analytics dashboard time is invalid");
      const today = websiteAnalyticsLocalDate(now);
      return database.transaction(async (transaction) => {
        const rows = Object.freeze([
          ...await aggregateRows(transaction, query, today),
          ...await paidOrderRows(transaction, query),
        ]);
        const comparisonRange = query.compare ? previousAnalyticsDateRange({
          from: query.from,
          to: query.to,
          start: query.start,
          end: query.end,
        }) : null;
        const comparisonQuery = comparisonRange
          ? { ...query, ...comparisonRange, compare: false }
          : null;
        const comparisonRows = comparisonQuery
          ? Object.freeze([
              ...await aggregateRows(transaction, comparisonQuery, today),
              ...await paidOrderRows(transaction, comparisonQuery),
            ])
          : null;
        const { selected, website } = metricsForRows(rows, query);
        const support = await supportingTraffic(transaction, query);
        const retainedTrafficFrom = effectiveTrafficCoverageFrom(now, support.earliestTrafficDate);
        const trafficMetricsAvailable = retainedTrafficFrom !== null
          && query.from >= retainedTrafficFrom;
        const trafficBreakdownsAvailable = trafficMetricsAvailable;
        const payments = await paymentBreakdown(transaction, query);
        const previousTraffic = comparisonQuery
          ? await comparisonTraffic(transaction, comparisonQuery)
          : null;
        const channels = addBreakdownRows(rows, query, (row) => {
          const channel = displayChannel(row.channel);
          return [channel, { channel }];
        }, support.channelTraffic, trafficMetricsAvailable).sort((left, right) => right.orders - left.orders
          || (right.sessions ?? 0) - (left.sessions ?? 0)
          || String(left.channel).localeCompare(String(right.channel)));
        const campaigns = addBreakdownRows(rows, query, (row) => {
          const channel = displayChannel(row.channel);
          const source = normalizeAnalyticsDimension(row.source, "source");
          const medium = normalizeAnalyticsDimension(row.medium, "medium");
          const campaign = normalizeAnalyticsDimension(row.campaign, "campaign");
          return [`${channel}\u0000${source}\u0000${medium}\u0000${campaign}`, {
            channel, source, medium, campaign,
          }];
        }, support.campaignTraffic, trafficMetricsAvailable).sort((left, right) => right.orders - left.orders
          || (right.pageViews ?? 0) - (left.pageViews ?? 0)
          || String(left.campaign).localeCompare(String(right.campaign)));
        const markets = addBreakdownRows(rows, query, (row) => [row.market, {
          market: row.market,
        }], undefined, false, false).filter((row) => row.market === "NZ" || row.market === "AU")
          .sort((left, right) => String(left.market).localeCompare(String(right.market)));
        const retainedTraffic = trafficMetricsAvailable ? support.traffic : null;
        const kpis = freezeMetrics(selected, website, retainedTraffic);
        const websiteMetrics = freezeMetrics(website, website, retainedTraffic);
        const hasCurrentDay = query.from <= today && query.to >= today;
        const notices = [
          Object.freeze({
            code: "page_metrics_unavailable",
            message: "Page entrances, exits and conversion assists are unavailable from the implemented facts.",
          }),
          ...(query.scope === "all_business" ? [Object.freeze({
            code: "all_business_traffic_website_only",
            message: "Traffic and funnel metrics remain Website-only in All Business scope.",
          })] : []),
          ...(!trafficMetricsAvailable
            ? [Object.freeze({
                code: "traffic_retention_limited",
                message: retainedTrafficFrom
                  ? `Exact Visitor and Session metrics are unavailable before ${retainedTrafficFrom}, the effective retained raw traffic coverage boundary.`
                  : "Exact Visitor and Session metrics are unavailable because no retained raw traffic coverage exists.",
              })]
            : []),
          ...(!trafficBreakdownsAvailable
            ? [Object.freeze({
                code: "traffic_breakdowns_unavailable",
                message: retainedTrafficFrom
                  ? `Top Pages and Country Traffic are unavailable because the selected range begins before ${retainedTrafficFrom}, the effective retained raw traffic coverage boundary.`
                  : "Top Pages and Country Traffic are unavailable because no retained raw traffic coverage exists.",
              })]
            : []),
        ];
        return Object.freeze({
          filters: Object.freeze({
            preset: query.preset,
            from: query.from,
            to: query.to,
            scope: query.scope,
            market: query.market,
            currency: query.currency,
            attribution: query.attribution,
            granularity: query.granularity,
            resolvedGranularity: query.resolvedGranularity,
            compare: query.compare,
            includeInternal: query.includeInternal,
            canonicalQuery: query.canonicalQuery,
          }),
          kpis,
          comparison: comparisonQuery && comparisonRows
            ? Object.freeze({
                range: Object.freeze({
                  from: comparisonQuery.from,
                  to: comparisonQuery.to,
                }),
                kpis: (() => {
                  const comparisonMetrics = metricsForRows(comparisonRows, comparisonQuery);
                  const comparisonTrafficAvailable = retainedTrafficFrom !== null
                    && comparisonQuery.from >= retainedTrafficFrom;
                  return freezeMetrics(
                    comparisonMetrics.selected,
                    comparisonMetrics.website,
                    comparisonTrafficAvailable ? previousTraffic : null,
                  );
                })(),
              })
            : null,
          timeseries: Object.freeze(timeSeries(
            rows,
            query,
            support.trafficByBucket,
            retainedTrafficFrom,
          )),
          funnel: Object.freeze({
            scope: "website" as const,
            sessions: websiteMetrics.sessions,
            inquiries: websiteMetrics.inquiries,
            orders: websiteMetrics.orders,
            paidOrders: websiteMetrics.paidOrders,
          }),
          channels: Object.freeze(channels),
          campaigns: Object.freeze(campaigns),
          pages: Object.freeze({
            items: Object.freeze(trafficBreakdownsAvailable ? support.pages : []),
            available: trafficBreakdownsAvailable,
            coverageFrom: retainedTrafficFrom,
            unavailableMetrics: Object.freeze(["entrances", "exits", "assists"] as const),
          }),
          payments: Object.freeze(payments),
          markets: Object.freeze(markets),
          countries: Object.freeze(trafficBreakdownsAvailable ? support.countries : []),
          notices: Object.freeze(notices),
          metadata: Object.freeze({
            timezone: "Pacific/Auckland" as const,
            trafficScope: "website" as const,
            aggregateThrough: aggregateThrough(query, today),
            rawDates: Object.freeze(hasCurrentDay ? [today] : []),
            earliestTrafficDate: support.earliestTrafficDate,
            trafficCoverageFrom: retainedTrafficFrom,
            trafficMetricsAvailable,
            trafficBreakdownsAvailable,
            generatedAt: now.toISOString(),
          }),
        });
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
    async listOrders(query: WebsiteAnalyticsV2Query) {
      const offset = (query.page - 1) * query.pageSize;
      return database.transaction(async (transaction) => {
        const result = await transaction.execute<OrdersResultRow>(sql`
          with base as (
            select
              conversions.id::text as "conversionId",
              case when conversions.scope = 'website' then 'website' else 'manual' end as source,
              conversions.order_id::text as "orderId",
              conversions.production_job_id::text as "productionJobId",
              coalesce(website_orders.order_number, manual_jobs.job_number, conversions.source_id)
                as reference,
              conversions.occurred_at as "occurredAt",
              conversions.local_date::text as "localDate",
              conversions.market::text as market,
              conversions.currency::text as currency,
              conversions.ordered_amount_incl_gst_cents::bigint as "orderedAmountCents",
              coalesce(financial.collected, 0)::bigint as "collectedAmountCents",
              coalesce(financial.refunded, 0)::bigint as "refundedAmountCents",
              (coalesce(financial.collected, 0) - coalesce(financial.refunded, 0))::bigint
                as "netCollectedAmountCents",
              ${analyticsPaymentStatusSql({
                orderedAmountCents: sql`conversions.ordered_amount_incl_gst_cents`,
                collectedCents: sql`coalesce(financial.collected, 0)`,
                refundedCents: sql`coalesce(financial.refunded, 0)`,
              })} as "paymentStatus",
              snapshots.channel::text as channel,
              snapshots.source::text as "attributionSource",
              coalesce(nullif(trim(snapshots.medium), ''), ${ANALYTICS_DIMENSION_SENTINELS.notSet})::text
                as medium,
              coalesce(nullif(trim(snapshots.campaign), ''), ${ANALYTICS_DIMENSION_SENTINELS.notSet})::text
                as campaign,
              conversions.historical
            from website_analytics_conversions conversions
            inner join website_analytics_attribution_snapshots snapshots
              on snapshots.conversion_id = conversions.id
              and snapshots.attribution_model = ${query.attribution}
            left join orders website_orders on website_orders.id = conversions.order_id
            left join production_jobs manual_jobs on manual_jobs.id = conversions.production_job_id
            left join lateral (
              select
                coalesce(sum(events.amount_cents)
                  filter (where events.event_type = 'receipt'), 0)::bigint as collected,
                coalesce(sum(events.amount_cents)
                  filter (where events.event_type in ('refund', 'reversal')), 0)::bigint as refunded
              from website_analytics_financial_events events
              where (
                events.conversion_id = conversions.id
                or (events.conversion_id is null and events.order_id is not null
                  and events.order_id = conversions.order_id)
                or (events.conversion_id is null and events.production_job_id is not null
                  and events.production_job_id = conversions.production_job_id)
              ) and events.occurred_at < ${query.end}
            ) financial on true
            where conversions.conversion_type = 'order'
              and conversions.local_date between ${query.from}::date and ${query.to}::date
              and (${query.scope}::text = 'all_business' or conversions.scope = 'website')
              and (${query.market}::text is null or conversions.market = ${query.market}::text)
              and (${query.currency}::text is null or conversions.currency = ${query.currency}::text)
              and (${query.includeInternal}::boolean or not conversions.is_internal)
          ), numbered as (
            select base.*, row_number() over (order by ${orderSortSql[query.sort]}) as ordinal
            from base
          ), page_rows as (
            select * from numbered order by ordinal limit ${query.pageSize} offset ${offset}
          )
          select
            (select count(*)::int from base) as total,
            coalesce(jsonb_agg(jsonb_build_object(
              'conversionId', "conversionId",
              'source', source,
              'orderId', "orderId",
              'productionJobId', "productionJobId",
              'reference', reference,
              'occurredAt', "occurredAt",
              'localDate', "localDate",
              'market', market,
              'currency', currency,
              'orderedAmountCents', "orderedAmountCents",
              'collectedAmountCents', "collectedAmountCents",
              'refundedAmountCents', "refundedAmountCents",
              'netCollectedAmountCents', "netCollectedAmountCents",
              'paymentStatus', "paymentStatus",
              'historical', historical,
              'channel', channel,
              'attributionSource', "attributionSource",
              'medium', medium,
              'campaign', campaign
            ) order by ordinal), '[]'::jsonb) as items
          from page_rows
        `);
        const row = result.rows[0];
        const total = safeNumber(row?.total ?? 0);
        const rawItems = Array.isArray(row?.items) ? row.items : [];
        const items = rawItems.map((value) => {
          const item = value as Record<string, unknown>;
          const source = item.source === "manual" ? "manual" as const : "website" as const;
          const orderId = typeof item.orderId === "string" ? item.orderId : null;
          const productionJobId = typeof item.productionJobId === "string"
            ? item.productionJobId
            : null;
          return Object.freeze({
            conversionId: String(item.conversionId),
            source,
            orderId,
            productionJobId,
            reference: String(item.reference),
            occurredAt: String(item.occurredAt),
            localDate: String(item.localDate),
            market: String(item.market) as "NZ" | "AU",
            currency: String(item.currency) as WebsiteAnalyticsCurrency,
            orderedAmountCents: safeNumber(item.orderedAmountCents),
            collectedAmountCents: safeNumber(item.collectedAmountCents),
            refundedAmountCents: safeNumber(item.refundedAmountCents),
            netCollectedAmountCents: safeNumber(item.netCollectedAmountCents),
            paymentStatus: String(item.paymentStatus) as "paid" | "partial" | "unpaid" | "refunded",
            historical: item.historical === true,
            adminHref: source === "website" && orderId
              ? `/admin/orders/${encodeURIComponent(orderId)}`
              : source === "manual" && productionJobId
                ? `/admin/jobs/${encodeURIComponent(productionJobId)}`
                : null,
            attribution: Object.freeze({
              channel: displayChannel(String(item.channel)),
              source: normalizeAnalyticsDimension(String(item.attributionSource), "source"),
              medium: normalizeAnalyticsDimension(String(item.medium), "medium"),
              campaign: normalizeAnalyticsDimension(String(item.campaign), "campaign"),
            }),
          });
        });
        return Object.freeze({
          items: Object.freeze(items),
          total,
          page: query.page,
          pageSize: query.pageSize,
          pageCount: total === 0 ? 0 : Math.ceil(total / query.pageSize),
        });
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  });
}

export function getWebsiteAnalyticsV2Dashboard() {
  return createWebsiteAnalyticsV2Dashboard(getDatabase());
}
