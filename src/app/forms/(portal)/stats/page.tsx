import { FormsStatsWorkbench } from "@/components/forms/forms-stats-workbench";
import styles from "@/components/forms/forms.module.css";
import { getDatabase } from "@/server/db/client";
import { listFormStatsLayouts } from "@/server/forms/drizzle-forms-stats-layout-repository";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { parseFormStatsLayout } from "@/server/forms/forms-stats-service";
import { requireFormsPage } from "@/server/forms/require-forms-page";

export const metadata = { title: "Custom stats" };

export default async function FormsStatsPage() {
  const access = await requireFormsPage("/order-system/stats", "view_stats");
  const canViewFinance = hasFormPermission(access.formRole, access.formProfile, "view_finance");
  const records = await listFormStatsLayouts(getDatabase(), access.user.id);
  const layouts = records.flatMap((record) => {
    try {
      const parsed = parseFormStatsLayout({ name: record.name, widgets: record.widgets }, { canViewFinance });
      return [{ id: record.id, ...parsed }];
    } catch {
      return [];
    }
  });
  return (
    <section className={styles.formsPage}>
      <header className={styles.formsPageHeader}>
        <div>
          <h1>Custom stats</h1>
          <p>Track production volume, delivery mix, work status and authorised finance totals.</p>
        </div>
      </header>
      <FormsStatsWorkbench
        layouts={layouts}
        canManage={hasFormPermission(access.formRole, access.formProfile, "manage_stats")}
        canViewFinance={canViewFinance}
      />
    </section>
  );
}
