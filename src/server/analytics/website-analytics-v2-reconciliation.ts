import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  ANALYTICS_DIMENSION_SENTINELS,
  type WebsiteAnalyticsAttributionModel,
  type WebsiteAnalyticsScope,
} from "@/domain/analytics/website-analytics-v2";
import type { getDatabase } from "@/server/db/client";
import {
  websiteAnalyticsDailyAggregates,
  websiteAnalyticsReconciliationState,
} from "@/server/db/schema";
import { analyticsDateRange } from "./website-analytics-date-range";
import {
  createWebsiteAnalyticsV2Backfill,
  type WebsiteAnalyticsV2BackfillSource,
} from "./website-analytics-v2-backfill";
import { createWebsiteAnalyticsV2Repository } from "./website-analytics-v2-repository";
import { websiteAnalyticsLocalDate } from "./website-local-date";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type WebsiteAnalyticsV2DailyAggregateRow = Readonly<{
  localDate: string;
  scope: WebsiteAnalyticsScope;
  market: string;
  currency: string;
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  attributionModel: WebsiteAnalyticsAttributionModel;
  visitors: number;
  sessions: number;
  pageViews: number;
  inquiries: number;
  orders: number;
  paidOrders: number;
  orderedRevenueCents: number;
  collectedRevenueCents: number;
  refundedRevenueCents: number;
  netCollectedRevenueCents: number;
}>;

type RawAggregateResult = Readonly<Record<string, unknown>>;

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

function validLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function shiftLocalDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Analytics aggregate exceeds safe integer range");
  return parsed;
}

function mapRawRow(row: RawAggregateResult): WebsiteAnalyticsV2DailyAggregateRow {
  return Object.freeze({
    localDate: String(row.localDate),
    scope: String(row.scope) as WebsiteAnalyticsScope,
    market: String(row.market),
    currency: String(row.currency),
    channel: String(row.channel),
    source: String(row.source),
    medium: String(row.medium),
    campaign: String(row.campaign),
    attributionModel: String(row.attributionModel) as WebsiteAnalyticsAttributionModel,
    visitors: numberValue(row.visitors),
    sessions: numberValue(row.sessions),
    pageViews: numberValue(row.pageViews),
    inquiries: numberValue(row.inquiries),
    orders: numberValue(row.orders),
    paidOrders: numberValue(row.paidOrders),
    orderedRevenueCents: numberValue(row.orderedRevenueCents),
    collectedRevenueCents: numberValue(row.collectedRevenueCents),
    refundedRevenueCents: numberValue(row.refundedRevenueCents),
    netCollectedRevenueCents: numberValue(row.netCollectedRevenueCents),
  });
}

async function readRawDailyRowsFrom(
  executor: Database | Transaction,
  localDate: string,
): Promise<readonly WebsiteAnalyticsV2DailyAggregateRow[]> {
  if (!validLocalDate(localDate)) throw new Error("Invalid analytics aggregate local date");
  const result = await executor.execute<RawAggregateResult>(sql`
    with models(attribution_model) as (
      values ('first_touch'::text), ('last_touch'::text)
    ),
    traffic_dimensions as (
      select
        pageviews.local_date as "localDate",
        'website'::text as scope,
        'Unattributed'::text as market,
        '(not set)'::text as currency,
        sessions.channel::text as channel,
        coalesce(nullif(trim(sessions.source), ''), 'Unattributed')::text as source,
        coalesce(nullif(trim(sessions.medium), ''), '(not set)')::text as medium,
        coalesce(nullif(trim(sessions.utm_campaign), ''), '(not set)')::text as campaign,
        models.attribution_model as "attributionModel",
        count(distinct sessions.visitor_digest)::bigint as visitors,
        count(distinct sessions.id)::bigint as sessions,
        count(pageviews.id)::bigint as "pageViews",
        0::bigint as inquiries,
        0::bigint as orders,
        0::bigint as "paidOrders",
        0::bigint as "orderedRevenueCents",
        0::bigint as "collectedRevenueCents",
        0::bigint as "refundedRevenueCents"
      from website_analytics_sessions sessions
      inner join website_analytics_pageviews pageviews on pageviews.session_id = sessions.id
      cross join models
      where pageviews.local_date = ${localDate}::date
      group by 1, 2, 3, 4, 5, 6, 7, 8, 9
    ),
    traffic_totals as (
      select
        pageviews.local_date as "localDate",
        'website'::text as scope,
        'Unattributed'::text as market,
        '(not set)'::text as currency,
        ${ANALYTICS_DIMENSION_SENTINELS.total}::text as channel,
        ${ANALYTICS_DIMENSION_SENTINELS.total}::text as source,
        ${ANALYTICS_DIMENSION_SENTINELS.total}::text as medium,
        ${ANALYTICS_DIMENSION_SENTINELS.total}::text as campaign,
        models.attribution_model as "attributionModel",
        count(distinct sessions.visitor_digest)::bigint as visitors,
        count(distinct sessions.id)::bigint as sessions,
        count(pageviews.id)::bigint as "pageViews",
        0::bigint as inquiries,
        0::bigint as orders,
        0::bigint as "paidOrders",
        0::bigint as "orderedRevenueCents",
        0::bigint as "collectedRevenueCents",
        0::bigint as "refundedRevenueCents"
      from website_analytics_sessions sessions
      inner join website_analytics_pageviews pageviews on pageviews.session_id = sessions.id
      cross join models
      where pageviews.local_date = ${localDate}::date
      group by 1, 2, 3, 4, 5, 6, 7, 8, 9
    ),
    traffic as (
      select * from traffic_dimensions
      union all select * from traffic_totals
    ),
    conversion_metrics as (
      select
        conversions.local_date as "localDate",
        scopes.scope,
        coalesce(conversions.market::text, 'Unattributed') as market,
        coalesce(conversions.currency::text, '(not set)') as currency,
        snapshots.channel::text as channel,
        coalesce(nullif(trim(snapshots.source), ''), 'Unattributed')::text as source,
        coalesce(nullif(trim(snapshots.medium), ''), '(not set)')::text as medium,
        coalesce(nullif(trim(snapshots.campaign), ''), '(not set)')::text as campaign,
        snapshots.attribution_model::text as "attributionModel",
        0::bigint as visitors,
        0::bigint as sessions,
        0::bigint as "pageViews",
        count(*) filter (where conversions.conversion_type = 'inquiry')::bigint as inquiries,
        count(*) filter (where conversions.conversion_type = 'order')::bigint as orders,
        0::bigint as "paidOrders",
        coalesce(sum(conversions.ordered_amount_incl_gst_cents)
          filter (where conversions.conversion_type = 'order'), 0)::bigint
          as "orderedRevenueCents",
        0::bigint as "collectedRevenueCents",
        0::bigint as "refundedRevenueCents"
      from website_analytics_conversions conversions
      inner join website_analytics_attribution_snapshots snapshots
        on snapshots.conversion_id = conversions.id
      cross join lateral (
        select 'website'::text as scope where conversions.scope = 'website'
        union all
        select 'all_business'::text where conversions.conversion_type = 'order'
      ) scopes
      where conversions.local_date = ${localDate}::date
      group by 1, 2, 3, 4, 5, 6, 7, 8, 9
    ),
    linked_financial as (
      select financial.*, conversions.id as linked_conversion_id,
        conversions.scope as conversion_scope,
        conversions.ordered_amount_incl_gst_cents
      from website_analytics_financial_events financial
      inner join website_analytics_conversions conversions on
        conversions.id = financial.conversion_id
        or (financial.conversion_id is null and financial.order_id is not null
          and conversions.order_id = financial.order_id)
        or (financial.conversion_id is null and financial.production_job_id is not null
          and conversions.production_job_id = financial.production_job_id)
    ),
    financial_metrics as (
      select
        financial.local_date as "localDate",
        scopes.scope,
        case when financial.currency = 'AUD' then 'AU' else 'NZ' end::text as market,
        financial.currency::text as currency,
        snapshots.channel::text as channel,
        coalesce(nullif(trim(snapshots.source), ''), 'Unattributed')::text as source,
        coalesce(nullif(trim(snapshots.medium), ''), '(not set)')::text as medium,
        coalesce(nullif(trim(snapshots.campaign), ''), '(not set)')::text as campaign,
        snapshots.attribution_model::text as "attributionModel",
        0::bigint as visitors,
        0::bigint as sessions,
        0::bigint as "pageViews",
        0::bigint as inquiries,
        0::bigint as orders,
        0::bigint as "paidOrders",
        0::bigint as "orderedRevenueCents",
        coalesce(sum(financial.amount_cents)
          filter (where financial.event_type = 'receipt'), 0)::bigint
          as "collectedRevenueCents",
        coalesce(sum(financial.amount_cents)
          filter (where financial.event_type in ('refund', 'reversal')), 0)::bigint
          as "refundedRevenueCents"
      from linked_financial financial
      inner join website_analytics_attribution_snapshots snapshots
        on snapshots.conversion_id = financial.linked_conversion_id
      cross join lateral (
        select 'website'::text as scope where financial.conversion_scope = 'website'
        union all select 'all_business'::text
      ) scopes
      where financial.local_date = ${localDate}::date
      group by 1, 2, 3, 4, 5, 6, 7, 8, 9
    ),
    combined as (
      select * from traffic
      union all select * from conversion_metrics
      union all select * from financial_metrics
    )
    select
      "localDate", scope, market, currency, channel, source, medium, campaign,
      "attributionModel",
      sum(visitors)::bigint as visitors,
      sum(sessions)::bigint as sessions,
      sum("pageViews")::bigint as "pageViews",
      sum(inquiries)::bigint as inquiries,
      sum(orders)::bigint as orders,
      sum("paidOrders")::bigint as "paidOrders",
      sum("orderedRevenueCents")::bigint as "orderedRevenueCents",
      sum("collectedRevenueCents")::bigint as "collectedRevenueCents",
      sum("refundedRevenueCents")::bigint as "refundedRevenueCents",
      (sum("collectedRevenueCents") - sum("refundedRevenueCents"))::bigint
        as "netCollectedRevenueCents"
    from combined
    group by "localDate", scope, market, currency, channel, source, medium, campaign,
      "attributionModel"
    order by scope, market, currency, channel, source, medium, campaign, "attributionModel"
  `);
  return Object.freeze(result.rows.map(mapRawRow));
}

function safeLimit(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum}`);
  }
  return value;
}

export function createWebsiteAnalyticsV2Reconciliation(database: Database) {
  const repository = createWebsiteAnalyticsV2Repository(database);

  async function readRawDailyRows(localDate: string) {
    return readRawDailyRowsFrom(database, localDate);
  }

  async function readAggregateDailyRows(localDate: string) {
    if (!validLocalDate(localDate)) throw new Error("Invalid analytics aggregate local date");
    const rows = await database.select(aggregateFields).from(websiteAnalyticsDailyAggregates)
      .where(eq(websiteAnalyticsDailyAggregates.localDate, localDate))
      .orderBy(
        asc(websiteAnalyticsDailyAggregates.scope),
        asc(websiteAnalyticsDailyAggregates.market),
        asc(websiteAnalyticsDailyAggregates.currency),
        asc(websiteAnalyticsDailyAggregates.channel),
        asc(websiteAnalyticsDailyAggregates.source),
        asc(websiteAnalyticsDailyAggregates.medium),
        asc(websiteAnalyticsDailyAggregates.campaign),
        asc(websiteAnalyticsDailyAggregates.attributionModel),
      );
    return Object.freeze(rows.map((row) => Object.freeze(row)));
  }

  async function rebuildOneDirtyDate(
    localDate?: string,
  ): Promise<"rebuilt" | "busy" | "empty"> {
    if (localDate && !validLocalDate(localDate)) {
      throw new Error("Invalid analytics aggregate local date");
    }
    return database.transaction(async (transaction) => {
      const [state] = await transaction.select({
        id: websiteAnalyticsReconciliationState.id,
        localDate: websiteAnalyticsReconciliationState.localDate,
      }).from(websiteAnalyticsReconciliationState).where(and(
        eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
        inArray(websiteAnalyticsReconciliationState.status, ["pending", "failed"]),
        localDate ? eq(websiteAnalyticsReconciliationState.localDate, localDate) : undefined,
      )).orderBy(asc(websiteAnalyticsReconciliationState.localDate))
        .for("update", { skipLocked: true }).limit(1);
      if (!state?.localDate) {
        const pending = await transaction.select({ id: websiteAnalyticsReconciliationState.id })
          .from(websiteAnalyticsReconciliationState).where(and(
            eq(websiteAnalyticsReconciliationState.stateType, "dirty_date"),
            inArray(websiteAnalyticsReconciliationState.status, ["pending", "failed"]),
            localDate ? eq(websiteAnalyticsReconciliationState.localDate, localDate) : undefined,
          )).limit(1);
        return pending.length > 0 ? "busy" : "empty";
      }
      const startedAt = new Date();
      await transaction.update(websiteAnalyticsReconciliationState).set({
        status: "running",
        startedAt,
        completedAt: null,
        lastErrorCode: null,
        updatedAt: startedAt,
      }).where(eq(websiteAnalyticsReconciliationState.id, state.id));
      const rows = await readRawDailyRowsFrom(transaction, state.localDate);
      await transaction.delete(websiteAnalyticsDailyAggregates)
        .where(eq(websiteAnalyticsDailyAggregates.localDate, state.localDate));
      if (rows.length > 0) {
        await transaction.insert(websiteAnalyticsDailyAggregates).values(rows.map((row) => ({
          ...row,
          rulesVersion: "v2",
          updatedAt: new Date(),
        })));
      }
      await transaction.update(websiteAnalyticsReconciliationState).set({
        status: "completed",
        startedAt,
        completedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      }).where(eq(websiteAnalyticsReconciliationState.id, state.id));
      return "rebuilt";
    });
  }

  async function rebuildDirtyDates(input: Readonly<{ limit: number }>) {
    const limit = safeLimit(input.limit, 31, "Analytics dirty-date rebuild limit");
    let rebuilt = 0;
    let busy = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      try {
        const result = await rebuildOneDirtyDate();
        if (result === "empty") break;
        if (result === "busy") {
          busy += 1;
          break;
        }
        rebuilt += 1;
      } catch {
        failed += 1;
        break;
      }
    }
    return Object.freeze({ rebuilt, busy, failed });
  }

  async function rebuildDirtyDate(localDate: string) {
    try {
      const result = await rebuildOneDirtyDate(localDate);
      return Object.freeze({
        rebuilt: result === "rebuilt" ? 1 : 0,
        busy: result === "busy" ? 1 : 0,
        failed: 0,
      });
    } catch {
      return Object.freeze({ rebuilt: 0, busy: 0, failed: 1 });
    }
  }

  async function run(input: Readonly<{
    now?: Date;
    recentDays?: number;
    repairBatchSize?: number;
    maxDirtyDates?: number;
    sources?: readonly WebsiteAnalyticsV2BackfillSource[];
    stateKeyPrefix?: string;
  }> = {}) {
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error("Analytics reconciliation time is invalid");
    const recentDays = safeLimit(input.recentDays ?? 3, 14, "Analytics recent window");
    const repairBatchSize = safeLimit(
      input.repairBatchSize ?? 100,
      500,
      "Analytics repair batch size",
    );
    const maxDirtyDates = safeLimit(
      input.maxDirtyDates ?? 7,
      31,
      "Analytics dirty-date rebuild limit",
    );
    const today = websiteAnalyticsLocalDate(now);
    const from = shiftLocalDate(today, -(recentDays - 1));
    const range = analyticsDateRange({
      preset: "custom",
      from,
      to: today,
      maximumDays: recentDays,
    });
    const repair = await createWebsiteAnalyticsV2Backfill(database).run({
      dryRun: false,
      batchSize: repairBatchSize,
      sources: input.sources,
      stateType: "reconciliation",
      stateKeyPrefix: input.stateKeyPrefix ?? "website-analytics-v2-daily",
      fromOccurredAt: range.start,
      historical: false,
      restartCompleted: true,
    });
    for (let offset = 0; offset < recentDays; offset += 1) {
      await repository.markDirtyDate(shiftLocalDate(from, offset));
    }
    let rebuilt = 0;
    let busy = 0;
    let failed = 0;
    for (let offset = 0; offset < recentDays && rebuilt + busy + failed < maxDirtyDates; offset += 1) {
      const result = await rebuildDirtyDate(shiftLocalDate(from, offset));
      rebuilt += result.rebuilt;
      busy += result.busy;
      failed += result.failed;
    }
    const remaining = maxDirtyDates - rebuilt - busy - failed;
    if (remaining > 0) {
      const queued = await rebuildDirtyDates({ limit: remaining });
      rebuilt += queued.rebuilt;
      busy += queued.busy;
      failed += queued.failed;
    }
    const aggregates = Object.freeze({ rebuilt, busy, failed });
    return Object.freeze({
      repair,
      aggregates,
      recentWindow: Object.freeze({ from, to: today }),
    });
  }

  return Object.freeze({
    readRawDailyRows,
    readAggregateDailyRows,
    rebuildDirtyDate,
    rebuildDirtyDates,
    run,
  });
}
