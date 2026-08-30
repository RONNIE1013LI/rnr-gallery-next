import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import styles from "@/components/admin/admin.module.css";
import { WebsiteAnalyticsV2Dashboard } from "@/components/admin/website-analytics-v2-dashboard";
import { WebsiteAnalyticsInternalDevice } from "@/components/admin/website-analytics-internal-device";
import {
  getWebsiteAnalyticsDashboard,
  WEBSITE_ANALYTICS_PERIODS,
  type WebsiteAnalyticsPeriod,
} from "@/server/analytics/website-analytics-dashboard";
import {
  readWebsiteAnalyticsBusinessConfig,
  readWebsiteAnalyticsConfig,
} from "@/server/analytics/website-analytics-config";
import {
  parseWebsiteAnalyticsInternalDevice,
  WEBSITE_ANALYTICS_INTERNAL_COOKIE,
} from "@/server/analytics/website-analytics-cookies";
import { getWebsiteAnalyticsV2Dashboard } from "@/server/analytics/website-analytics-v2-dashboard";
import { parseWebsiteAnalyticsV2Query } from "@/server/analytics/website-analytics-v2-query";
import { requireAdminPage } from "@/server/auth/require-admin-page";

type Props = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

const periodLabels: Record<WebsiteAnalyticsPeriod, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "7 Days",
  "30d": "30 Days",
};
const channelLabels = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  google_organic: "Google Organic",
  direct: "Direct",
  other: "Other",
} as const;

function requestedPeriod(value: string | string[] | undefined): WebsiteAnalyticsPeriod {
  const scalar = Array.isArray(value) ? value[0] : value;
  return WEBSITE_ANALYTICS_PERIODS.includes(scalar as WebsiteAnalyticsPeriod)
    ? scalar as WebsiteAnalyticsPeriod
    : "today";
}

export const metadata = { title: "Website Analytics | R&R Gallery Admin" };

function WebsiteAnalyticsV1({
  period,
  result,
  canIncludeInternal,
  includeInternal,
  initialInternal,
}: Readonly<{
  period: WebsiteAnalyticsPeriod;
  result: Awaited<ReturnType<ReturnType<typeof getWebsiteAnalyticsDashboard>["load"]>>;
  canIncludeInternal: boolean;
  includeInternal: boolean;
  initialInternal: boolean;
}>) {
  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}>
      <div><h1>Website Analytics</h1><p>Privacy-friendly public website traffic, reported in Pacific/Auckland time.</p></div>
    </header>

    {canIncludeInternal
      ? <WebsiteAnalyticsInternalDevice initialInternal={initialInternal} />
      : null}

    <nav className={styles.filterActions} aria-label="Analytics period">
      {WEBSITE_ANALYTICS_PERIODS.map((value) => <Link
        aria-current={period === value ? "page" : undefined}
        href={`/admin/analytics?period=${value}`}
        key={value}
      >{periodLabels[value]}</Link>)}
    </nav>
    {canIncludeInternal ? <nav className={styles.filterActions} aria-label="Internal traffic filter">
      <Link href={`/admin/analytics?period=${period}&includeInternal=${String(!includeInternal)}`}>
        {includeInternal ? "Exclude internal traffic" : "Include internal traffic"}
      </Link>
    </nav> : null}

    <div className={styles.metricGrid}>
      <article><span>Visitors</span><strong>{result.metrics.visitors}</strong></article>
      <article><span>Sessions</span><strong>{result.metrics.sessions}</strong></article>
      <article><span>Page Views</span><strong>{result.metrics.pageviews}</strong></article>
    </div>

    <section className={styles.panel}>
      <h2>Traffic</h2>
      <div className={styles.tableScroll}><table className={styles.dataTable}>
        <thead><tr><th>Channel</th><th>Visitors</th><th>Sessions</th><th>Page Views</th></tr></thead>
        <tbody>{result.channels.map((row) => <tr key={row.channel}>
          <td><strong>{channelLabels[row.channel]}</strong></td><td>{row.visitors}</td><td>{row.sessions}</td><td>{row.pageviews}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className={styles.panel}>
      <h2>Top Pages</h2>
      <div className={styles.tableScroll}><table className={styles.dataTable}>
        <thead><tr><th>Path</th><th>Visitors</th><th>Page Views</th></tr></thead>
        <tbody>{result.topPages.map((row) => <tr key={row.pathname}>
          <td><strong>{row.pathname}</strong></td><td>{row.visitors}</td><td>{row.pageviews}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className={styles.panel}>
      <h2>Countries</h2>
      <div className={styles.tableScroll}><table className={styles.dataTable}>
        <thead><tr><th>Country</th><th>Visitors</th><th>Page Views</th></tr></thead>
        <tbody>{result.countries.map((row) => <tr key={row.countryCode}>
          <td><strong>{row.countryCode}</strong></td><td>{row.visitors}</td><td>{row.pageviews}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className={styles.panel}>
      <h2>Traffic Trend</h2>
      <div className={styles.tableScroll}><table className={styles.dataTable}>
        <thead><tr><th>Date</th><th>Visitors</th><th>Page Views</th></tr></thead>
        <tbody>{result.trend.map((row) => <tr key={row.localDate}>
          <td><strong>{row.localDate}</strong></td><td>{row.visitors}</td><td>{row.pageviews}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </section>;
}

function queryString(input: Readonly<Record<string, string | string[] | undefined>>) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") result.set(key, value);
  }
  return result.toString();
}

export default async function AdminAnalyticsPage({ searchParams }: Props) {
  const rawSearchParams = await searchParams;
  const period = requestedPeriod(rawSearchParams.period);
  const access = await requireAdminPage("/admin/analytics", "view_analytics");
  const canIncludeInternal = access.adminRole === "admin";
  const requestedIncludeInternal = rawSearchParams.includeInternal === "true";
  if (requestedIncludeInternal && !canIncludeInternal) redirect("/admin/analytics");
  const analyticsConfig = readWebsiteAnalyticsConfig();
  const internalCookie = (await cookies()).get(WEBSITE_ANALYTICS_INTERNAL_COOKIE)?.value;
  const initialInternal = Boolean(analyticsConfig.cookieSecret
    && parseWebsiteAnalyticsInternalDevice(internalCookie, analyticsConfig.cookieSecret));

  if (!readWebsiteAnalyticsBusinessConfig().v2Enabled) {
    const result = await getWebsiteAnalyticsDashboard().load(
      period,
      new Date(),
      canIncludeInternal && requestedIncludeInternal,
    );
    return <WebsiteAnalyticsV1 period={period} result={result}
      canIncludeInternal={canIncludeInternal} includeInternal={requestedIncludeInternal}
      initialInternal={initialInternal} />;
  }

  const now = new Date();
  const query = parseWebsiteAnalyticsV2Query(rawSearchParams, { now });
  if (query.includeInternal && !canIncludeInternal) redirect("/admin/analytics");
  const dashboard = getWebsiteAnalyticsV2Dashboard();
  const [initialData, initialOrders] = await Promise.all([
    dashboard.load(query, now),
    dashboard.listOrders(query),
  ]);

  return <WebsiteAnalyticsV2Dashboard
    initialData={initialData}
    initialOrders={initialOrders}
    initialQueryString={queryString(rawSearchParams)}
    canIncludeInternal={canIncludeInternal}
    initialInternal={initialInternal}
  />;
}
