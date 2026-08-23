"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatMeasure, FormStatWidget } from "@/server/forms/forms-stats-service";
import styles from "./forms.module.css";

type StatisticRow = Readonly<{ label: string; value: number }>;
type TooltipPayload = Readonly<{ name?: string; value?: number | string; payload?: StatisticRow }>;

const moneyMeasures = new Set<FormStatMeasure>([
  "amount_payable", "amount_paid", "amount_owing", "artist_fee", "material_cost", "actual_profit",
]);
const measureLabels: Readonly<Record<FormStatMeasure, string>> = {
  order_count: "Order count",
  amount_payable: "AmtPayable",
  amount_paid: "AmtPaid",
  amount_owing: "AmtOwe",
  artist_fee: "Artist's Fee",
  material_cost: "Material Cost",
  actual_profit: "Actual Profit",
};
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const integer = new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 0 });
const chartColors = ["#173c31", "#285746", "#66717d", "#cde7d7", "#2f3a45", "#d7d9de"];

function queryFor(widget: FormStatWidget, stat?: FormStatistic) {
  return widget.query ?? (stat && "query" in stat ? stat.query : undefined);
}

function legacyMoney(widget: FormStatWidget) {
  return widget.metric === "amount_payable_total"
    || widget.metric === "amount_paid_total"
    || widget.metric === "amount_owing_total";
}

export function formatStatisticValue(widget: FormStatWidget, value: number, stat?: FormStatistic) {
  const query = queryFor(widget, stat);
  return (query && moneyMeasures.has(query.measure)) || legacyMoney(widget)
    ? money.format(value / 100)
    : integer.format(value);
}

export function formatStatisticAxisValue(widget: FormStatWidget, value: number, stat?: FormStatistic) {
  return formatStatisticValue(widget, value, stat);
}

function tooltipMeasure(widget: FormStatWidget, stat?: FormStatistic) {
  const query = queryFor(widget, stat);
  if (query) return `${measureLabels[query.measure]} (${query.aggregation[0]!.toUpperCase()}${query.aggregation.slice(1)})`;
  return widget.title;
}

export function FormsStatsTooltip({
  active = false,
  label,
  payload = [],
  widget,
  stat,
}: Readonly<{
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipPayload[];
  widget: FormStatWidget;
  stat?: FormStatistic;
}>) {
  if (!active) return null;
  const entry = payload[0];
  const value = typeof entry?.value === "number" ? entry.value : entry?.payload?.value;
  if (typeof value !== "number") return null;
  const rowLabel = entry?.payload?.label ?? label;
  return (
    <div className={styles.statChartTooltip} role="status">
      <strong>{rowLabel}</strong>
      <span>{tooltipMeasure(widget, stat)}</span>
      <b>{formatStatisticValue(widget, value, stat)}</b>
    </div>
  );
}

export function FormsStatsDataTable({
  widget,
  stat,
  visuallyHidden = false,
}: Readonly<{ widget: FormStatWidget; stat: FormStatistic; visuallyHidden?: boolean }>) {
  const rows = stat.rows ?? [];
  return (
    <table className={`${styles.statDataTable}${visuallyHidden ? ` ${styles.srOnly}` : ""}`} aria-label={`${widget.title} data`}>
      <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{formatStatisticValue(widget, row.value, stat)}</td></tr>)}</tbody>
    </table>
  );
}

function isUnsafePieData(rows: readonly StatisticRow[]) {
  return rows.some((row) => row.value < 0) || rows.reduce((total, row) => total + row.value, 0) <= 0;
}

function chartContent(widget: FormStatWidget, stat: FormStatistic, rows: readonly StatisticRow[]) {
  const tooltip = <Tooltip content={<FormsStatsTooltip widget={widget} stat={stat} />} />;
  if (widget.type === "pie") {
    return <PieChart accessibilityLayer>
      {tooltip}
      <Pie data={rows} dataKey="value" nameKey="label" name="Value" outerRadius="80%" isAnimationActive={false}>
        {rows.map((row, index) => <Cell key={row.label} fill={chartColors[index % chartColors.length]} />)}
      </Pie>
    </PieChart>;
  }
  if (widget.type === "line") {
    return <LineChart data={rows} accessibilityLayer>
      <CartesianGrid stroke="#d7d9de" strokeDasharray="3 3" />
      <XAxis dataKey="label" />
      <YAxis tickFormatter={(value) => formatStatisticAxisValue(widget, Number(value), stat)} />
      {tooltip}
      <Line type="monotone" dataKey="value" name="Value" stroke="#173c31" strokeWidth={2} dot />
    </LineChart>;
  }
  return <BarChart data={rows} accessibilityLayer>
    <CartesianGrid stroke="#d7d9de" strokeDasharray="3 3" />
    <XAxis dataKey="label" />
    <YAxis tickFormatter={(value) => formatStatisticAxisValue(widget, Number(value), stat)} />
    {tooltip}
    <Bar dataKey="value" name="Value" fill="#173c31" radius={[3, 3, 0, 0]} />
  </BarChart>;
}

export function FormsStatsChart({ widget, stat }: Readonly<{ widget: FormStatWidget; stat: FormStatistic }>) {
  const rows = stat.rows ?? [];
  const summaryId = `form-stat-chart-${widget.id}-summary`;
  const isPieFallback = widget.type === "pie" && isUnsafePieData(rows);
  const chartWidth = widget.type === "bar" || widget.type === "line" ? Math.max(520, rows.length * 72) : 520;
  return (
    <div className={styles.statChartScroller}>
      <p className={styles.srOnly} id={summaryId}>{widget.title} chart</p>
      {isPieFallback ? <p className={styles.statChartFallback} role="status">Pie charts require positive values. Use a bar or line chart instead.</p> : (
        <div className={styles.statChart} aria-describedby={summaryId} style={{ minWidth: `${chartWidth}px` }}>
          <ResponsiveContainer width="100%" height={260} minWidth={chartWidth}>
            {chartContent(widget, stat, rows)}
          </ResponsiveContainer>
        </div>
      )}
      <FormsStatsDataTable widget={widget} stat={stat} visuallyHidden />
    </div>
  );
}
