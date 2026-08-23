"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { z } from "zod";

import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import { parseFormStatsLayout, type FormStatWidget, type FormStatsLayout } from "@/server/forms/forms-stats-service";
import type { FormStatWidgetType } from "@/domain/forms/forms-parity";
import {
  buildFormsStatsStatisticRequest,
  type FormsStatsDashboardLayout,
  type FormsStatsQueryContext,
} from "./forms-stats-dashboard";
import { FormsStatsWidgetEditor } from "./forms-stats-widget-editor";
import { FormsStatsWidgetResult, type FormsStatsWidgetState } from "./forms-stats-widget-result";
import styles from "./forms.module.css";

const emptyQueryContext: FormsStatsQueryContext = Object.freeze({});
const savedLayoutResponseSchema = z.object({ layout: z.object({ id: z.string().uuid() }) });
const paletteTypes = new Set<FormStatWidgetType>(["bar", "pie", "line", "table", "number", "divider", "text"]);
const paletteControls: readonly Readonly<{
  type: FormStatWidgetType;
  label: string;
  title: string;
  group: "layout" | "stat";
}>[] = [
  { type: "divider", label: "Add divider", title: "Divider", group: "layout" },
  { type: "text", label: "Add text", title: "Text", group: "layout" },
  { type: "bar", label: "Add bar chart", title: "Bar chart", group: "stat" },
  { type: "pie", label: "Add pie chart", title: "Pie chart", group: "stat" },
  { type: "line", label: "Add line chart", title: "Line chart", group: "stat" },
  { type: "table", label: "Add table", title: "Table", group: "stat" },
  { type: "number", label: "Add number", title: "Number", group: "stat" },
];

type StatisticStates = Readonly<Record<string, FormsStatsWidgetState | undefined>>;

function createWidget(type: FormStatWidgetType): FormStatWidget {
  const control = paletteControls.find((entry) => entry.type === type)!;
  const base = { id: crypto.randomUUID(), type, title: control.title };
  if (type === "text") return { ...base, text: "Add report notes." };
  if (type === "divider") return base;
  if (type === "number") {
    return { ...base, query: { measure: "order_count", aggregation: "count", sort: "default" } };
  }
  return {
    ...base,
    query: {
      dimension: "submitted_at",
      timeUnit: "day",
      measure: "order_count",
      aggregation: "count",
      sort: "default",
    },
  };
}

function draftSnapshot(name: string, widgets: readonly FormStatWidget[]) {
  return JSON.stringify({ name, widgets });
}

export function FormsStatsBuilder({
  initialLayout,
  canViewFinance,
  queryContext = emptyQueryContext,
  onBack,
  onSaved,
}: Readonly<{
  initialLayout: FormsStatsDashboardLayout | null;
  canViewFinance: boolean;
  queryContext?: FormsStatsQueryContext;
  onBack: () => void;
  onSaved: (layout: FormsStatsDashboardLayout) => void;
}>) {
  const [name, setName] = useState(initialLayout?.name ?? "");
  const [widgets, setWidgets] = useState<readonly FormStatWidget[]>(initialLayout?.widgets ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialLayout?.widgets[0]?.id ?? null);
  const [previewLayout, setPreviewLayout] = useState<FormStatsLayout | null>(null);
  const [stats, setStats] = useState<Readonly<Record<string, FormStatistic>>>({});
  const [states, setStates] = useState<StatisticStates>({});
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const saveOperationRef = useRef<AbortController | null>(null);
  const [initialSnapshot] = useState(() => draftSnapshot(initialLayout?.name ?? "", initialLayout?.widgets ?? []));
  const selectedWidget = widgets.find((widget) => widget.id === selectedId) ?? null;
  const dirty = draftSnapshot(name, widgets) !== initialSnapshot;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveOperationRef.current?.abort();
      saveOperationRef.current = null;
    };
  }, []);

  const previewRequests = useMemo(() => {
    if (!previewLayout) return [];
    const unique = new Map<string, NonNullable<ReturnType<typeof buildFormsStatsStatisticRequest>>>();
    for (const widget of previewLayout.widgets) {
      const request = buildFormsStatsStatisticRequest(widget, queryContext);
      if (request) unique.set(request.key, request);
    }
    return [...unique.values()];
  }, [previewLayout, queryContext]);

  useEffect(() => {
    if (!previewLayout) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setStats({});
        setStates(Object.fromEntries(previewRequests.map((request) => [request.key, "loading"])));
      }
    });
    for (const request of previewRequests) {
      void fetch(request.url, { signal: controller.signal }).then(async (response) => {
        const body = await response.json().catch(() => null) as { stat?: FormStatistic; error?: string } | null;
        if (!response.ok || !body?.stat) throw new Error(body?.error || "Statistic unavailable.");
        if (controller.signal.aborted) return;
        setStats((current) => ({ ...current, [request.key]: body.stat! }));
        setStates((current) => ({ ...current, [request.key]: body.stat!.rows?.length === 0 ? "empty" : undefined }));
      }).catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setStates((current) => ({ ...current, [request.key]: "error" }));
      });
    }
    return () => controller.abort();
  }, [previewLayout, previewRequests]);

  function clearPreview() {
    setPreviewLayout(null);
    setStats({});
    setStates({});
    setFeedback("");
  }

  function changeName(value: string) {
    if (saveOperationRef.current || initialLayout) return;
    clearPreview();
    setName(value);
  }

  function changeWidgets(next: readonly FormStatWidget[]) {
    if (saveOperationRef.current) return;
    clearPreview();
    setWidgets(next);
  }

  function addWidget(type: FormStatWidgetType) {
    if (saveOperationRef.current) return;
    if (widgets.length >= 24) {
      setFeedback("A report can contain no more than 24 controls.");
      return;
    }
    const widget = createWidget(type);
    changeWidgets([...widgets, widget]);
    setSelectedId(widget.id);
  }

  function moveWidget(id: string, offset: -1 | 1) {
    if (saveOperationRef.current) return;
    const index = widgets.findIndex((widget) => widget.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[target]] = [next[target]!, next[index]!];
    changeWidgets(next);
  }

  function removeWidget(id: string) {
    if (saveOperationRef.current) return;
    changeWidgets(widgets.filter((widget) => widget.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function changeSelected(widget: FormStatWidget) {
    if (saveOperationRef.current) return;
    changeWidgets(widgets.map((entry) => entry.id === widget.id ? widget : entry));
  }

  function dragStart(event: DragEvent<HTMLButtonElement>, type: FormStatWidgetType) {
    if (saveOperationRef.current) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", type);
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (saveOperationRef.current) return;
    const type = event.dataTransfer.getData("text/plain") as FormStatWidgetType;
    if (paletteTypes.has(type)) addWidget(type);
  }

  function back() {
    if (saveOperationRef.current) return;
    if (dirty && !window.confirm("Discard unsaved report changes?")) return;
    onBack();
  }

  function preview() {
    if (saveOperationRef.current) return;
    setFeedback("");
    try {
      setPreviewLayout(parseFormStatsLayout({ name: name.trim() || "Preview", widgets }, { canViewFinance }));
    } catch {
      setFeedback("Check every control setting before previewing.");
    }
  }

  async function save() {
    if (saveOperationRef.current) return;
    let layout: FormStatsLayout;
    try {
      layout = parseFormStatsLayout({ name, widgets }, { canViewFinance });
    } catch {
      setFeedback("Enter a report name and check every control setting.");
      return;
    }
    const controller = new AbortController();
    saveOperationRef.current = controller;
    setSaving(true);
    setFeedback("");
    try {
      const response = await fetch("/api/forms/stats/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: layout.name, widgets: layout.widgets }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "The report could not be saved.");
      const parsedResponse = savedLayoutResponseSchema.safeParse(body);
      if (!parsedResponse.success) {
        throw new Error("The saved report response was invalid. Try saving again.");
      }
      if (controller.signal.aborted || saveOperationRef.current !== controller || !mountedRef.current) return;
      onSaved({ id: parsedResponse.data.layout.id, name: layout.name, widgets: layout.widgets });
    } catch (error) {
      if (controller.signal.aborted || saveOperationRef.current !== controller || !mountedRef.current) return;
      setFeedback(error instanceof Error ? error.message : "The report could not be saved.");
    } finally {
      if (saveOperationRef.current === controller) {
        saveOperationRef.current = null;
        if (mountedRef.current) setSaving(false);
      }
    }
  }

  return (
    <section className={styles.statsBuilder} aria-busy={saving} aria-labelledby="custom-report-builder-title">
      <header className={styles.statsBuilderHeader}>
        <div>
          <p>Custom stats</p>
          <h2 id="custom-report-builder-title">Custom report builder</h2>
        </div>
        <span>{widgets.length} / 24 controls</span>
      </header>

      <div className={styles.statsBuilderColumns}>
        <aside className={styles.statsPalette} aria-label="Report controls">
          <section>
            <h3>Layout controls</h3>
            <div className={styles.statsPaletteGrid}>{paletteControls.filter((control) => control.group === "layout").map((control) => (
              <button
                disabled={saving}
                draggable={!saving}
                key={control.type}
                type="button"
                onClick={() => addWidget(control.type)}
                onDragStart={(event) => dragStart(event, control.type)}
              >{control.label}</button>
            ))}</div>
          </section>
          <section>
            <h3>Stat controls</h3>
            <div className={styles.statsPaletteGrid}>{paletteControls.filter((control) => control.group === "stat").map((control) => (
              <button
                disabled={saving}
                draggable={!saving}
                key={control.type}
                type="button"
                onClick={() => addWidget(control.type)}
                onDragStart={(event) => dragStart(event, control.type)}
              >{control.label}</button>
            ))}</div>
          </section>
        </aside>

        <section
          className={styles.statsBuilderCanvas}
          aria-label="Report canvas"
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
          onDrop={drop}
        >
          {widgets.length === 0 ? <div className={styles.statsCanvasEmpty}>
            <strong>Build your report</strong>
            <p>Click a control or drag it here.</p>
          </div> : widgets.map((widget, index) => {
            const request = buildFormsStatsStatisticRequest(widget, queryContext);
            const previewing = Boolean(previewLayout);
            const position = `widget ${index + 1} of ${widgets.length}`;
            return <article
              className={styles.statsCanvasWidget}
              data-selected={selectedId === widget.id}
              data-widget-id={widget.id}
              data-widget-type={widget.type}
              key={widget.id}
            >
              <header>
                <div>
                  <span>{widget.type}</span>
                  <h3>{widget.title}</h3>
                </div>
                <div className={styles.statsCanvasActions}>
                  <button type="button" aria-label={`Select ${widget.title}, ${position}`} aria-pressed={selectedId === widget.id} disabled={saving} onClick={() => { if (!saveOperationRef.current) setSelectedId(widget.id); }}>Select</button>
                  <button type="button" aria-label={`Move ${widget.title} up, ${position}`} disabled={saving || index === 0} onClick={() => moveWidget(widget.id, -1)}>Up</button>
                  <button type="button" aria-label={`Move ${widget.title} down, ${position}`} disabled={saving || index === widgets.length - 1} onClick={() => moveWidget(widget.id, 1)}>Down</button>
                  <button type="button" aria-label={`Remove ${widget.title}, ${position}`} disabled={saving} onClick={() => removeWidget(widget.id)}>Remove</button>
                </div>
              </header>
              {widget.type === "text" || widget.type === "divider" || previewing
                ? <FormsStatsWidgetResult
                    widget={widget}
                    stat={request ? stats[request.key] : undefined}
                    state={request ? states[request.key] : undefined}
                    instanceId={`builder-${widget.id}`}
                  />
                : <p className={styles.statsPreviewHint}>Select Preview to load this statistic.</p>}
            </article>;
          })}
        </section>

        <aside className={styles.statsSettings} aria-label="Builder settings">
          <section>
            <h3>Control settings</h3>
            {selectedWidget
              ? <FormsStatsWidgetEditor widget={selectedWidget} canViewFinance={canViewFinance} disabled={saving} onChange={changeSelected} />
              : <p>Select a control to change its settings.</p>}
          </section>
          <section>
            <h3>Report settings</h3>
            <label>
              <span>Report name</span>
              <input
                aria-describedby={initialLayout ? "saved-report-name-hint" : undefined}
                aria-label="Report name"
                disabled={saving}
                maxLength={80}
                readOnly={Boolean(initialLayout)}
                value={name}
                onChange={initialLayout ? undefined : (event) => changeName(event.target.value)}
              />
            </label>
            {initialLayout ? <p className={styles.statsEditorNote} id="saved-report-name-hint">Saved report names cannot be changed. Create a new report to use a different name.</p> : null}
          </section>
        </aside>
      </div>

      {saving ? <p className={styles.statsLoading} role="status" aria-label="Saving report">Saving report…</p> : null}
      {feedback ? <p className={styles.formFeedback} role="alert">{feedback}</p> : null}
      <footer className={styles.statsBuilderFooter}>
        <button type="button" disabled={saving} onClick={back}>Back</button>
        <div>
          <button type="button" disabled={saving} onClick={preview}>Preview</button>
          <button type="button" aria-label="Save" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </footer>
    </section>
  );
}
