import type { FormStatistic } from "@/server/forms/drizzle-forms-stats-repository";
import type { FormStatWidget } from "@/server/forms/forms-stats-service";
import { FormsStatsChart, FormsStatsDataTable, formatStatisticValue } from "./forms-stats-chart";
import styles from "./forms.module.css";

export type FormsStatsWidgetState = "loading" | "empty" | "error";

export function FormsStatsWidgetResult({
  widget,
  stat,
  state,
}: Readonly<{
  widget: FormStatWidget;
  stat?: FormStatistic;
  state?: FormsStatsWidgetState;
}>) {
  if (widget.type === "divider") return <hr className={styles.statDivider} aria-label={widget.title} />;
  if (widget.type === "text") return <p className={styles.statText}>{widget.text}</p>;
  if (state === "error") return <p className={styles.statError} role="alert">Statistic unavailable.</p>;
  if (state === "empty") {
    return <p className={styles.statsEmpty}>No statistics are available.</p>;
  }
  if (state === "loading" || !stat) return <p className={styles.statsLoading} role="status">Loading statistic…</p>;
  if (stat.rows !== undefined && stat.rows.length === 0) return <p className={styles.statsEmpty}>No statistics are available.</p>;
  if (widget.type === "number" && stat.value !== undefined) {
    return <strong className={styles.statNumber}>{formatStatisticValue(widget, stat.value, stat)}</strong>;
  }
  if (widget.type === "table") return <FormsStatsDataTable widget={widget} stat={stat} />;
  if (widget.type === "bar" || widget.type === "line" || widget.type === "pie") {
    return <FormsStatsChart widget={widget} stat={stat} />;
  }
  return <p className={styles.statsEmpty}>No statistics are available.</p>;
}
