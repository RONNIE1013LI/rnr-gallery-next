"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WebsiteAnalyticsV2Charts, formatAnalyticsMoney } from "./website-analytics-v2-charts";
import { WebsiteAnalyticsV2Filters } from "./website-analytics-v2-filters";
import { WebsiteAnalyticsV2Orders } from "./website-analytics-v2-orders";
import adminStyles from "./admin.module.css";
import styles from "./website-analytics-v2.module.css";

export type WebsiteAnalyticsV2Money = Readonly<{
  currency: "NZD" | "AUD";
  orderedRevenueCents: number;
  collectedRevenueCents: number;
  refundedRevenueCents: number;
  netCollectedRevenueCents: number;
  orderedAovCents: number | null;
}>;

export type WebsiteAnalyticsV2CountMetrics = Readonly<{
  visitors: number | null;
  sessions: number | null;
  pageViews: number;
  inquiries: number;
  orders: number;
  paidOrders: number;
  money: readonly WebsiteAnalyticsV2Money[];
}>;

export type WebsiteAnalyticsV2Metrics = WebsiteAnalyticsV2CountMetrics & Readonly<{
  inquiryConversionRate: number | null;
  orderConversionRate: number | null;
  paidOrderConversionRate: number | null;
}>;

export type WebsiteAnalyticsV2Breakdown = Omit<WebsiteAnalyticsV2CountMetrics, "pageViews"> & Readonly<{
  pageViews: number | null;
  channel?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  market?: string;
}>;

export type WebsiteAnalyticsV2DashboardData = Readonly<{
  filters: Readonly<{
    preset: string;
    from: string;
    to: string;
    scope: "website" | "all_business";
    market: "NZ" | "AU" | null;
    currency: "NZD" | "AUD" | null;
    attribution: "first_touch" | "last_touch";
    granularity: "auto" | "day" | "week" | "month";
    resolvedGranularity: "day" | "week" | "month";
    compare: boolean;
    canonicalQuery: string;
  }>;
  kpis: WebsiteAnalyticsV2Metrics;
  comparison: Readonly<{
    range: Readonly<{ from: string; to: string }>;
    kpis: WebsiteAnalyticsV2Metrics;
  }> | null;
  timeseries: readonly (WebsiteAnalyticsV2Metrics & Readonly<{ bucket: string }>)[];
  funnel: Readonly<{
    scope: "website";
    sessions: number | null;
    inquiries: number;
    orders: number;
    paidOrders: number;
  }>;
  channels: readonly WebsiteAnalyticsV2Breakdown[];
  campaigns: readonly WebsiteAnalyticsV2Breakdown[];
  pages: Readonly<{
    items: readonly Readonly<{ pathname: string; visitors: number; pageViews: number }>[];
    available: boolean;
    coverageFrom: string | null;
    unavailableMetrics: readonly ("entrances" | "exits" | "assists")[];
  }>;
  payments: readonly Readonly<{
    status: "paid" | "partial" | "unpaid" | "refunded";
    orders: number;
  }>[];
  markets: readonly WebsiteAnalyticsV2Breakdown[];
  countries: readonly Readonly<{
    countryCode: string;
    visitors: number;
    sessions: number;
    pageViews: number;
  }>[];
  notices: readonly Readonly<{ code: string; message: string }>[];
  metadata: Readonly<{
    timezone: "Pacific/Auckland";
    trafficScope: "website";
    aggregateThrough: string | null;
    rawDates: readonly string[];
    earliestTrafficDate: string | null;
    trafficCoverageFrom: string | null;
    trafficMetricsAvailable: boolean;
    trafficBreakdownsAvailable: boolean;
    generatedAt: string;
  }>;
}>;

export type WebsiteAnalyticsV2Order = Readonly<{
  conversionId: string;
  source: "website" | "manual";
  orderId: string | null;
  productionJobId: string | null;
  reference: string;
  occurredAt: string;
  localDate: string;
  market: "NZ" | "AU";
  currency: "NZD" | "AUD";
  orderedAmountCents: number;
  collectedAmountCents: number;
  refundedAmountCents: number;
  netCollectedAmountCents: number;
  paymentStatus: "paid" | "partial" | "unpaid" | "refunded";
  historical: boolean;
  adminHref: string | null;
  attribution: Readonly<{
    channel: string;
    source: string;
    medium: string;
    campaign: string;
  }>;
}>;

export type WebsiteAnalyticsV2OrdersData = Readonly<{
  items: readonly WebsiteAnalyticsV2Order[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;

const countKpis = [
  ["Visitors", "visitors"],
  ["Sessions", "sessions"],
  ["Page Views", "pageViews"],
  ["Inquiries", "inquiries"],
  ["Orders", "orders"],
  ["Paid Orders", "paidOrders"],
] as const;

const rateKpis = [
  ["Inquiry Conversion", "inquiryConversionRate"],
  ["Order Conversion", "orderConversionRate"],
  ["Paid Order Conversion", "paidOrderConversionRate"],
] as const;

const moneyKpis = [
  ["Ordered Revenue", "orderedRevenueCents"],
  ["Collected Revenue", "collectedRevenueCents"],
  ["Refunded Revenue", "refundedRevenueCents"],
  ["Net Collected Revenue", "netCollectedRevenueCents"],
  ["Ordered AOV", "orderedAovCents"],
] as const;

const percentage = new Intl.NumberFormat("en-NZ", {
  style: "percent",
  maximumFractionDigits: 1,
});

function formatRate(value: number | null) {
  return value === null ? "—" : percentage.format(value);
}

function KpiGrid({
  label,
  metrics,
}: Readonly<{
  label: string;
  metrics: WebsiteAnalyticsV2Metrics;
}>) {
  return <div className={adminStyles.metricGrid} aria-label={label} role="region">
    {countKpis.map(([itemLabel, key]) => <article key={key}>
      <span>{itemLabel}</span>
      <strong>{metrics[key] ?? "—"}</strong>
    </article>)}
    {rateKpis.map(([itemLabel, key]) => <article key={key}>
      <span>{itemLabel}</span>
      <strong>{formatRate(metrics[key])}</strong>
    </article>)}
  </div>;
}

function MoneyGroups({ money }: Readonly<{ money: readonly WebsiteAnalyticsV2Money[] }>) {
  if (money.length === 0) return null;
  return <section aria-label="Revenue metrics">
    <div className={styles.currencyGrid}>
      {money.map((entry) => <section className={`${adminStyles.panel} ${styles.currencyPanel}`}
        key={entry.currency}>
        <h2>{entry.currency}</h2>
        <div className={styles.financeGrid}>
          {moneyKpis.map(([label, key]) => <div key={key}>
            <span>{label}</span>
            <strong>{entry[key] === null ? "—" : formatAnalyticsMoney(entry.currency, entry[key])}</strong>
          </div>)}
        </div>
      </section>)}
    </div>
  </section>;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasNoData(data: WebsiteAnalyticsV2DashboardData) {
  const counts = [data.kpis.visitors, data.kpis.sessions, data.kpis.pageViews,
    data.kpis.inquiries, data.kpis.orders, data.kpis.paidOrders];
  return counts.every((value) => !value)
    && data.kpis.money.every((entry) => moneyKpis.every(([, key]) => !entry[key]));
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function WebsiteAnalyticsV2Dashboard({
  initialData,
  initialOrders,
  initialQueryString,
}: Readonly<{
  initialData: WebsiteAnalyticsV2DashboardData;
  initialOrders: WebsiteAnalyticsV2OrdersData;
  initialQueryString: string;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.toString();
  const [data, setData] = useState(initialData);
  const [orders, setOrders] = useState(initialOrders);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeQueryRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const observedUrlRef = useRef<string | null>(null);
  const lastRoutedQueryRef = useRef<string | null>(initialData.filters.canonicalQuery);
  const retryQueryRef = useRef(initialData.filters.canonicalQuery);

  const loadQuery = useCallback(async (query: string, updateUrl: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    abortRef.current = controller;
    activeQueryRef.current = query;
    retryQueryRef.current = query;
    setLoading(true);
    setError(null);

    if (updateUrl) {
      lastRoutedQueryRef.current = query;
      router.replace(`${pathname}?${query}`, { scroll: false });
    }

    try {
      const requestOptions: RequestInit = {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      };
      const [dashboardResponse, ordersResponse] = await Promise.all([
        fetch(`/api/admin/analytics?${query}`, requestOptions),
        fetch(`/api/admin/analytics/orders?${query}`, requestOptions),
      ]);
      if (!dashboardResponse.ok || !ordersResponse.ok) throw new Error("Analytics request failed");
      const [nextData, nextOrders] = await Promise.all([
        dashboardResponse.json() as Promise<WebsiteAnalyticsV2DashboardData>,
        ordersResponse.json() as Promise<WebsiteAnalyticsV2OrdersData>,
      ]);
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      setData(nextData);
      setOrders(nextOrders);
      retryQueryRef.current = nextData.filters.canonicalQuery;
      if (nextData.filters.canonicalQuery !== query) {
        lastRoutedQueryRef.current = nextData.filters.canonicalQuery;
        router.replace(`${pathname}?${nextData.filters.canonicalQuery}`, { scroll: false });
      }
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current || isAbortError(caught)) return;
      setError("Analytics could not be loaded. Check the filters and try again.");
    } finally {
      if (requestId === requestIdRef.current) {
        abortRef.current = null;
        activeQueryRef.current = null;
        setLoading(false);
      }
    }
  }, [pathname, router]);

  const cancelActiveRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeQueryRef.current = null;
    requestIdRef.current += 1;
    queueMicrotask(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (observedUrlRef.current === null) {
      observedUrlRef.current = urlQuery;
      if (initialQueryString !== initialData.filters.canonicalQuery
        || urlQuery !== initialData.filters.canonicalQuery) {
        lastRoutedQueryRef.current = initialData.filters.canonicalQuery;
        router.replace(`${pathname}?${initialData.filters.canonicalQuery}`, { scroll: false });
      }
      return;
    }
    if (observedUrlRef.current === urlQuery) return;
    observedUrlRef.current = urlQuery;
    if (activeQueryRef.current && activeQueryRef.current !== urlQuery) cancelActiveRequest();
    if (urlQuery === lastRoutedQueryRef.current) {
      lastRoutedQueryRef.current = null;
      return;
    }
    if (urlQuery === data.filters.canonicalQuery) return;
    queueMicrotask(() => { void loadQuery(urlQuery, false); });
  }, [data.filters.canonicalQuery, initialData.filters.canonicalQuery, initialQueryString,
    cancelActiveRequest, loadQuery, pathname, router, urlQuery]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return <section className={`${adminStyles.pageSection} ${styles.dashboard}`} aria-busy={loading}>
    <header className={adminStyles.pageHeader}>
      <div>
        <h1>Website Analytics</h1>
        <p>
          {data.filters.scope === "all_business" ? "All Business" : "Website"}
          {` · ${data.filters.from} to ${data.filters.to} · Pacific/Auckland`}
        </p>
      </div>
    </header>

    <WebsiteAnalyticsV2Filters filters={data.filters} loading={loading} onApply={(query) => {
      void loadQuery(query, true);
    }} />

    {loading ? <div className={styles.loading} role="status" aria-label="Loading analytics">
      Updating analytics…
    </div> : null}
    {error ? <div className={styles.error} role="alert">
      <p>{error}</p>
      <div className={adminStyles.filterActions}>
        <button type="button" onClick={() => { void loadQuery(retryQueryRef.current, false); }}>Retry</button>
      </div>
    </div> : null}
    {hasNoData(data) ? <p className={styles.empty}>No analytics data for this period.</p> : null}

    <KpiGrid label="Key performance indicators" metrics={data.kpis} />
    <MoneyGroups money={data.kpis.money} />

    {data.comparison ? <section className={styles.comparison}>
      <div className={styles.sectionHeading}>
        <h2>Previous Period</h2>
        <span>{data.comparison.range.from} to {data.comparison.range.to}</span>
      </div>
      <KpiGrid label="Previous period key performance indicators" metrics={data.comparison.kpis} />
      <MoneyGroups money={data.comparison.kpis.money} />
    </section> : null}

    {data.notices.length > 0 ? <section className={`${adminStyles.panel} ${styles.notices}`}
      aria-label="Analytics notices">
      <h2>Notices</h2>
      <ul className={styles.noticeList}>{data.notices.map((notice) =>
        <li key={notice.code}>{notice.message}</li>)}</ul>
    </section> : null}

    <WebsiteAnalyticsV2Charts data={data} />

    <section className={`${adminStyles.panel} ${styles.pagesPanel}`}>
      <div className={styles.sectionHeading}>
        <h2>Top Pages</h2>
        <span>Website traffic only</span>
      </div>
      <div className={styles.unavailableMetrics} aria-label="Unavailable page metrics">
        {data.pages.unavailableMetrics.map((metric) => <span key={metric}>
          {titleCase(metric)}: unavailable
        </span>)}
      </div>
      {data.pages.items.length === 0
        ? <p className={styles.muted}>No page traffic matches these filters.</p>
        : <div className={styles.chartTableScroller} tabIndex={0}>
          <table className={styles.dataTable} aria-label="Top pages data">
            <thead><tr><th scope="col">Path</th><th scope="col">Visitors</th>
              <th scope="col">Page Views</th></tr></thead>
            <tbody>{data.pages.items.map((page) => <tr key={page.pathname}>
              <th scope="row">{page.pathname}</th><td>{page.visitors}</td><td>{page.pageViews}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>

    <WebsiteAnalyticsV2Orders canonicalQuery={data.filters.canonicalQuery} loading={loading}
      onNavigate={(query) => { void loadQuery(query, true); }} orders={orders} />
  </section>;
}
