import { sql, type SQL } from "drizzle-orm";
import type {
  ExplorerConversion, ExplorerFinancialEvent, ExplorerMetadata, ExplorerMoney,
  ExplorerOrderAcquisition, ExplorerQuality, ExplorerSession,
  ExplorerSessionsResponse, ExplorerTouch, ExplorerVisitorResponse,
} from "@/domain/analytics/website-analytics-explorer";
import { attributionHistorySchema } from "@/domain/analytics/attribution-history";
import { WEBSITE_CLICK_ID_TYPES } from "@/domain/analytics/website-analytics";
import { getDatabase } from "@/server/db/client";
import { analyticsPaymentStatus, isPaidOrder, isPaidOrderSql } from "./website-analytics-business-rules";
import type { WebsiteAnalyticsV2Query } from "./website-analytics-v2-query";
import { websiteAnalyticsLocalDate } from "./website-local-date";

type Database = ReturnType<typeof getDatabase>;
type Row = Record<string, unknown>;
const PAGEVIEW_LIMIT = 2000;
const notices = [
  "Traffic uses each session's own acquisition source. Orders and revenue are grouped by the converting session; the attribution selector changes credited dimensions in order detail. Last touch uses the existing last non-direct model.",
  "Pageviews and stage reach use the selected dates. Stage reach is not an ordered funnel. Market and currency filter linked orders, not anonymous traffic.",
  "Single-page classification and duration use the full retained session as of range end. Duration is the span between recorded pageviews, not dwell time. Single-page duration and unrecorded historical Checkout reach are unavailable.",
  "First seen, returning status and journeys use retained raw history only (normally 90 days). Device, browser, OS, city and raw session click IDs were not collected.",
] as const;
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function array(value: unknown): Row[] { return Array.isArray(value) ? value.map(record) : []; }
function number(value: unknown): number { const parsed = Number(value ?? 0); if (!Number.isFinite(parsed)) throw new Error("Invalid analytics number"); return parsed; }
function nullable(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function iso(value: unknown): string { const parsed = new Date(String(value)); if (Number.isNaN(parsed.getTime())) throw new Error("Invalid analytics timestamp"); return parsed.toISOString(); }

export function explorerOrderAcquisition(value: unknown): ExplorerOrderAcquisition {
  const raw = record(value);
  const consent = record(raw.measurement).advertisingConsent === true;
  const history = attributionHistorySchema.safeParse(raw.touches);
  const touch = (value: unknown): ExplorerTouch | null => {
    if (!value) return null;
    const input = record(value); const campaign = record(input.campaign);
    return { at: String(input.at), landingPath: String(input.landingPath), referrerOrigin: nullable(input.referrerOrigin),
      source: nullable(campaign.utm_source), medium: nullable(campaign.utm_medium), campaign: nullable(campaign.utm_campaign) };
  };
  return {
    clickIds: consent ? WEBSITE_CLICK_ID_TYPES.flatMap(type => typeof raw[type] === "string" && raw[type].length > 0 && raw[type].length <= 200
      ? [{ type, value: raw[type] }] : []) : [],
    firstTouch: history.success ? touch(history.data.firstTouch) : null,
    lastTouch: history.success ? touch(history.data.lastTouch) : null,
    lastNonDirectTouch: history.success ? touch(history.data.lastNonDirectTouch) : null,
  };
}
function money(value: unknown): ExplorerMoney[] {
  const grouped = new Map<string, ExplorerMoney>();
  for (const row of array(value)) {
    if (row.currency !== "NZD" && row.currency !== "AUD") continue;
    const previous = grouped.get(row.currency);
    const ordered = number(row.orderedRevenueCents ?? row.ordered);
    const collected = number(row.collectedRevenueCents ?? row.collected);
    const refunded = number(row.refundedRevenueCents ?? row.refunded);
    grouped.set(row.currency, { currency: row.currency,
      orderedRevenueCents: (previous?.orderedRevenueCents ?? 0) + ordered,
      collectedRevenueCents: (previous?.collectedRevenueCents ?? 0) + collected,
      refundedRevenueCents: (previous?.refundedRevenueCents ?? 0) + refunded,
      netCollectedRevenueCents: (previous?.netCollectedRevenueCents ?? 0) + collected - refunded });
  }
  return [...grouped.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
function session(row: Row): ExplorerSession {
  const matched = record(row.matchedPage);
  const count = number(row.pageViews); const observedCount = number(row.sessionPageViews);
  return {
    sessionId: String(row.sessionId), visitorId: String(row.visitorId), startedAt: iso(row.startedAt), lastSeenAt: iso(row.lastSeenAt),
    countryCode: nullable(row.countryCode), channel: String(row.channel), source: nullable(row.source), medium: nullable(row.medium), campaign: nullable(row.campaign), clickIdType: nullable(row.clickIdType),
    entryPage: nullable(row.entryPage), exitPage: nullable(row.exitPage), pageViews: count, sessionPageViews: observedCount,
    observedDurationSeconds: observedCount > 1 ? number(row.observedDurationSeconds) : null, singlePage: observedCount === 1,
    product: row.product === true, cart: row.cart === true, checkout: row.checkout === true ? true : null,
    orders: number(row.orders), paidOrders: number(row.paidOrders), money: money(row.money),
    matchedPage: matched.pathname ? { pathname: String(matched.pathname), occurredAt: iso(matched.occurredAt), previousPage: nullable(matched.previousPage), nextPage: nullable(matched.nextPage) } : null,
  };
}
function quality(row: Row): ExplorerQuality {
  const sessions = number(row.sessions); const pageViews = number(row.pageViews); const single = number(row.singlePageSessions);
  return { visitors: number(row.visitors), sessions, pageViews, pagesPerSession: sessions ? pageViews / sessions : null,
    singlePageSessions: single, multiPageSessions: sessions - single, singlePageRate: sessions ? single / sessions : null,
    observedReturningVisitors: number(row.observedReturningVisitors), observedNewVisitors: number(row.visitors) - number(row.observedReturningVisitors),
    avgObservedDurationSeconds: row.avgObservedDurationSeconds === null || row.avgObservedDurationSeconds === undefined ? null : number(row.avgObservedDurationSeconds),
    productSessions: number(row.productSessions), cartSessions: number(row.cartSessions), checkoutSessions: number(row.checkoutSessions) || null,
    orderSessions: number(row.orderSessions), paidSessions: number(row.paidSessions), orders: number(row.orders), paidOrders: number(row.paidOrders), money: money(row.money) };
}
function metadata(earliest: unknown, query: WebsiteAnalyticsV2Query, now: Date): ExplorerMetadata {
  const cutoff = websiteAnalyticsLocalDate(new Date(now.getTime() - 90 * 86_400_000));
  const followingDay = new Date(`${cutoff}T12:00:00Z`); followingDay.setUTCDate(followingDay.getUTCDate() + 1);
  const theoretical = followingDay.toISOString().slice(0, 10);
  const first = nullable(earliest); const coverageFrom = first ? first > theoretical ? first : theoretical : null;
  return { timezone: "Pacific/Auckland", coverageFrom, completeRange: coverageFrom !== null && query.from >= coverageFrom,
    trafficBasis: "session_acquisition", durationBasis: "first_to_last_recorded_pageview", conversionBasis: "converting_session_as_of_range_end" };
}
function normalizedSource() { return sql`case when sessions.channel = 'other' and lower(trim(sessions.source)) in ('rnrgallery.com','www.rnrgallery.com','rrgallery.co.nz','www.rrgallery.co.nz') and lower(trim(sessions.medium)) = 'referral' and nullif(trim(sessions.utm_campaign),'') is null and sessions.click_id_type is null then true else false end`; }
function pattern(value: string | null) { return value ? `%${value.replace(/[\\%_]/g, "\\$&")}%` : null; }

function sessionCtes(query: WebsiteAnalyticsV2Query, visitorId?: string): SQL {
  const detail = Boolean(visitorId);
  return sql`
    visible_sessions as (
      select sessions.id as "sessionId", sessions.visitor_digest as "visitorId", sessions.started_at as "startedAt",
        sessions.country_code as "countryCode", sessions.click_id_type as "clickIdType",
        case when ${normalizedSource()} then 'direct' else sessions.channel end as channel,
        case when ${normalizedSource()} then 'direct' else sessions.source end as source,
        case when ${normalizedSource()} then null else sessions.medium end as medium,
        sessions.utm_campaign as campaign
      from website_analytics_sessions sessions
      where (${query.includeInternal}::boolean or not sessions.is_internal)
        and (${visitorId ?? query.visitor}::text is null or sessions.visitor_digest = ${visitorId ?? query.visitor})
        and (${query.session}::text is null or sessions.id::text = ${query.session})
    ), cohort as (
      select s.* from visible_sessions s where exists (
        select 1 from website_analytics_pageviews p where p.session_id = s."sessionId"
          and (${detail}::boolean or p.local_date between ${query.from}::date and ${query.to}::date)
          and (${detail}::boolean or ${query.path}::text is null or p.pathname = ${query.path})
      ) and (${detail}::boolean or ${query.channel}::text is null or s.channel = ${query.channel})
        and (${detail}::boolean or ${query.source}::text is null or coalesce(s.source,'(not set)') = ${query.source})
        and (${detail}::boolean or ${query.medium}::text is null or coalesce(s.medium,'(not set)') = ${query.medium})
        and (${detail}::boolean or ${query.campaign}::text is null or coalesce(s.campaign,'(not set)') = ${query.campaign})
    ), ordered_pages as (
      select p.*, lag(p.pathname) over (partition by p.session_id order by p.occurred_at,p.id) as previous_page,
        lead(p.pathname) over (partition by p.session_id order by p.occurred_at,p.id) as next_page
      from website_analytics_pageviews p inner join cohort s on s."sessionId" = p.session_id
      where (${detail}::boolean or p.occurred_at < ${query.end})
    ), page_stats as (
      select p.session_id, count(*)::int as "sessionPageViews",
        count(*) filter (where ${detail}::boolean or p.local_date between ${query.from}::date and ${query.to}::date)::int as "pageViews",
        min(p.occurred_at) as first_at, max(p.occurred_at) as "lastSeenAt",
        (array_agg(p.pathname order by p.occurred_at,p.id))[1] as "entryPage",
        (array_agg(p.pathname order by p.occurred_at desc,p.id desc))[1] as "exitPage",
        extract(epoch from max(p.occurred_at) - min(p.occurred_at))::float8 as "observedDurationSeconds",
        coalesce(bool_or(p.pathname ~ '^(/au)?/products/[^/]+(/configure)?$') filter (where ${detail}::boolean or p.local_date between ${query.from}::date and ${query.to}::date),false) as product,
        coalesce(bool_or(p.pathname in ('/cart','/au/cart')) filter (where ${detail}::boolean or p.local_date between ${query.from}::date and ${query.to}::date),false) as cart,
        coalesce(bool_or(p.pathname in ('/checkout','/checkout/start','/au/checkout','/au/checkout/start')) filter (where ${detail}::boolean or p.local_date between ${query.from}::date and ${query.to}::date),false) as checkout,
        (jsonb_agg(jsonb_build_object('pathname',p.pathname,'occurredAt',p.occurred_at,'previousPage',p.previous_page,'nextPage',p.next_page) order by p.occurred_at,p.id)
          filter (where p.pathname = ${query.path} and p.local_date between ${query.from}::date and ${query.to}::date))->0 as "matchedPage"
      from ordered_pages p group by p.session_id
    ), eligible_conversions as (
      select c.*, o.order_number, o.attribution as order_attribution,
        snap.channel as attribution_channel, snap.source as attribution_source, snap.medium as attribution_medium, snap.campaign as attribution_campaign
      from website_analytics_conversions c inner join cohort s on s."sessionId" = c.converting_session_id and s."visitorId" = c.visitor_digest
      left join orders o on o.id = c.order_id
      left join website_analytics_attribution_snapshots snap on snap.conversion_id = c.id and snap.attribution_model = ${query.attribution}
      where c.conversion_type = 'order' and c.scope = 'website'
        and (${detail}::boolean or c.occurred_at < ${query.end})
        and (${query.includeInternal}::boolean or not c.is_internal)
        and (${query.market}::text is null or c.market = ${query.market})
        and (${query.currency}::text is null or c.currency = ${query.currency})
    ), financial_rows as (
      select f.*, c.id as linked_conversion_id
      from website_analytics_financial_events f inner join eligible_conversions c
        on (f.conversion_id = c.id or (f.conversion_id is null and f.order_id = c.order_id)) and f.currency = c.currency
      where (${detail}::boolean or f.occurred_at < ${query.end})
    ), balances as (
      select c.*, coalesce(sum(f.amount_cents) filter (where f.event_type = 'receipt'),0)::bigint as collected,
        coalesce(sum(f.amount_cents) filter (where f.event_type in ('refund','reversal')),0)::bigint as refunded
      from eligible_conversions c left join financial_rows f on f.linked_conversion_id = c.id
      group by c.id,c.conversion_type,c.source_type,c.source_id,c.order_id,c.production_job_id,c.conversation_id,c.occurred_at,c.local_date,c.scope,c.market,c.currency,c.ordered_amount_incl_gst_cents,c.visitor_digest,c.converting_session_id,c.first_session_id,c.last_session_id,c.last_non_direct_session_id,c.historical,c.consent_linked,c.attribution_version,c.is_internal,c.created_at,c.order_number,c.order_attribution,c.attribution_channel,c.attribution_source,c.attribution_medium,c.attribution_campaign
    ), money_rows as (
      select converting_session_id as session_id,currency,sum(ordered_amount_incl_gst_cents)::bigint as ordered,
        sum(collected)::bigint as collected,sum(refunded)::bigint as refunded
      from balances group by converting_session_id,currency
    ), order_stats as (
      select converting_session_id as session_id,count(*)::int as orders,
        count(*) filter (where ${isPaidOrderSql({ orderedAmountCents: sql`ordered_amount_incl_gst_cents`, collectedCents: sql`collected`, refundedCents: sql`refunded` })})::int as "paidOrders"
      from balances group by converting_session_id
    ), base as (
      select s.*, p."pageViews",p."sessionPageViews",p."lastSeenAt",p."entryPage",p."exitPage",p."observedDurationSeconds",p.product,p.cart,p.checkout,p."matchedPage",
        coalesce(o.orders,0) as orders,coalesce(o."paidOrders",0) as "paidOrders",
        coalesce((select jsonb_agg(to_jsonb(m)) from money_rows m where m.session_id = s."sessionId"),'[]'::jsonb) as money
      from cohort s inner join page_stats p on p.session_id = s."sessionId" left join order_stats o on o.session_id = s."sessionId"
    ), filtered as (
      select b.* from base b where ${detail}::boolean or ${query.q}::text is null
        or b."visitorId" ilike ${pattern(query.q)} or b."sessionId"::text ilike ${pattern(query.q)} or b.campaign ilike ${pattern(query.q)}
        or exists (select 1 from balances o where o.converting_session_id = b."sessionId" and (o.order_number ilike ${pattern(query.q)}
          or (o.order_attribution #>> '{measurement,advertisingConsent}' = 'true' and (
            o.order_attribution->>'gclid' ilike ${pattern(query.q)} or o.order_attribution->>'gbraid' ilike ${pattern(query.q)}
            or o.order_attribution->>'wbraid' ilike ${pattern(query.q)} or o.order_attribution->>'fbclid' ilike ${pattern(query.q)}))))
    ), returning_visitors as (
      select s.visitor_digest from website_analytics_sessions s
      inner join (select distinct "visitorId" from filtered) selected on selected."visitorId" = s.visitor_digest
      where (${query.includeInternal}::boolean or not s.is_internal)
        and (${detail}::boolean or s.started_at < ${query.end})
      group by s.visitor_digest having count(*) > 1
    )`;
}
const qualitySql = sql`count(distinct f."visitorId")::int as visitors,count(*)::int as sessions,coalesce(sum(f."pageViews"),0)::int as "pageViews",
  count(*) filter (where f."sessionPageViews" = 1)::int as "singlePageSessions",
  count(distinct f."visitorId") filter (where r.visitor_digest is not null)::int as "observedReturningVisitors",
  avg(f."observedDurationSeconds") filter (where f."sessionPageViews" > 1)::float8 as "avgObservedDurationSeconds",
  count(*) filter (where f.product)::int as "productSessions",count(*) filter (where f.cart)::int as "cartSessions",
  count(*) filter (where f.checkout)::int as "checkoutSessions",count(*) filter (where f.orders > 0)::int as "orderSessions",
  count(*) filter (where f."paidOrders" > 0)::int as "paidSessions",coalesce(sum(f.orders),0)::int as orders,coalesce(sum(f."paidOrders"),0)::int as "paidOrders",
  coalesce(jsonb_agg(f.money),'[]'::jsonb) as money`;
function qualityRow(row: Row): ExplorerQuality {
  return quality({ ...row, money: Array.isArray(row.money) ? row.money.flat() : [] });
}
const sortSql = {
  started_at_desc: sql`"startedAt" desc,"sessionId" desc`,
  started_at_asc: sql`"startedAt" asc,"sessionId" asc`,
  pageviews_desc: sql`"pageViews" desc,"startedAt" desc,"sessionId" desc`,
  duration_desc: sql`"observedDurationSeconds" desc,"startedAt" desc,"sessionId" desc`,
};

export function createWebsiteAnalyticsExplorer(database: Database) {
  return {
    async listSessions(query: WebsiteAnalyticsV2Query, now = new Date()): Promise<ExplorerSessionsResponse> {
      return database.transaction(async transaction => {
        const result = await transaction.execute(sql`with ${sessionCtes(query)},
          page as (select * from filtered order by ${sortSql[query.trafficSort]} limit ${query.trafficPageSize} offset ${(query.trafficPage - 1) * query.trafficPageSize}),
          summary as (select ${qualitySql} from filtered f left join returning_visitors r on r.visitor_digest = f."visitorId"),
          acquisition as (select f.channel,f.source,f.medium,f.campaign,${qualitySql} from filtered f left join returning_visitors r on r.visitor_digest = f."visitorId" group by f.channel,f.source,f.medium,f.campaign)
          select (select count(*)::int from filtered) as total,
            coalesce((select jsonb_agg(to_jsonb(p) order by ${sortSql[query.trafficSort]}) from page p),'[]'::jsonb) as items,
            (select to_jsonb(s) from summary s) as summary,
            coalesce((select jsonb_agg(to_jsonb(a) order by sessions desc,channel,source,medium,campaign) from acquisition a),'[]'::jsonb) as acquisition,
            (select min(local_date)::text from website_analytics_sessions where ${query.includeInternal}::boolean or not is_internal) as earliest`);
        const row = record(result.rows[0]); const total = number(row.total);
        return { items: array(row.items).map(session), total, page: query.trafficPage, pageSize: query.trafficPageSize, pageCount: Math.ceil(total / query.trafficPageSize),
          summary: qualityRow(record(row.summary)), acquisition: array(row.acquisition).map(item => ({ channel: String(item.channel), source: nullable(item.source), medium: nullable(item.medium), campaign: nullable(item.campaign), ...qualityRow(item) })),
          metadata: metadata(row.earliest, query, now), notices };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
    async visitorDetail(visitorId: string, query: WebsiteAnalyticsV2Query, now = new Date()): Promise<ExplorerVisitorResponse> {
      return database.transaction(async transaction => {
        const result = await transaction.execute(sql`with ${sessionCtes(query, visitorId)},
          page as (select * from filtered order by "startedAt" desc,"sessionId" desc limit ${query.trafficPageSize} offset ${(query.trafficPage - 1) * query.trafficPageSize}),
          numbered_pages as (select p.*,row_number() over (partition by p.session_id order by p.occurred_at,p.id) as ordinal from ordered_pages p inner join page s on s."sessionId" = p.session_id),
          payment_running as (select f.*,sum(case when event_type = 'receipt' then amount_cents else -amount_cents end) over (partition by linked_conversion_id order by occurred_at,id rows unbounded preceding) as balance from financial_rows f),
          detail_orders as (select b.*,(select min(f.occurred_at) from payment_running f where f.linked_conversion_id = b.id and f.balance >= b.ordered_amount_incl_gst_cents) as paid_at from balances b inner join page p on p."sessionId" = b.converting_session_id)
          select (select count(*)::int from filtered) as total,
            (select jsonb_build_object('firstSeenAt',min(s.started_at),'lastSeenAt',max(p.occurred_at),'sessionCount',count(distinct s.id))
              from website_analytics_sessions s inner join website_analytics_pageviews p on p.session_id = s.id
              where s.visitor_digest = ${visitorId} and (${query.includeInternal}::boolean or not s.is_internal)) as visitor,
            coalesce((select jsonb_agg(to_jsonb(p) order by "startedAt" desc,"sessionId" desc) from page p),'[]'::jsonb) as items,
            coalesce((select jsonb_agg(jsonb_build_object('id',id,'sessionId',session_id,'occurredAt',occurred_at,'pathname',pathname,'previousPage',previous_page,'nextPage',next_page) order by session_id,occurred_at,id) from numbered_pages where ordinal <= ${PAGEVIEW_LIMIT}),'[]'::jsonb) as pages,
            coalesce((select jsonb_agg(to_jsonb(o)) from detail_orders o),'[]'::jsonb) as orders,
            coalesce((select jsonb_agg(to_jsonb(f)) from financial_rows f inner join page p on p."sessionId" = (select converting_session_id from eligible_conversions c where c.id = f.linked_conversion_id)),'[]'::jsonb) as financial,
            (select min(local_date)::text from website_analytics_sessions where ${query.includeInternal}::boolean or not is_internal) as earliest`);
        const row = record(result.rows[0]); const total = number(row.total); const visitor = record(row.visitor);
        const orders = array(row.orders); const pages = array(row.pages); const financial = array(row.financial);
        return { visitor: number(visitor.sessionCount) > 0 ? { visitorId, firstSeenAt: iso(visitor.firstSeenAt), lastSeenAt: iso(visitor.lastSeenAt), sessionCount: number(visitor.sessionCount), observedReturning: number(visitor.sessionCount) > 1 } : null,
          sessions: array(row.items).map(item => {
            const basic = session(item); const ownOrders = orders.filter(order => order.converting_session_id === basic.sessionId);
            const ids = new Set(ownOrders.map(order => order.id));
            return { ...basic,
              pageviews: pages.filter(page => page.sessionId === basic.sessionId).map(page => ({ id: String(page.id), occurredAt: iso(page.occurredAt), pathname: String(page.pathname), previousPage: nullable(page.previousPage), nextPage: nullable(page.nextPage) })),
              pageviewsTotal: basic.pageViews, pageviewsTruncated: basic.pageViews > PAGEVIEW_LIMIT,
              conversions: ownOrders.map(order => conversion(order, query)),
              financialEvents: financial.filter(event => ids.has(event.linked_conversion_id)).map(financialEvent),
            };
          }), total, page: query.trafficPage, pageSize: query.trafficPageSize, pageCount: Math.ceil(total / query.trafficPageSize), truncated: total > query.trafficPageSize,
          metadata: { ...metadata(row.earliest, query, now), conversionBasis: "converting_session_current_history" }, notices: [...notices, "Visitor detail shows all retained history. Order status and payment events are current retained facts; the date filter selects the explorer cohort, not this historical detail."] };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
  };
}
function conversion(row: Row, query: WebsiteAnalyticsV2Query): ExplorerConversion {
  const ordered = number(row.ordered_amount_incl_gst_cents); const collected = number(row.collected); const refunded = number(row.refunded);
  const orderId = nullable(row.order_id);
  return { conversionId: String(row.id), orderId, orderNumber: nullable(row.order_number) ?? String(row.source_id), adminHref: orderId ? `/admin/orders/${encodeURIComponent(orderId)}` : null,
    occurredAt: iso(row.occurred_at), orderedAmountCents: ordered, currency: row.currency === "AUD" ? "AUD" : "NZD",
    paymentStatus: analyticsPaymentStatus({ orderedAmountCents: ordered, collectedCents: collected, refundedCents: refunded }),
    paidAt: isPaidOrder({ orderedAmountCents: ordered, collectedCents: collected, refundedCents: refunded }) && row.paid_at ? iso(row.paid_at) : null,
    attribution: { model: query.attribution, channel: nullable(row.attribution_channel) ?? "Unattributed", source: nullable(row.attribution_source), medium: nullable(row.attribution_medium), campaign: nullable(row.attribution_campaign) },
    orderAcquisition: explorerOrderAcquisition(row.order_attribution) };
}
function financialEvent(row: Row): ExplorerFinancialEvent {
  return { id: String(row.id), orderId: nullable(row.order_id), occurredAt: iso(row.occurred_at), type: row.event_type === "refund" ? "refund" : row.event_type === "reversal" ? "reversal" : "receipt", amountCents: number(row.amount_cents), currency: row.currency === "AUD" ? "AUD" : "NZD" };
}
export function getWebsiteAnalyticsExplorer() { return createWebsiteAnalyticsExplorer(getDatabase()); }
