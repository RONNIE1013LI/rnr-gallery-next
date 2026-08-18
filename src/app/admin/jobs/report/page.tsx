import Link from "next/link";
import styles from "@/components/admin/admin.module.css";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { buildProductionReport } from "@/server/production/production-operations-service";
import { parseProductionJobFilters } from "@/server/production/production-job-service";

export const metadata = { title: "Production report | R&R Gallery Admin" };
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
function amount(cents: number) { return money.format(cents / 100); }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default async function ProductionReportPage() {
  const access = await requireAdminPage("/admin/jobs/report", "view_production_reports");
  const canViewFinance = hasAdminPermission(access.adminRole, access.adminPermissions, "view_production_finance");
  const filters = { ...parseProductionJobFilters({ sort: "needed", direction: "asc" }), page: 1, pageSize: 5_000 };
  const result = await getAdminProductionRuntime().list(filters, { canViewFinance });
  const report = buildProductionReport(result.items, new Date(), { canViewFinance });
  const metrics = [
    ["Active", report.metrics.active], ["Overdue", report.metrics.overdue], ["Due within 2 days", report.metrics.dueSoon],
    ["Urgent", report.metrics.urgent], ["Unassigned", report.metrics.unassigned], ["All jobs", report.metrics.total],
  ] as const;
  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/jobs">Production</Link><span>/</span><span>Report</span></nav><h1>Production report</h1><p>Live operational attention, capacity and status totals. This report does not send customer or staff notifications.</p></div>
        <div className={styles.headerActions}><Link className={styles.recordCount} href="/admin/jobs">Back to production</Link>{hasAdminPermission(access.adminRole, access.adminPermissions, "export_production_jobs") ? <Link prefetch={false} className={styles.primaryAdminButton} href="/api/admin/jobs/export">Export all CSV</Link> : null}</div>
      </header>

      <section className={styles.reportMetrics}>{metrics.map(([name, value]) => <article key={name}><span>{name}</span><strong>{value}</strong></article>)}</section>

      <div className={styles.reportGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><h2>Needs attention</h2><span>{report.attention.length} shown</span></div>
          {report.attention.length ? <div className={styles.attentionList}>{report.attention.map((item) => <Link key={item.id} href={`/admin/jobs/${item.id}`}><span><strong>{item.jobNumber}</strong><small>{item.customerName}</small></span><span>{item.reasons.map((reason) => <b key={reason}>{reason}</b>)}</span><time>{item.neededDate}</time></Link>)}</div> : <p className={styles.mutedText}>Nothing currently needs attention.</p>}
        </section>
        <div className={styles.reportAside}>
          <section className={styles.panel}><h2>Active workload</h2>{report.workload.length ? <div className={styles.stackedDefinitionList}>{report.workload.map((person) => <div key={person.assignedUserId}><dt>{person.assignedUserName}</dt><dd>{person.activeJobs}</dd></div>)}</div> : <p className={styles.mutedText}>No assigned active jobs.</p>}</section>
          <section className={styles.panel}><h2>Status totals</h2><div className={styles.stackedDefinitionList}>{Object.entries(report.statusCounts).map(([status, count]) => <div key={status}><dt>{label(status)}</dt><dd>{count}</dd></div>)}</div></section>
        </div>
      </div>

      {report.finance ? <section className={styles.panel}><div className={styles.panelHeading}><h2>Finance</h2><span>Administrator only</span></div><div className={styles.financeMetrics}>{[
        ["Original order value", report.finance.payableCents], ["Gross paid", report.finance.paidCents], ["Refunded", report.finance.refundedCents],
        ["Net collected", report.finance.netCollectedCents], ["Amount owing", report.finance.owingCents], ["Artist fees", report.finance.artistFeeCents],
        ["Material costs", report.finance.materialCostCents], ["Recorded net profit", report.finance.actualProfitCents],
      ].map(([name, cents]) => <div key={name}><span>{name}</span><strong>{amount(cents as number)}</strong></div>)}</div><p className={styles.mutedText}>Refunded and cancelled orders are never counted as customer debt. Profit includes only jobs with recorded cost data.</p></section> : null}
    </section>
  );
}
