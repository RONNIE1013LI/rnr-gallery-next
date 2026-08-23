"use client";

import { useState } from "react";

import { FormsStatsDashboard, type FormsStatsDashboardLayout } from "./forms-stats-dashboard";
import styles from "./forms.module.css";

type Layout = FormsStatsDashboardLayout;

export function FormsStatsWorkbench({
  layouts,
  canManage,
  canViewFinance = true,
}: Readonly<{
  layouts: readonly Layout[];
  canManage: boolean;
  canViewFinance?: boolean;
}>) {
  const [savedLayouts, setSavedLayouts] = useState(layouts);
  const [mode, setMode] = useState<"dashboard" | "builder">("dashboard");
  const [editingLayout, setEditingLayout] = useState<Layout | null>(null);

  function openBuilder(layout: Layout | null) {
    setEditingLayout(layout);
    setMode("builder");
  }

  return (
    <section className={styles.statsWorkbench} data-testid="forms-stats-workbench" data-mode={mode} data-layout-id={editingLayout?.id ?? ""}>
      {mode === "dashboard" ? <FormsStatsDashboard
        layouts={savedLayouts}
        canManage={canManage}
        canViewFinance={canViewFinance}
        onCreate={() => openBuilder(null)}
        onEdit={openBuilder}
        onDeleted={(layout) => setSavedLayouts((current) => current.filter((entry) => entry.id !== layout.id))}
      /> : null}
    </section>
  );
}
