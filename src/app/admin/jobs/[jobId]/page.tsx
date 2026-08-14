import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductionJobDetail } from "@/components/admin/production-job-detail";
import styles from "@/components/admin/admin.module.css";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { hasAdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPage } from "@/server/auth/require-admin-page";
import { getCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";

type Props = Readonly<{ params: Promise<{ jobId: string }> }>;

export default async function ProductionJobDetailPage({ params }: Props) {
  const { jobId } = await params;
  const access = await requireAdminPage(`/admin/jobs/${encodeURIComponent(jobId)}`, "view_production_jobs");
  const canViewFinance = hasAdminPermission(access.adminRole, "view_production_finance");
  const runtime = getAdminProductionRuntime();
  const [detail, assignees, proofing, notifications] = await Promise.all([
    runtime.detail(jobId, { canViewFinance }),
    runtime.assignees(),
    getAdminProductionProofRuntime().listFiles(jobId, { canViewFinance }),
    getCustomerNotificationRuntime().listForJob(jobId),
  ]);
  if (!detail) notFound();
  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/jobs">Production</Link><span>/</span><span>{detail.job.jobNumber}</span></nav><h1>{detail.job.jobNumber}</h1><p>{detail.job.source === "web" ? "Automatically created from an online order." : "Manually entered studio work."}</p></div>
        <div className={styles.headerActions}><span className={styles.recordCount}>{detail.job.source === "web" ? "Online" : "Manual"}</span>{detail.job.orderId ? <Link className={styles.primaryAdminButton} href={`/admin/orders/${detail.job.orderId}`}>Open online order</Link> : null}</div>
      </header>
      <ProductionJobDetail detail={detail} assignees={assignees} canManageFinance={hasAdminPermission(access.adminRole, "update_production_finance")} files={proofing.files} notifications={notifications} revision={proofing.revision} />
    </section>
  );
}
