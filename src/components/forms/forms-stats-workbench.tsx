"use client";

import { useEffect, useMemo, useState } from "react";

import { FORM_STAT_METRICS, type FormStatMetric, type FormStatWidget } from "@/server/forms/forms-stats-service";
import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import styles from "./forms.module.css";

type Layout = Readonly<{ id: string; name: string; widgets: readonly FormStatWidget[] }>;
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const metricLabels: Record<FormStatMetric, string> = {
  job_count: "Order count",
  urgent_count: "Urgent orders",
  delivery_method: "Delivery method",
  status: "Order status",
  customer_source: "Customer source",
  amount_payable_total: "Amount payable",
  amount_paid_total: "Amount paid",
  amount_owing_total: "Amount owing",
  daily_orders: "Daily orders",
  monthly_orders: "Monthly orders",
};

function defaultLayout(canViewFinance: boolean): Layout {
  return {
    id: "default",
    name: "Studio overview",
    widgets: [
      { id: "orders", type: "number", metric: "job_count", title: "Orders" },
      { id: "urgent", type: "number", metric: "urgent_count", title: "Urgent orders" },
      { id: "status", type: "bar", metric: "status", title: "Order status" },
      { id: "delivery", type: "table", metric: "delivery_method", title: "Delivery method" },
      ...(canViewFinance ? [{ id: "owing", type: "number" as const, metric: "amount_owing_total" as const, title: "Amount owing" }] : []),
    ],
  };
}

function displayValue(metric: FormStatMetric | undefined, value: number) {
  return metric?.startsWith("amount_") ? money.format(value / 100) : new Intl.NumberFormat("en-NZ").format(value);
}

function WidgetResult({ widget, stat }: Readonly<{ widget: FormStatWidget; stat?: FormStatistic }>) {
  if (widget.type === "divider") return <hr />;
  if (widget.type === "text") return <p>{widget.text}</p>;
  if (!stat) return <p className={styles.statsLoading}>Loading…</p>;
  if (stat.value !== undefined) return <strong className={styles.statNumber}>{displayValue(widget.metric, stat.value)}</strong>;
  const rows = stat.rows ?? [];
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  return (
    <>
      {widget.type !== "table" ? <div className={styles.statBars} aria-hidden="true">{rows.map((row) => (
        <span key={row.label} style={{ "--stat-ratio": `${Math.max(4, row.value / maximum * 100)}%` } as React.CSSProperties}><i /><em>{row.label}</em></span>
      ))}</div> : null}
      <table className={styles.statDataTable} aria-label={`${widget.title} data`}>
        <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{displayValue(widget.metric, row.value)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

export function FormsStatsWorkbench({
  layouts,
  canManage,
  canViewFinance = true,
}: Readonly<{
  layouts: readonly Layout[];
  canManage: boolean;
  canViewFinance?: boolean;
}>) {
  const available = useMemo(() => layouts.length ? layouts : [defaultLayout(canViewFinance)], [layouts, canViewFinance]);
  const [selectedId, setSelectedId] = useState(available[0]!.id);
  const [name, setName] = useState(available[0]!.name);
  const [widgets, setWidgets] = useState<readonly FormStatWidget[]>(available[0]!.widgets);
  const [stats, setStats] = useState<Record<string, FormStatistic>>({});
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const metricWidgets = widgets.filter((widget) => widget.metric);
    void Promise.all(metricWidgets.map(async (widget) => {
      const response = await fetch(`/api/forms/stats?metric=${encodeURIComponent(widget.metric!)}`, { signal: controller.signal });
      const body = await response.json() as { stat?: FormStatistic; error?: string };
      if (!response.ok || !body.stat) throw new Error(body.error || "Statistic unavailable");
      return [widget.id, body.stat] as const;
    })).then((entries) => setStats(Object.fromEntries(entries))).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback(error instanceof Error ? error.message : "Statistics could not be loaded.");
    });
    return () => controller.abort();
  }, [widgets]);

  function move(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= widgets.length) return;
    setWidgets((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  }

  function patchWidget(id: string, patch: Partial<FormStatWidget>) {
    setWidgets((current) => current.map((widget) => widget.id === id ? { ...widget, ...patch } : widget));
  }

  function selectLayout(id: string) {
    const layout = available.find((entry) => entry.id === id);
    if (!layout) return;
    setSelectedId(layout.id);
    setName(layout.name);
    setWidgets(layout.widgets);
    setStats({});
    setFeedback("");
  }

  async function save() {
    setFeedback("");
    const response = await fetch("/api/forms/stats/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, widgets }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    setFeedback(response.ok ? "Layout saved." : body?.error || "The layout could not be saved.");
  }

  return (
    <section className={styles.statsWorkbench}>
      <div className={styles.statsToolbar}>
        <label><span>Layout</span><select value={selectedId} onChange={(event) => selectLayout(event.target.value)}>{available.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label>
        {canManage ? <label><span>Layout name</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label> : null}
        {canManage ? <button type="button" disabled={widgets.length >= 24} onClick={() => setWidgets((current) => [...current, {
          id: `widget-${Date.now()}-${current.length}`,
          type: "number",
          metric: "job_count",
          title: "Orders",
        }])}>Add widget</button> : null}
        {canManage ? <button type="button" onClick={() => void save()}>Save layout</button> : null}
      </div>
      <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
      <div className={styles.statsGrid}>{widgets.map((widget, index) => (
        <article className={styles.statWidget} key={widget.id} data-type={widget.type}>
          <header><h2>{widget.title}</h2>{canManage ? <div className={styles.widgetActions}>
            <button type="button" aria-label={`Move ${widget.title} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
            <button type="button" aria-label={`Move ${widget.title} down`} disabled={index === widgets.length - 1} onClick={() => move(index, 1)}>↓</button>
            <button type="button" aria-label={`Remove ${widget.title}`} onClick={() => setWidgets((current) => current.filter((entry) => entry.id !== widget.id))}>×</button>
          </div> : null}</header>
          {canManage && widget.metric ? <div className={styles.widgetConfig}>
            <label><span>Title</span><input aria-label={`${widget.title} title`} value={widget.title} onChange={(event) => patchWidget(widget.id, { title: event.target.value })} /></label>
            <label><span>Metric</span><select value={widget.metric} onChange={(event) => patchWidget(widget.id, { metric: event.target.value as FormStatMetric })}>{FORM_STAT_METRICS.filter((metric) => canViewFinance || !metric.startsWith("amount_")).map((metric) => <option key={metric} value={metric}>{metricLabels[metric]}</option>)}</select></label>
          </div> : null}
          <WidgetResult widget={widget} stat={stats[widget.id]} />
        </article>
      ))}</div>
    </section>
  );
}
