"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ProductionJobDetail } from "@/components/admin/production-job-detail";
import { displayFormReference } from "@/domain/forms/forms-parity";
import { ResizableSeparator } from "@/components/shared/resizable-separator";
import type { getProductionJobDetail, ProductionAssignee } from "@/server/production/drizzle-production-job-repository";
import type { ProductionFileSummary } from "@/server/production/production-proof-service";
import type { CustomerNotificationSummary } from "@/server/notifications/customer-notification-service";
import styles from "./forms.module.css";
import { ExistingManualProductionJobForm } from "./existing-manual-production-job-form";
import { usePersistentDrawerWidth } from "./forms-order-entry-drawer";
import { useContainedDialog } from "./use-contained-dialog";

type Detail = NonNullable<Awaited<ReturnType<typeof getProductionJobDetail>>>;

function reviveDates(value: unknown, key = ""): unknown {
  if (typeof value === "string" && key.endsWith("At") && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value);
  if (Array.isArray(value)) return value.map((entry) => reviveDates(entry));
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [entryKey, reviveDates(entry, entryKey)]),
  );
  return value;
}

function FormsJobDrawerSession({
  jobId,
  onClose,
  assignees,
  canManageFinance,
  canUpdate = false,
  canViewFiles = false,
  canUploadFiles = false,
  canReviewProofs = false,
  canUpdateDeliveryStatus = false,
  canDeleteFiles = false,
  onSaved,
}: Readonly<{
  jobId: string;
  onClose: () => void;
  assignees: readonly ProductionAssignee[];
  canManageFinance: boolean;
  canUpdate?: boolean;
  canViewFiles?: boolean;
  canUploadFiles?: boolean;
  canReviewProofs?: boolean;
  canUpdateDeliveryStatus?: boolean;
  canDeleteFiles?: boolean;
  onSaved?: () => void;
}>) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [files, setFiles] = useState<readonly ProductionFileSummary[]>([]);
  const [notifications, setNotifications] = useState<readonly CustomerNotificationSummary[]>([]);
  const [loadedAssignees, setLoadedAssignees] = useState<readonly ProductionAssignee[]>(assignees);
  const [revision, setRevision] = useState({ changesRequested: 0, freeRevisionsRemaining: 2, requiresAdditionalChargeReview: false });
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const { limits, width, chooseWidth } = usePersistentDrawerWidth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const displayedReference = detail ? displayFormReference(detail.job.source, detail.job.jobNumber) : null;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/forms/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as {
        detail?: unknown;
        files?: unknown;
        notifications?: unknown;
        assignees?: unknown;
        revision?: unknown;
        error?: string;
      } | null;
      if (!response.ok || !body?.detail) throw new Error(body?.error || "The order could not be loaded.");
      setDetail(reviveDates(body.detail) as Detail);
      if (Array.isArray(body.files)) setFiles(reviveDates(body.files) as readonly ProductionFileSummary[]);
      if (Array.isArray(body.notifications)) setNotifications(reviveDates(body.notifications) as readonly CustomerNotificationSummary[]);
      if (Array.isArray(body.assignees)) setLoadedAssignees(body.assignees as readonly ProductionAssignee[]);
      if (body.revision && typeof body.revision === "object") setRevision(body.revision as typeof revision);
    }).catch((requestError) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "The order could not be loaded.");
    });
    return () => controller.abort();
  }, [assignees, jobId]);

  function close() {
    if (dirty && !window.confirm("Discard unsaved changes to this order?")) return;
    onClose();
  }

  useContainedDialog({
    active: true,
    dialogRef,
    initialFocusRef: closeButtonRef,
    isolationRootRef: backdropRef,
    onClose: close,
  });

  return (
    <div ref={backdropRef} className={styles.drawerBackdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div
        ref={dialogRef}
        className={styles.orderEntryDrawer}
        role="dialog"
        aria-modal="true"
        aria-label={displayedReference ? `Order ${displayedReference}` : "Order editor"}
        tabIndex={-1}
        style={{ "--entry-drawer-width": `${width}px` } as React.CSSProperties}
      >
        <ResizableSeparator
          className={styles.orderEntryResizeHandle}
          label="Resize order editor"
          value={width}
          min={limits.min}
          max={limits.max}
          step={20}
          direction={-1}
          onChange={chooseWidth}
        />
        <div className={styles.orderEntryDrawerPanel}>
        <header className={styles.drawerHeader}>
          <div><strong>{displayedReference ?? "Loading order…"}</strong><span>{dirty ? "Unsaved changes" : "Order editor"}</span></div>
          <Link href={`/order-system/jobs/${encodeURIComponent(jobId)}`}>Open full editor</Link>
          <button ref={closeButtonRef} type="button" aria-label="Close order editor" onClick={close}>×</button>
        </header>
        <div className={`${styles.orderEntryDrawerContent} ${styles.formsEditor}`} data-forms-editor onChangeCapture={() => setDirty(true)}>
          {error ? <div className={styles.formsErrorState} role="alert"><strong>Order unavailable</strong><p>{error}</p><button type="button" onClick={onClose}>Return to data list</button></div> : null}
          {!detail && !error ? <div className={styles.drawerLoading} role="status">Loading order details…</div> : null}
          {detail?.job.source === "manual" ? <ExistingManualProductionJobForm
            detail={detail}
            assignees={loadedAssignees}
            files={files}
            canManageFinance={canManageFinance}
            canUploadFiles={canUploadFiles}
            canDeleteFiles={canDeleteFiles}
            canEdit={canUpdate}
            canUpdateProductionStatus={canReviewProofs}
            canUpdateDeliveryStatus={canUpdateDeliveryStatus}
            jobApiBase="/api/forms/jobs"
            invoicePdfBase="/api/forms/invoices"
            onBack={close}
            onSaved={() => {
              setDirty(false);
              onSaved?.();
            }}
          /> : detail ? <ProductionJobDetail
            detail={detail}
            assignees={loadedAssignees}
            canManageFinance={canManageFinance}
            files={files}
            notifications={notifications}
            revision={revision}
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
          /> : null}
        </div>
        </div>
      </div>
    </div>
  );
}

export function FormsJobDrawer(props: Readonly<{
  jobId: string;
  onClose: () => void;
  assignees: readonly ProductionAssignee[];
  canManageFinance: boolean;
  canUpdate?: boolean;
  canViewFiles?: boolean;
  canUploadFiles?: boolean;
  canReviewProofs?: boolean;
  canUpdateDeliveryStatus?: boolean;
  canDeleteFiles?: boolean;
  onSaved?: () => void;
}>) {
  return <FormsJobDrawerSession key={props.jobId} {...props} />;
}
