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
  const canViewFinance = hasAdminPermission(access.adminRole, access.adminPermissions, "view_production_finance");
  const canViewFiles = hasAdminPermission(access.adminRole, access.adminPermissions, "view_production_files");
  const canUploadFiles = hasAdminPermission(access.adminRole, access.adminPermissions, "upload_production_files");
  const canReviewProofs = hasAdminPermission(access.adminRole, access.adminPermissions, "review_production_proofs");
  const canUpdateJob = hasAdminPermission(access.adminRole, access.adminPermissions, "update_production_jobs");
  const canRetryNotifications = canUploadFiles;
  const runtime = getAdminProductionRuntime();
  const [detail, assignees, proofing, notifications] = await Promise.all([
    runtime.detail(jobId, { canViewFinance }),
    canUpdateJob ? runtime.assignees() : Promise.resolve([]),
    canViewFiles
      ? getAdminProductionProofRuntime().listFiles(jobId, { canViewFinance })
      : Promise.resolve({ files: [], revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false } }),
    canViewFiles && canRetryNotifications
      ? getCustomerNotificationRuntime().listForJob(jobId)
      : Promise.resolve([]),
  ]);
  if (!detail) notFound();
  return (
    <section className={styles.pageSection}>
      <header className={styles.pageHeader}>
        <div><nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href="/admin">Dashboard</Link><span>/</span><Link href="/admin/jobs">Production</Link><span>/</span><span>{detail.job.jobNumber}</span></nav><h1>{detail.job.jobNumber}</h1><p>{detail.job.source === "web" ? "Automatically created from an online order." : "Manually entered studio work."}</p></div>
        <div className={styles.headerActions}><span className={styles.recordCount}>{detail.job.source === "web" ? "Online" : "Manual"}</span>{detail.job.orderId ? <Link className={styles.primaryAdminButton} href={`/admin/orders/${detail.job.orderId}`}>Open online order</Link> : null}</div>
      </header>
      <ProductionJobDetail detail={detail} assignees={assignees} canManageFinance={hasAdminPermission(access.adminRole, access.adminPermissions, "update_production_finance")} files={proofing.files} notifications={notifications} revision={proofing.revision} canViewFiles={canViewFiles} canUploadFiles={canUploadFiles} canReviewProofs={canReviewProofs} canRetryNotifications={canRetryNotifications} canUpdateJob={canUpdateJob} />
    </section>
  );
}
