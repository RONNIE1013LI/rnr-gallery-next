import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductionJobDetail } from "@/components/admin/production-job-detail";
import { ExistingManualProductionJobForm } from "@/components/forms/existing-manual-production-job-form";
import { displayFormReference } from "@/domain/forms/forms-parity";
import styles from "@/components/forms/forms.module.css";
import { getAdminProductionProofRuntime } from "@/server/admin/admin-production-proof-runtime";
import { getAdminProductionRuntime } from "@/server/admin/admin-production-runtime";
import { hasFormPermission } from "@/server/forms/forms-permissions";
import { requireFormsPage } from "@/server/forms/require-forms-page";
import { getCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";

type Props = Readonly<{ params: Promise<{ jobId: string }> }>;

export default async function FormsJobDetailPage({ params }: Props) {
  const { jobId } = await params;
  const path = `/order-system/jobs/${encodeURIComponent(jobId)}`;
  const access = await requireFormsPage(path, "view_jobs");
  const canViewFinance = hasFormPermission(access.formRole, access.formProfile, "view_finance");
  const canViewFiles = hasFormPermission(access.formRole, access.formProfile, "view_files");
  const canViewPaymentProof = hasFormPermission(access.formRole, access.formProfile, "view_payment_proof");
  const canViewContact = hasFormPermission(access.formRole, access.formProfile, "view_customer_contact");
  const canViewAudit = hasFormPermission(access.formRole, access.formProfile, "view_audit");
  const canUpdate = hasFormPermission(access.formRole, access.formProfile, "update_jobs");
  const canManageFinance = hasFormPermission(access.formRole, access.formProfile, "update_finance");
  const canUploadFiles = hasFormPermission(access.formRole, access.formProfile, "upload_files");
  const canReviewProofs = hasFormPermission(access.formRole, access.formProfile, "update_production_status");
  const canDeleteFiles = hasFormPermission(access.formRole, access.formProfile, "delete_files");
  const runtime = getAdminProductionRuntime();
  const [detail, assignees, proofing, notifications] = await Promise.all([
    runtime.detail(jobId, { canViewFinance }),
    canUpdate ? runtime.assignees() : Promise.resolve([]),
    canViewFiles
      ? getAdminProductionProofRuntime().listFiles(jobId, { canViewFinance, canViewPaymentProof })
      : Promise.resolve({
          files: [],
          revision: { changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false },
        }),
    canViewFiles
      ? getCustomerNotificationRuntime().listForJob(jobId)
      : Promise.resolve([]),
  ]);
  if (
    !detail ||
    (access.formProfile?.assignedOnly && detail.job.assignedUserId !== access.user.id)
  ) {
    notFound();
  }

  const visibleDetail = {
    ...detail,
    job: {
      ...detail.job,
      customerEmail: canViewContact ? detail.job.customerEmail : "",
      customerPhone: canViewContact ? detail.job.customerPhone : "",
    },
    finance: canViewFinance ? detail.finance : null,
    audit: canViewAudit ? detail.audit : [],
  };
  const displayedReference = displayFormReference(detail.job.source, detail.job.jobNumber);

  return (
    <section className={styles.formsPage}>
      <header className={styles.formsPageHeader}>
        <div>
          <nav aria-label="Breadcrumb">
            <Link href="/order-system">Data list</Link><span>/</span><span>{displayedReference}</span>
          </nav>
          <h1>{displayedReference}</h1>
          <p>{detail.job.source === "web" ? "Automatically created from an online order." : "Manually entered studio work."}</p>
        </div>
      </header>
      {visibleDetail.job.source === "manual" ? <ExistingManualProductionJobForm
        detail={visibleDetail}
        assignees={assignees}
        files={proofing.files}
        canManageFinance={canManageFinance}
        canUploadFiles={canUploadFiles}
        canDeleteFiles={canDeleteFiles}
        canEdit={canUpdate}
        canUpdateProductionStatus={canReviewProofs}
        canUpdateDeliveryStatus={hasFormPermission(access.formRole, access.formProfile, "update_delivery_status")}
        jobApiBase="/api/forms/jobs"
        invoicePdfBase="/api/forms/invoices"
      /> : <ProductionJobDetail
        detail={visibleDetail}
        assignees={assignees}
        canManageFinance={canManageFinance}
        files={proofing.files}
        notifications={notifications}
        revision={proofing.revision}
        jobApiBase="/api/forms/jobs"
        invoicePdfBase="/api/forms/invoices"
        orderBasePath={null}
        notificationRetryEndpoint="/api/forms/notifications/retry"
        canViewFiles={canViewFiles}
        canUploadFiles={canUploadFiles}
        canReviewProofs={canReviewProofs}
        canDeleteFiles={canDeleteFiles}
        canRetryNotifications={canUploadFiles}
        canUpdateJob={canUpdate}
        manualEntryLayout
      />}
    </section>
  );
}
