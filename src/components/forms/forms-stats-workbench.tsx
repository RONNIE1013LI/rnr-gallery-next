"use client";

import { useEffect, useState } from "react";

import { FormsStatsBuilder } from "./forms-stats-builder";
import { FormsStatsDashboard, type FormsStatsDashboardLayout, type FormsStatsQueryContext } from "./forms-stats-dashboard";
import styles from "./forms.module.css";

type Layout = FormsStatsDashboardLayout;

export function FormsStatsWorkbench({
  layouts,
  canManage,
  canViewFinance = true,
  queryContext,
}: Readonly<{
  layouts: readonly Layout[];
  canManage: boolean;
  canViewFinance?: boolean;
  queryContext?: FormsStatsQueryContext;
}>) {
  const [savedLayouts, setSavedLayouts] = useState(layouts);
  const [mode, setMode] = useState<"dashboard" | "builder">("dashboard");
  const [editingLayout, setEditingLayout] = useState<Layout | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setSavedLayouts(layouts);
    });
    return () => { active = false; };
  }, [layouts]);

  function openBuilder(layout: Layout | null) {
    setEditingLayout(layout);
    setMode("builder");
  }

  function closeBuilder() {
    setEditingLayout(null);
    setMode("dashboard");
  }

  function saved(layout: Layout) {
    setSavedLayouts((current) => [
      ...current.filter((entry) => entry.id !== layout.id && entry.name !== layout.name),
      layout,
    ].sort((left, right) => left.name.localeCompare(right.name)));
    closeBuilder();
  }

  return (
    <section className={styles.statsWorkbench} data-testid="forms-stats-workbench" data-mode={mode} data-layout-id={editingLayout?.id ?? ""}>
      {mode === "dashboard" ? <FormsStatsDashboard
        layouts={savedLayouts}
        canManage={canManage}
        canViewFinance={canViewFinance}
        queryContext={queryContext}
        onCreate={() => openBuilder(null)}
        onEdit={openBuilder}
        onDeleted={(layout) => setSavedLayouts((current) => current.filter((entry) => entry.id !== layout.id))}
      /> : null}
      {mode === "builder" ? <FormsStatsBuilder
        initialLayout={editingLayout}
        canViewFinance={canViewFinance}
        queryContext={queryContext}
        onBack={closeBuilder}
        onSaved={saved}
      /> : null}
    </section>
  );
}
