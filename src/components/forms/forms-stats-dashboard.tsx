"use client";

import { useEffect, useMemo, useState } from "react";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsWidgetResult, type FormsStatsWidgetState } from "./forms-stats-widget-result";
import styles from "./forms.module.css";

export type FormsStatsDashboardLayout = Readonly<{
  id: string;
  name: string;
  widgets: readonly FormStatWidget[];
}>;

type StatisticRequest = Readonly<{ key: string; url: string }>;
type StatisticStates = Readonly<Record<string, FormsStatsWidgetState | undefined>>;

function statisticRequest(widget: FormStatWidget): StatisticRequest | null {
  if (widget.metric) {
    const key = `metric=${encodeURIComponent(widget.metric)}`;
    return { key, url: `/api/forms/stats?${key}` };
  }
  if (!widget.query) return null;
  const params = new URLSearchParams();
  for (const key of ["dimension", "timeUnit", "measure", "aggregation", "sort"] as const) {
    const value = widget.query[key];
    if (value !== undefined) params.set(key, value);
  }
  const key = params.toString();
  return { key, url: `/api/forms/stats?${key}` };
}

function reportSummary(layout: FormsStatsDashboardLayout) {
  const count = layout.widgets.length;
  return `${count} ${count === 1 ? "widget" : "widgets"}`;
}

export function FormsStatsDashboard({
  layouts,
  canManage,
  canViewFinance,
  onCreate,
  onEdit,
  onDeleted,
}: Readonly<{
  layouts: readonly FormsStatsDashboardLayout[];
  canManage: boolean;
  canViewFinance: boolean;
  onCreate: () => void;
  onEdit: (layout: FormsStatsDashboardLayout) => void;
  onDeleted: (layout: FormsStatsDashboardLayout) => void;
}>) {
  const requests = useMemo(() => {
    const unique = new Map<string, StatisticRequest>();
    for (const layout of layouts) {
      for (const widget of layout.widgets) {
        const request = statisticRequest(widget);
        if (request) unique.set(request.key, request);
      }
    }
    return [...unique.values()];
  }, [layouts]);
  const [stats, setStats] = useState<Readonly<Record<string, FormStatistic>>>({});
  const [states, setStates] = useState<StatisticStates>({});
  const [feedback, setFeedback] = useState("");
  const [deletingName, setDeletingName] = useState<string | null>(null);

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
    if (!window.confirm(`Delete "${layout.name}"?`)) return;
    setFeedback("");
    setDeletingName(layout.name);
    try {
      const response = await fetch(`/api/forms/stats/layout?name=${encodeURIComponent(layout.name)}`, { method: "DELETE" });
      const body = await response.json().catch(() => null) as { removed?: boolean; error?: string } | null;
      if (!response.ok || !body?.removed) throw new Error(body?.error || "The report could not be deleted.");
      onDeleted(layout);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The report could not be deleted.");
    } finally {
      setDeletingName(null);
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
              <button type="button" aria-label={`Delete ${layout.name}`} disabled={deletingName === layout.name} onClick={() => void deleteLayout(layout)}>Delete</button>
            </div> : null}
          </header>
          <div className={styles.statsReportWidgets}>
            {layout.widgets.map((widget) => {
              const request = statisticRequest(widget);
              return <section className={styles.statsReportWidget} key={widget.id} data-type={widget.type}>
                <h3>{widget.title}</h3>
                <FormsStatsWidgetResult widget={widget} stat={request ? stats[request.key] : undefined} state={request ? states[request.key] : undefined} />
              </section>;
            })}
          </div>
        </article>
      ))}
    </section>
  );
}
