import { FORM_OPTION_SETS } from "@/domain/forms/forms-parity";
import {
  ProductionJobForm,
  type ExistingManualProductionOrder,
} from "@/components/admin/production-job-form";
import type { getProductionJobDetail, ProductionAssignee } from "@/server/production/drizzle-production-job-repository";
import type { ProductionFileSummary } from "@/server/production/production-proof-service";

type Detail = NonNullable<Awaited<ReturnType<typeof getProductionJobDetail>>>;
const dateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Pacific/Auckland",
});

function sizeFields(sizeLabel: string) {
  if (FORM_OPTION_SETS.size.includes(sizeLabel) && sizeLabel !== "Custom Size" && sizeLabel !== "Other") {
    return { size: sizeLabel, sizeOther: "" };
  }
  return { size: "Custom Size", sizeOther: sizeLabel };
}

export function ExistingManualProductionJobForm({
  detail,
  assignees,
  files,
  canManageFinance,
  canUploadFiles,
  canDeleteFiles,
  canEdit,
  canUpdateProductionStatus,
  canUpdateDeliveryStatus,
  jobApiBase,
  invoicePdfBase,
  onSaved,
  onBack,
}: Readonly<{
  detail: Detail;
  assignees: readonly ProductionAssignee[];
  files: readonly ProductionFileSummary[];
  canManageFinance: boolean;
  canUploadFiles: boolean;
  canDeleteFiles: boolean;
  canEdit: boolean;
  canUpdateProductionStatus: boolean;
  canUpdateDeliveryStatus: boolean;
  jobApiBase: string;
  invoicePdfBase: string;
  onSaved?: () => void;
  onBack?: () => void;
}>) {
  const firstItem = detail.items[0];
  const size = sizeFields(firstItem?.sizeLabel || "Other");
  const createdAudit = detail.audit.find((entry) => entry.action === "production_job.created");
  const existingManualOrder: ExistingManualProductionOrder = {
    id: detail.job.id,
    jobNumber: detail.job.jobNumber,
    expectedUpdatedAt: detail.job.updatedAt.toISOString(),
    submittedAt: dateTime.format(detail.job.createdAt),
    updatedAt: dateTime.format(detail.job.updatedAt),
    submittedBy: createdAudit?.actorName?.trim() || "Former staff",
    ...size,
    customerName: detail.job.customerName,
    customerEmail: detail.job.customerEmail,
    customerPhone: detail.job.customerPhone,
    customerSource: detail.job.customerSource,
    urgent: detail.job.urgent,
    neededDate: detail.job.neededDate,
    deliveryMethod: detail.job.deliveryMethod,
    deliveryAddress: detail.job.deliveryAddress,
    paymentReconciliationStatus: detail.job.paymentReconciliationStatus,
    assignedUserId: detail.job.assignedUserId,
    internalNotes: detail.job.internalNotes,
    manualStatus: detail.status,
    amountPayableCents: detail.finance?.amountPayableCents ?? 0,
    amountPaidCents: detail.finance?.amountPaidCents ?? 0,
    materialCostCents: detail.finance?.materialCostCents ?? 0,
    milestones: {
      fileSent: Boolean(detail.job.fileSentAt),
      downloaded: Boolean(detail.job.downloadedAt),
      printed: Boolean(detail.job.printedAt),
      completed: Boolean(detail.job.completedAt),
      customerNotified: Boolean(detail.job.customerNotifiedAt),
      delivered: Boolean(detail.job.deliveredAt),
    },
    audit: detail.audit.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorName: entry.actorName?.trim() || "Former staff",
      createdAt: dateTime.format(entry.createdAt),
      beforeSummary: entry.beforeSummary && typeof entry.beforeSummary === "object" ? entry.beforeSummary : null,
      afterSummary: entry.afterSummary && typeof entry.afterSummary === "object" ? entry.afterSummary : null,
    })),
  };

  return <ProductionJobForm
    assignees={assignees}
    canManageFinance={canManageFinance}
    canUploadFiles={canUploadFiles}
    canDeleteFiles={canDeleteFiles}
    canEdit={canEdit}
    canUpdateProductionStatus={canUpdateProductionStatus}
    canUpdateDeliveryStatus={canUpdateDeliveryStatus}
    endpoint={jobApiBase}
    detailBasePath="/order-system/jobs"
    backHref="/order-system"
    invoicePdfBase={invoicePdfBase}
    manualEntryLayout
    existingManualOrder={existingManualOrder}
    existingPaymentProofs={files}
    onSaved={onSaved}
    onBack={onBack}
  />;
}
