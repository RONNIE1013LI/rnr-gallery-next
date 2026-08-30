"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  WebsiteAnalyticsV2Breakdown,
  WebsiteAnalyticsV2DashboardData,
  WebsiteAnalyticsV2Money,
} from "./website-analytics-v2-dashboard";
import adminStyles from "./admin.module.css";
import styles from "./website-analytics-v2.module.css";

type CountMetric = "visitors" | "sessions" | "pageViews" | "inquiries" | "orders" | "paidOrders";
type RevenueMetric = Exclude<keyof WebsiteAnalyticsV2Money, "currency" | "orderedAovCents">;
type TooltipEntry = Readonly<{ name?: string; value?: string | number; dataKey?: string }>;

const countLabels: Readonly<Record<CountMetric, string>> = {
  visitors: "Visitors",
  sessions: "Sessions",
  pageViews: "Page Views",
  inquiries: "Inquiries",
  orders: "Orders",
  paidOrders: "Paid Orders",
};
const revenueLabels: Readonly<Record<RevenueMetric, string>> = {
  orderedRevenueCents: "Ordered",
  collectedRevenueCents: "Collected",
  refundedRevenueCents: "Refunded",
  netCollectedRevenueCents: "Net collected",
};
const revenueColors: Readonly<Record<RevenueMetric, string>> = {
  orderedRevenueCents: "#345c45",
  collectedRevenueCents: "#35778a",
  refundedRevenueCents: "#a85d43",
  netCollectedRevenueCents: "#6a4f82",
};
const breakdownMoneyMetrics = [
  ["Ordered", "orderedRevenueCents"],
  ["Collected", "collectedRevenueCents"],
  ["Refunded", "refundedRevenueCents"],
  ["Net collected", "netCollectedRevenueCents"],
  ["Ordered AOV", "orderedAovCents"],
] as const;
const integer = new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 0 });

export function formatAnalyticsMoney(currency: "NZD" | "AUD", cents: number) {
  const amount = new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
  const sign = cents < 0 ? "-" : "";
  return `${sign}${currency === "NZD" ? "NZ$" : "A$"}${amount}`;
}

function CountTooltip({
  active = false,
  label,
  payload = [],
}: Readonly<{ active?: boolean; label?: string | number; payload?: readonly TooltipEntry[] }>) {
  if (!active || payload.length === 0) return null;
  return <div className={styles.tooltip} role="status">
    <strong>{label}</strong>
    {payload.map((entry) => <span key={`${entry.dataKey}-${entry.name}`}>
      {entry.name}: {typeof entry.value === "number" ? integer.format(entry.value) : entry.value}
    </span>)}
  </div>;
}

function MoneyTooltip({
  active = false,
  label,
  payload = [],
  currency,
}: Readonly<{
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipEntry[];
  currency: "NZD" | "AUD";
}>) {
  if (!active || payload.length === 0) return null;
  return <div className={styles.tooltip} role="status">
    <strong>{label}</strong>
    {payload.map((entry) => <span key={`${entry.dataKey}-${entry.name}`}>
      {entry.name}: {formatAnalyticsMoney(currency, Number(entry.value ?? 0))}
    </span>)}
  </div>;
}

function ChartPanel({
  title,
  chartLabel,
  count,
  minWidth = 560,
  controls,
  notice,
  chart,
  table,
}: Readonly<{
  title: string;
  chartLabel: string;
  count: number;
  minWidth?: number;
  controls?: ReactNode;
  notice?: ReactNode;
  chart: (summaryId: string) => ReactElement;
  table: ReactNode;
}>) {
  const summaryId = `analytics-${chartLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-summary`;
  return <section className={`${adminStyles.panel} ${styles.chartPanel}`}>
    <div className={styles.chartHeading}>
      <h2>{title}</h2>
      {controls}
    </div>
    <p className={styles.srOnly} id={summaryId}>
      {count} data points. An equivalent data table follows.
    </p>
    {notice}
    <div className={styles.chartScroller} tabIndex={0} aria-label={`${title} visualisation`}>
      <div className={styles.chartCanvas} style={{ minWidth }}>
        <ResponsiveContainer width="100%" height={280} minWidth={minWidth}>
          {chart(summaryId)}
        </ResponsiveContainer>
      </div>
    </div>
    <div aria-label={`${title} equivalent data table`} className={styles.chartTableScroller}
      role="region" tabIndex={0}>{table}</div>
  </section>;
}

function AnalyticsTable({
  label,
  headings,
  rows,
}: Readonly<{
  label: string;
  headings: readonly string[];
  rows: readonly Readonly<{ key: string; values: readonly ReactNode[] }>[];
}>) {
  return <table className={styles.dataTable} aria-label={label}>
    <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}>
      {row.values.map((value, index) => index === 0
        ? <th key={index} scope="row">{value}</th>
        : <td key={index}>{value}</td>)}
    </tr>)}</tbody>
  </table>;
}

function TrafficTrend({ data }: Readonly<{ data: WebsiteAnalyticsV2DashboardData }>) {
  const [metric, setMetric] = useState<CountMetric>("sessions");
  const minimumWidth = Math.max(560, data.timeseries.length * 72);
  return <ChartPanel
    title="Traffic Trend"
    chartLabel="Traffic trend chart"
    count={data.timeseries.length}
    minWidth={minimumWidth}
    controls={<label className={styles.chartControl}>
      Traffic metric
      <select value={metric} onChange={(event) => setMetric(event.target.value as CountMetric)}>
        {Object.entries(countLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>}
    chart={(summaryId) => <LineChart
      accessibilityLayer
      aria-describedby={summaryId}
      aria-label="Traffic trend chart"
      data={data.timeseries}
    >
      <CartesianGrid stroke="#d8d7d2" strokeDasharray="3 3" />
      <XAxis dataKey="bucket" />
      <YAxis allowDecimals={false} width={56} />
      <Tooltip content={<CountTooltip />} />
      <Legend />
      <Line dataKey={metric} dot isAnimationActive={false} name={countLabels[metric]}
        stroke="#345c45" strokeWidth={2} type="monotone" />
    </LineChart>}
    table={<AnalyticsTable
      label="Traffic trend data"
      headings={["Date", "Visitors", "Sessions", "Page Views", "Inquiries", "Orders", "Paid Orders"]}
      rows={data.timeseries.map((row) => ({
        key: row.bucket,
        values: [row.bucket, row.visitors ?? "—", row.sessions ?? "—", row.pageViews,
          row.inquiries, row.orders, row.paidOrders],
      }))}
    />}
  />;
}

function RevenueTrend({ data, currency }: Readonly<{
  data: WebsiteAnalyticsV2DashboardData;
  currency: "NZD" | "AUD";
}>) {
  const rows = data.timeseries.map((row) => ({
    bucket: row.bucket,
    ...(row.money.find((entry) => entry.currency === currency) ?? {
      orderedRevenueCents: 0,
      collectedRevenueCents: 0,
      refundedRevenueCents: 0,
      netCollectedRevenueCents: 0,
    }),
  }));
  const minimumWidth = Math.max(560, rows.length * 72);
  return <ChartPanel
    title={`${currency} Revenue Trend`}
    chartLabel={`${currency} revenue trend chart`}
    count={rows.length}
    minWidth={minimumWidth}
    chart={(summaryId) => <LineChart accessibilityLayer aria-describedby={summaryId}
      aria-label={`${currency} revenue trend chart`} data={rows}>
      <CartesianGrid stroke="#d8d7d2" strokeDasharray="3 3" />
      <XAxis dataKey="bucket" />
      <YAxis tickFormatter={(value) => formatAnalyticsMoney(currency, Number(value))} width={92} />
      <Tooltip content={<MoneyTooltip currency={currency} />} />
      <Legend />
      {(Object.keys(revenueLabels) as RevenueMetric[]).map((metric) => <Line
        dataKey={metric} dot={false} isAnimationActive={false} key={metric}
        name={revenueLabels[metric]} stroke={revenueColors[metric]} strokeWidth={2} type="monotone"
      />)}
    </LineChart>}
    table={<AnalyticsTable
      label={`${currency} revenue trend data`}
      headings={["Date", "Ordered", "Collected", "Refunded", "Net collected"]}
      rows={rows.map((row) => ({
        key: row.bucket,
        values: [row.bucket, formatAnalyticsMoney(currency, row.orderedRevenueCents),
          formatAnalyticsMoney(currency, row.collectedRevenueCents),
          formatAnalyticsMoney(currency, row.refundedRevenueCents),
          formatAnalyticsMoney(currency, row.netCollectedRevenueCents)],
      }))}
    />}
  />;
}

function FunnelChart({ data }: Readonly<{ data: WebsiteAnalyticsV2DashboardData }>) {
  const rows = [
    { label: "Sessions", value: data.funnel.sessions, display: data.funnel.sessions ?? "—" },
    { label: "Inquiries", value: data.funnel.inquiries, display: data.funnel.inquiries },
    { label: "Orders", value: data.funnel.orders, display: data.funnel.orders },
    { label: "Paid Orders", value: data.funnel.paidOrders, display: data.funnel.paidOrders },
  ];
  return <ChartPanel
    title="Website Funnel"
    chartLabel="Website funnel chart"
    count={rows.length}
    notice={data.funnel.sessions === null
      ? <p className={styles.muted}>Sessions are unavailable for this range.</p>
      : null}
    chart={(summaryId) => <BarChart accessibilityLayer aria-describedby={summaryId}
      aria-label="Website funnel chart" data={rows} layout="vertical">
      <CartesianGrid stroke="#d8d7d2" strokeDasharray="3 3" />
      <XAxis allowDecimals={false} type="number" />
      <YAxis dataKey="label" type="category" width={92} />
      <Tooltip content={<CountTooltip />} />
      <Legend />
      <Bar dataKey="value" fill="#345c45" isAnimationActive={false} name="Website conversions" />
    </BarChart>}
    table={<AnalyticsTable label="Website funnel data" headings={["Stage", "Count"]}
      rows={rows.map((row) => ({ key: row.label, values: [row.label, row.display] }))} />}
  />;
}

function breakdownLabel(row: WebsiteAnalyticsV2Breakdown, kind: "channel" | "campaign" | "market") {
  if (kind === "campaign") {
    const identity = campaignIdentity(row);
    return `${identity.channel} · ${identity.source} / ${identity.medium} · ${identity.campaign}`;
  }
  if (kind === "market") return row.market ?? "Unknown";
  return row.channel ?? "Unknown";
}

function campaignIdentity(row: WebsiteAnalyticsV2Breakdown) {
  const campaign = row.campaign?.trim();
  return {
    channel: row.channel?.trim() || "Unknown",
    source: row.source?.trim() || "Unattributed",
    medium: row.medium?.trim() || "(not set)",
    campaign: !campaign || campaign === "(not set)" ? "No campaign" : campaign,
  };
}

function breakdownDimensions(
  row: WebsiteAnalyticsV2Breakdown,
  kind: "channel" | "campaign" | "market",
) {
  if (kind === "campaign") {
    const identity = campaignIdentity(row);
    return {
      values: [identity.channel, identity.source, identity.medium, identity.campaign],
      key: `${identity.channel}\u0000${identity.source}\u0000${identity.medium}\u0000${identity.campaign}`,
    };
  }
  const label = breakdownLabel(row, kind);
  return {
    values: [label],
    key: label,
  };
}

function breakdownDimensionHeadings(kind: "channel" | "campaign" | "market") {
  if (kind === "campaign") return ["Channel", "Source", "Medium", "Campaign"];
  return [kind === "market" ? "Market" : "Channel"];
}

function breakdownMoneyValues(row: WebsiteAnalyticsV2Breakdown, currency: "NZD" | "AUD") {
  const money = row.money.find((entry) => entry.currency === currency);
  return breakdownMoneyMetrics.map(([, metric]) => money?.[metric] === null || money?.[metric] === undefined
    ? "—"
    : formatAnalyticsMoney(currency, money[metric]));
}

function BreakdownChart({ title, chartLabel, tableLabel, rows, kind }: Readonly<{
  title: string;
  chartLabel: string;
  tableLabel: string;
  rows: readonly WebsiteAnalyticsV2Breakdown[];
  kind: "channel" | "campaign" | "market";
}>) {
  const chartRows = rows.map((row) => ({ label: breakdownLabel(row, kind), orders: row.orders }));
  return <ChartPanel title={title} chartLabel={chartLabel} count={rows.length}
    minWidth={Math.max(560, rows.length * 100)}
    chart={(summaryId) => <BarChart accessibilityLayer aria-describedby={summaryId}
      aria-label={chartLabel} data={chartRows}>
      <CartesianGrid stroke="#d8d7d2" strokeDasharray="3 3" />
      <XAxis dataKey="label" />
      <YAxis allowDecimals={false} width={56} />
      <Tooltip content={<CountTooltip />} />
      <Legend />
      <Bar dataKey="orders" fill="#345c45" isAnimationActive={false} name="Orders" />
    </BarChart>}
    table={<AnalyticsTable label={tableLabel}
      headings={[...breakdownDimensionHeadings(kind),
        "Visitors", "Sessions", "Page Views", "Inquiries", "Orders", "Paid Orders",
        ...(["NZD", "AUD"] as const).flatMap((currency) => breakdownMoneyMetrics
          .map(([label]) => `${currency} ${label}`))]}
      rows={rows.map((row) => {
        const dimensions = breakdownDimensions(row, kind);
        return {
          key: dimensions.key,
          values: [...dimensions.values,
          row.visitors ?? "—", row.sessions ?? "—", row.pageViews ?? "—",
          row.inquiries, row.orders, row.paidOrders, ...breakdownMoneyValues(row, "NZD"),
          ...breakdownMoneyValues(row, "AUD")],
        };
      })} />}
  />;
}

function SimpleCountBreakdown({ title, chartLabel, tableLabel, metricLabel, rows }: Readonly<{
  title: string;
  chartLabel: string;
  tableLabel: string;
  metricLabel: string;
  rows: readonly Readonly<{ label: string; value: number }>[];
}>) {
  return <ChartPanel title={title} chartLabel={chartLabel} count={rows.length}
    minWidth={Math.max(560, rows.length * 100)}
    chart={(summaryId) => <BarChart accessibilityLayer aria-describedby={summaryId}
      aria-label={chartLabel} data={rows}>
      <CartesianGrid stroke="#d8d7d2" strokeDasharray="3 3" />
      <XAxis dataKey="label" />
      <YAxis allowDecimals={false} width={56} />
      <Tooltip content={<CountTooltip />} />
      <Legend />
      <Bar dataKey="value" fill="#345c45" isAnimationActive={false} name={metricLabel} />
    </BarChart>}
    table={<AnalyticsTable label={tableLabel} headings={["Category", metricLabel]}
      rows={rows.map((row) => ({ key: row.label, values: [row.label, row.value] }))} />}
  />;
}

function CountryTrafficBreakdown({
  rows,
  available,
  coverageFrom,
}: Readonly<{
  rows: WebsiteAnalyticsV2DashboardData["countries"];
  available: boolean;
  coverageFrom: string | null;
}>) {
  if (!available) return <section className={`${adminStyles.panel} ${styles.chartPanel}`}>
    <h2>Country Traffic</h2>
    <p className={styles.muted}>{trafficUnavailableMessage("Country Traffic", coverageFrom)}</p>
  </section>;
  if (rows.length === 0) return <section className={`${adminStyles.panel} ${styles.chartPanel}`}>
    <h2>Country Traffic</h2>
    <p className={styles.muted}>No country traffic matches these filters.</p>
  </section>;
  return <ChartPanel title="Country Traffic" chartLabel="Country traffic chart" count={rows.length}
    minWidth={Math.max(560, rows.length * 100)}
    chart={(summaryId) => <BarChart accessibilityLayer aria-describedby={summaryId}
      aria-label="Country traffic chart" data={rows}>
      <CartesianGrid stroke="#d8d7d2" strokeDasharray="3 3" />
      <XAxis dataKey="countryCode" />
      <YAxis allowDecimals={false} width={56} />
      <Tooltip content={<CountTooltip />} />
      <Legend />
      <Bar dataKey="pageViews" fill="#345c45" isAnimationActive={false} name="Page Views" />
    </BarChart>}
    table={<AnalyticsTable label="Country traffic data"
      headings={["Country", "Visitors", "Sessions", "Page Views"]}
      rows={rows.map((row) => ({
        key: row.countryCode,
        values: [row.countryCode, row.visitors, row.sessions, row.pageViews],
      }))} />}
  />;
}

function trafficUnavailableMessage(subject: string, coverageFrom: string | null) {
  const verb = subject === "Country Traffic" ? "is" : "are";
  return coverageFrom
    ? `${subject} ${verb} unavailable because this range begins before retained traffic coverage from ${coverageFrom}.`
    : `${subject} ${verb} unavailable because no retained raw traffic coverage exists.`;
}

function titleCase(value: string) {
  return value.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

export function WebsiteAnalyticsV2Charts({ data }: Readonly<{
  data: WebsiteAnalyticsV2DashboardData;
}>) {
  const currencies = (["NZD", "AUD"] as const).filter((currency) =>
    data.kpis.money.some((entry) => entry.currency === currency)
      || data.timeseries.some((row) => row.money.some((entry) => entry.currency === currency)));
  return <div className={styles.chartsGrid}>
    <TrafficTrend data={data} />
    {currencies.map((currency) => <RevenueTrend currency={currency} data={data} key={currency} />)}
    <FunnelChart data={data} />
    <BreakdownChart chartLabel="Channel performance chart" kind="channel" rows={data.channels}
      tableLabel="Channel performance data" title="Channel Performance" />
    <BreakdownChart chartLabel="Campaign performance chart" kind="campaign" rows={data.campaigns}
      tableLabel="Campaign performance data" title="Campaign Performance" />
    <SimpleCountBreakdown chartLabel="Payment status chart"
      metricLabel="Orders"
      rows={data.payments.map((row) => ({ label: titleCase(row.status), value: row.orders }))}
      tableLabel="Payment status data" title="Payment Status" />
    <BreakdownChart chartLabel="Market performance chart" kind="market" rows={data.markets}
      tableLabel="Market performance data" title="Market Performance" />
    <CountryTrafficBreakdown available={data.metadata.trafficBreakdownsAvailable}
      coverageFrom={data.metadata.trafficCoverageFrom} rows={data.countries} />
  </div>;
}
