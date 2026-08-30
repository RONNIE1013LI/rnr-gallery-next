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

function freezeMetrics(metrics: MutableMetrics) {
  return Object.freeze({
    visitors: metrics.visitors,
    sessions: metrics.sessions,
    pageViews: metrics.pageViews,
    inquiries: metrics.inquiries,
    orders: metrics.orders,
    paidOrders: metrics.paidOrders,
    inquiryConversionRate: rate(metrics.inquiries, metrics.sessions),
    orderConversionRate: rate(metrics.orders, metrics.sessions),
    paidOrderConversionRate: rate(metrics.paidOrders, metrics.sessions),
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
) {
  const groups = new Map<string, Breakdown>();
  for (const row of rows) {
    if (isTrafficTotal(row)) continue;
    const [key, dimensions] = keyFor(row);
    const group = groups.get(key) ?? { ...emptyMetrics(), ...dimensions };
    if (isTrafficDimension(row)) addTraffic(group, row);
    if (row.scope === "website") addInquiry(group, row);
    if (row.scope === query.scope && commercialMatches(row, query)) addCommercial(group, row);
    groups.set(key, group);
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
      visitors: row.visitors,
      sessions: row.sessions,
      pageViews: row.pageViews,
      inquiries: row.inquiries,
      orders: row.orders,
      paidOrders: row.paidOrders,
      money: Object.freeze(frozenMoney(row)),
    }));
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function bucketFor(localDate: string, granularity: WebsiteAnalyticsV2Query["resolvedGranularity"]): string {
  if (granularity === "day") return localDate;
  if (granularity === "month") return localDate.slice(0, 7);
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftDate(localDate, -mondayOffset);
}

function timeSeries(rows: readonly AggregateRow[], query: WebsiteAnalyticsV2Query) {
  const grouped = new Map<string, AggregateRow[]>();
  for (const row of rows) {
    const bucket = bucketFor(row.localDate, query.resolvedGranularity);
    const existing = grouped.get(bucket) ?? [];
    existing.push(row);
    grouped.set(bucket, existing);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketRows]) => {
      const { selected } = metricsForRows(bucketRows, query);
      return Object.freeze({ bucket, ...freezeMetrics(selected) });
    });
}

function mapAggregateRow(row: typeof websiteAnalyticsDailyAggregates.$inferSelect): AggregateRow {
  return Object.freeze({
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
    paidOrders: safeNumber(row.paidOrders),
    orderedRevenueCents: safeNumber(row.orderedRevenueCents),
    collectedRevenueCents: safeNumber(row.collectedRevenueCents),
    refundedRevenueCents: safeNumber(row.refundedRevenueCents),
    netCollectedRevenueCents: safeNumber(row.netCollectedRevenueCents),
  });
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
  const prior = stored.map((row) => mapAggregateRow(row as typeof websiteAnalyticsDailyAggregates.$inferSelect));
  if (!hasCurrentDay) return Object.freeze(prior);
  const raw = await createWebsiteAnalyticsV2Reconciliation(
    transaction as unknown as Database,
  ).readRawDailyRows(today);
  return Object.freeze([
    ...prior,
    ...raw.filter((row) => row.attributionModel === query.attribution),
  ]);
}

type SupportRow = Readonly<{
  pages: unknown;
  countries: unknown;
  earliestTrafficDate: unknown;
}>;

async function supportingTraffic(transaction: Transaction, query: WebsiteAnalyticsV2Query) {
  const result = await transaction.execute<SupportRow>(sql`
    with page_rows as (
      select pageviews.pathname,
        count(distinct sessions.visitor_digest)::int as visitors,
        count(pageviews.id)::int as "pageViews"
      from website_analytics_pageviews pageviews
      inner join website_analytics_sessions sessions on sessions.id = pageviews.session_id
      where pageviews.local_date between ${query.from}::date and ${query.to}::date
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
      group by coalesce(sessions.country_code, 'Unknown')
      order by count(pageviews.id) desc, coalesce(sessions.country_code, 'Unknown')
    )
    select
      coalesce((select jsonb_agg(jsonb_build_object(
        'pathname', pathname, 'visitors', visitors, 'pageViews', "pageViews"
      ) order by "pageViews" desc, pathname) from page_rows), '[]'::jsonb) as pages,
      coalesce((select jsonb_agg(jsonb_build_object(
        'countryCode', "countryCode", 'visitors', visitors, 'sessions', sessions,
        'pageViews', "pageViews"
      ) order by "pageViews" desc, "countryCode") from country_rows), '[]'::jsonb) as countries,
      (select min(local_date)::text from website_analytics_sessions) as "earliestTrafficDate"
  `);
  const row = result.rows[0];
  return {
    pages: Array.isArray(row?.pages) ? row.pages : [],
    countries: Array.isArray(row?.countries) ? row.countries : [],
    earliestTrafficDate: typeof row?.earliestTrafficDate === "string"
      ? row.earliestTrafficDate
      : null,
  };
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
      group by conversions.id, conversions.ordered_amount_incl_gst_cents
    ), statuses as (
      select case
        when refunded > 0 then 'refunded'
        when collected - refunded >= ordered then 'paid'
        when collected > 0 then 'partial'
        else 'unpaid'
      end as status
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
        const rows = await aggregateRows(transaction, query, today);
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
          ? await aggregateRows(transaction, comparisonQuery, today)
          : null;
        const [{ selected, website }, support, payments] = await Promise.all([
          Promise.resolve(metricsForRows(rows, query)),
          supportingTraffic(transaction, query),
          paymentBreakdown(transaction, query),
        ]);
        const channels = addBreakdownRows(rows, query, (row) => {
          const channel = displayChannel(row.channel);
          return [channel, { channel }];
        }).sort((left, right) => right.orders - left.orders
          || right.sessions - left.sessions
          || String(left.channel).localeCompare(String(right.channel)));
        const campaigns = addBreakdownRows(rows, query, (row) => {
          const channel = displayChannel(row.channel);
          const source = normalizeAnalyticsDimension(row.source, "source");
          const medium = normalizeAnalyticsDimension(row.medium, "medium");
          const campaign = normalizeAnalyticsDimension(row.campaign, "campaign");
          return [`${channel}\u0000${source}\u0000${medium}\u0000${campaign}`, {
            channel, source, medium, campaign,
          }];
        }).sort((left, right) => right.orders - left.orders
          || right.pageViews - left.pageViews
          || String(left.campaign).localeCompare(String(right.campaign)));
        const markets = addBreakdownRows(rows, query, (row) => [row.market, {
          market: row.market,
        }]).filter((row) => row.market === "NZ" || row.market === "AU")
          .sort((left, right) => String(left.market).localeCompare(String(right.market)));
        const kpis = freezeMetrics(selected);
        const websiteMetrics = freezeMetrics(website);
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
          ...(support.earliestTrafficDate && query.from < support.earliestTrafficDate
            ? [Object.freeze({
                code: "traffic_retention_limited",
                message: `Raw traffic detail begins ${support.earliestTrafficDate}; older attribution detail is unavailable.`,
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
            canonicalQuery: query.canonicalQuery,
          }),
          kpis,
          comparison: comparisonQuery && comparisonRows
            ? Object.freeze({
                range: Object.freeze({
                  from: comparisonQuery.from,
                  to: comparisonQuery.to,
                }),
                kpis: freezeMetrics(metricsForRows(comparisonRows, comparisonQuery).selected),
              })
            : null,
          timeseries: Object.freeze(timeSeries(rows, query)),
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
            items: Object.freeze(support.pages),
            unavailableMetrics: Object.freeze(["entrances", "exits", "assists"] as const),
          }),
          payments: Object.freeze(payments),
          markets: Object.freeze(markets),
          countries: Object.freeze(support.countries),
          notices: Object.freeze(notices),
          metadata: Object.freeze({
            timezone: "Pacific/Auckland" as const,
            trafficScope: "website" as const,
            aggregateThrough: aggregateThrough(query, today),
            rawDates: Object.freeze(hasCurrentDay ? [today] : []),
            earliestTrafficDate: support.earliestTrafficDate,
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
              case
                when coalesce(financial.refunded, 0) > 0 then 'refunded'
                when coalesce(financial.collected, 0) - coalesce(financial.refunded, 0)
                  >= conversions.ordered_amount_incl_gst_cents then 'paid'
                when coalesce(financial.collected, 0) > 0 then 'partial'
                else 'unpaid'
              end as "paymentStatus",
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
