import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import {
  getWebsiteAnalyticsDashboard,
  WEBSITE_ANALYTICS_PERIODS,
  type WebsiteAnalyticsPeriod,
} from "@/server/analytics/website-analytics-dashboard";
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

export default async function AdminAnalyticsPage({ searchParams }: Props) {
  const period = requestedPeriod((await searchParams).period);
  await requireAdminPage("/admin/analytics", "view_analytics");
  const result = await getWebsiteAnalyticsDashboard().load(period);

  return <section className={styles.pageSection}>
    <header className={styles.pageHeader}>
      <div><h1>Website Analytics</h1><p>Privacy-friendly public website traffic, reported in Pacific/Auckland time.</p></div>
    </header>

    <nav className={styles.filterActions} aria-label="Analytics period">
      {WEBSITE_ANALYTICS_PERIODS.map((value) => <Link
        aria-current={period === value ? "page" : undefined}
        href={`/admin/analytics?period=${value}`}
        key={value}
      >{periodLabels[value]}</Link>)}
    </nav>

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
