"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsWidgetResult, type FormsStatsWidgetState } from "./forms-stats-widget-result";
import styles from "./forms.module.css";

export type FormsStatsDashboardLayout = Readonly<{
  id: string;
  name: string;
  widgets: readonly FormStatWidget[];
  skippedWidgetCount?: number;
  warning?: string;
}>;

type StatisticRequest = Readonly<{ key: string; url: string }>;
type StatisticStates = Readonly<Record<string, FormsStatsWidgetState | undefined>>;

export type FormsStatsQueryContext = Readonly<{
  q?: string;
  preset?: "lastSixMonths" | "lastYear";
  match?: "and" | "or";
  filters?: readonly string[];
}>;
const emptyQueryContext: FormsStatsQueryContext = Object.freeze({});

export function buildFormsStatsStatisticRequest(widget: FormStatWidget, queryContext: FormsStatsQueryContext): StatisticRequest | null {
  const params = new URLSearchParams();
  if (widget.metric) {
    params.set("metric", widget.metric);
  } else {
    if (!widget.query) return null;
    for (const key of ["dimension", "timeUnit", "measure", "aggregation", "sort"] as const) {
      const value = widget.query[key];
      if (value !== undefined) params.set(key, value);
    }
  }
  if (queryContext.q) params.set("q", queryContext.q);
  if (queryContext.preset) params.set("preset", queryContext.preset);
  if (queryContext.match) params.set("match", queryContext.match);
  for (const filter of queryContext.filters ?? []) params.append("filter", filter);
  const key = params.toString();
  return { key, url: `/api/forms/stats?${key}` };
}

function reportSummary(layout: FormsStatsDashboardLayout) {
  const count = layout.widgets.length;
  if (count === 0) return "Empty report";
  const types = [...new Set(layout.widgets.map((widget) => widget.type))].map((type) => `${type} ${type === "pie" ? "chart" : "widget"}`);
  return `${count} ${count === 1 ? "widget" : "widgets"} · ${types.join(", ")}`;
}

export function FormsStatsDashboard({
  layouts,
  canManage,
  canViewFinance,
  queryContext = emptyQueryContext,
  onCreate,
  onEdit,
  onDeleted,
}: Readonly<{
  layouts: readonly FormsStatsDashboardLayout[];
  canManage: boolean;
  canViewFinance: boolean;
  queryContext?: FormsStatsQueryContext;
  onCreate: () => void;
  onEdit: (layout: FormsStatsDashboardLayout) => void;
  onDeleted: (layout: FormsStatsDashboardLayout) => void;
}>) {
  const requests = useMemo(() => {
    const unique = new Map<string, StatisticRequest>();
    for (const layout of layouts) {
      for (const widget of layout.widgets) {
        const request = buildFormsStatsStatisticRequest(widget, queryContext);
        if (request) unique.set(request.key, request);
      }
    }
    return [...unique.values()];
  }, [layouts, queryContext]);
  const [stats, setStats] = useState<Readonly<Record<string, FormStatistic>>>({});
  const [states, setStates] = useState<StatisticStates>({});
  const [feedback, setFeedback] = useState("");
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const pendingDeleteId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestCache = new Map<string, Promise<FormStatistic>>();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setStates(Object.fromEntries(requests.map((request) => [request.key, "loading"])));
      }
    });

    for (const request of requests) {
      let pending = requestCache.get(request.key);
      if (!pending) {
        pending = fetch(request.url, { signal: controller.signal }).then(async (response) => {
          const body = await response.json().catch(() => null) as { stat?: FormStatistic; error?: string } | null;
          if (!response.ok || !body?.stat) throw new Error(body?.error || "Statistic unavailable.");
          return body.stat;
        });
        requestCache.set(request.key, pending);
      }
      void pending.then((stat) => {
        if (controller.signal.aborted) return;
        setStats((current) => ({ ...current, [request.key]: stat }));
        setStates((current) => ({ ...current, [request.key]: stat.rows?.length === 0 ? "empty" : undefined }));
      }).catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setStates((current) => ({ ...current, [request.key]: "error" }));
      });
    }

    return () => controller.abort();
  }, [requests]);

  async function deleteLayout(layout: FormsStatsDashboardLayout) {
    if (pendingDeleteId.current) return;
    if (!window.confirm(`Delete "${layout.name}"?`)) return;
    pendingDeleteId.current = layout.id;
    setFeedback("");
    setDeletingName(layout.name);
    try {
      const response = await fetch(`/api/forms/stats/layout?name=${encodeURIComponent(layout.name)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => null) as { removed?: boolean; error?: string } | null;
      if (!response.ok || !body?.removed) throw new Error(body?.error || "The report could not be deleted.");
      onDeleted(layout);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The report could not be deleted.");
    } finally {
      if (pendingDeleteId.current === layout.id) {
        pendingDeleteId.current = null;
        setDeletingName(null);
      }
    }
  }

  return (
    <section className={styles.statsDashboard} aria-label="Saved custom reports" data-can-view-finance={canViewFinance}>
      {canManage ? <div className={styles.statsCreatePanel}>
        <div><h2>Create a custom report</h2><p>Choose the statistics and layout for a saved report.</p></div>
        <button type="button" onClick={onCreate}>Create custom stat</button>
      </div> : null}
      {feedback ? <p className={styles.formFeedback} role="alert">{feedback}</p> : null}
      {layouts.length === 0 ? <p className={styles.statsEmpty}>No custom reports have been saved yet.</p> : layouts.map((layout) => (
        <article className={styles.statsReportCard} key={layout.id}>
          <header className={styles.statsReportHeader}>
            <div><h2>{layout.name}</h2><p>{reportSummary(layout)}</p></div>
            {canManage ? <div className={styles.statsReportActions}>
              <button type="button" aria-label={`Edit ${layout.name}`} onClick={() => onEdit(layout)}>Edit</button>
              <button type="button" aria-label={`Delete ${layout.name}`} disabled={deletingName !== null} onClick={() => void deleteLayout(layout)}>Delete</button>
            </div> : null}
          </header>
          {layout.warning ? <p className={styles.statsReportWarning} role="status" aria-label={`${layout.name} warning`}>{layout.warning}</p> : null}
          <div className={styles.statsReportWidgets}>
            {layout.widgets.map((widget) => {
              const request = buildFormsStatsStatisticRequest(widget, queryContext);
              return <section className={styles.statsReportWidget} key={widget.id} data-type={widget.type}>
                <h3>{widget.title}</h3>
                <FormsStatsWidgetResult widget={widget} stat={request ? stats[request.key] : undefined} state={request ? states[request.key] : undefined} instanceId={`${layout.id}-${widget.id}`} />
              </section>;
            })}
          </div>
        </article>
      ))}
    </section>
  );
}
