"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import type { ProductionFileSummary } from "@/server/production/production-proof-service";
import type { CustomerNotificationSummary } from "@/server/notifications/customer-notification-service";
import styles from "./admin.module.css";

type Props = Readonly<{
  jobId: string;
  files: readonly ProductionFileSummary[];
  revision: Readonly<{
    changesRequested: number;
    freeRevisionsRemaining: number;
    requiresAdditionalChargeReview: boolean;
  }>;
  canManageFinance: boolean;
  canUploadFiles?: boolean;
  canReviewProofs?: boolean;
  canRetryNotifications?: boolean;
  notifications?: readonly CustomerNotificationSummary[];
  jobApiBase?: string;
  notificationRetryEndpoint?: string;
}>;

const dateTime = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" });

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fileTitle(file: ProductionFileSummary) {
  return file.kind === "design_draft" ? `Design draft v${file.version}` : label(file.kind);
}

export function ProductionFilesPanel({
  jobId,
  files,
  revision,
  canManageFinance,
  canUploadFiles = true,
  canReviewProofs = true,
  canRetryNotifications = true,
  notifications = [],
  jobApiBase = "/api/admin/jobs",
  notificationRetryEndpoint = "/api/admin/notifications/retry",
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selectedKind, setSelectedKind] = useState("design_draft");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("idempotencyKey", createClientId());
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`${jobApiBase}/${jobId}/files`, { method: "POST", body });
      const result = await response.json().catch(() => null) as {
        error?: string;
        result?: "created" | "duplicate";
        notification?: { result?: "sent" | "failed" | "not_configured" | "empty" } | null;
      } | null;
      if (!response.ok) throw new Error(result?.error || "The file could not be uploaded.");
      form.reset();
      setSelectedKind("design_draft");
      setFeedback(
        result?.notification?.result === "sent"
          ? "File uploaded and the customer was notified."
          : result?.notification?.result === "not_configured"
            ? "File uploaded. Customer email is pending until email delivery is configured."
            : result?.notification?.result === "failed"
              ? "File uploaded. Customer email is pending an automatic retry."
              : result?.result === "duplicate"
                ? "This file upload was already recorded."
                : "File uploaded.",
      );
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The file could not be uploaded.");
    } finally {
      setPending(false);
    }
  }

  async function review(event: FormEvent<HTMLFormElement>, fileId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`${jobApiBase}/${jobId}/proof-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          decision: String(form.get("decision") ?? "approved"),
          notes: String(form.get("notes") ?? ""),
          idempotencyKey: createClientId(),
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "The decision could not be recorded.");
      setFeedback("Decision recorded.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The decision could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  async function retryNotification(fileId: string) {
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(notificationRetryEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, fileId }),
      });
      const result = await response.json().catch(() => null) as { error?: string; result?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Customer email could not be retried.");
      setFeedback(result?.result === "sent" ? "Customer email sent." : "No pending customer email was found.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Customer email could not be retried.");
    } finally {
      setPending(false);
    }
  }

  const revisionLabel = `${revision.freeRevisionsRemaining} free revision${revision.freeRevisionsRemaining === 1 ? "" : "s"} remaining`;
  const acceptsPdf = selectedKind === "payment_proof";
  const acceptedFileTypes = acceptsPdf
    ? "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
    : "image/jpeg,image/png,image/webp,image/heic,image/heif";
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <h2>Files &amp; customer proofing</h2>
        <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
      </div>
      <div className={styles.proofGuidance} data-warning={revision.requiresAdditionalChargeReview}>
        <strong>{revisionLabel}</strong>
        <p>Two change-request rounds are included. A different source photo may require $25; further revisions may require $30. Confirm any charge with the customer before adding it to an order.</p>
      </div>

      {canUploadFiles ? <form className={`${styles.compactForm} ${styles.fileUploadForm}`} onSubmit={upload}>
        <label><span>File purpose</span><select name="kind" value={selectedKind} onChange={(event) => setSelectedKind(event.target.value)} disabled={pending}>
          <option value="design_draft">Design draft</option>
          <option value="customer_file">Customer file</option>
          <option value="print_file">Print file</option>
          {canManageFinance ? <option value="payment_proof">Payment proof</option> : null}
        </select></label>
        <label className={styles.fileInput}><span>{acceptsPdf ? "Payment proof file" : "Image file"}</span><input name="file" type="file" accept={acceptedFileTypes} required disabled={pending} /></label>
        <button type="submit" disabled={pending}>Upload private file</button>
      </form> : null}

      {files.length ? <div className={styles.productionFiles}>{files.map((file) => (
        <article key={file.id}>
          <div className={styles.fileSummary}>
            <div><strong>{fileTitle(file)}</strong><span>{file.originalName} · {(file.sizeBytes / 1024).toFixed(file.sizeBytes < 10240 ? 1 : 0)} KB</span></div>
            <div><small>{dateTime.format(file.createdAt)}</small><a href={`${jobApiBase}/${jobId}/files/${file.id}?download=1`}>Download</a></div>
          </div>
          {file.kind === "design_draft" && notifications.find((item) => item.fileId === file.id) ? (() => {
            const notification = notifications.find((item) => item.fileId === file.id)!;
            const text = notification.status === "sent"
              ? "Customer email sent"
              : notification.status === "sending"
                ? "Customer email sending"
                : notification.status === "pending"
                  ? "Customer email pending"
                  : notification.attempts >= 5
                    ? "Customer email needs manual retry"
                    : "Customer email retry scheduled";
            return <div className={styles.notificationStatus} data-status={notification.status}>
              <span>{text}</span>
              {notification.status !== "sent" && canRetryNotifications ? <button type="button" disabled={pending} onClick={() => void retryNotification(file.id)}>Retry customer email</button> : null}
            </div>;
          })() : null}
          {file.review ? <div className={styles.proofDecision} data-decision={file.review.decision}>
            <strong>{label(file.review.decision)} · {file.review.reviewerType === "customer" ? "Customer portal" : "Recorded by staff"}</strong>
            {file.review.notes ? <p>{file.review.notes}</p> : null}
          </div> : file.kind === "design_draft" && canReviewProofs ? <form className={`${styles.compactForm} ${styles.proofForm}`} onSubmit={(event) => review(event, file.id)}>
            <label><span>Customer decision</span><select name="decision" defaultValue="approved" disabled={pending}><option value="approved">Approved</option><option value="changes_requested">Changes requested</option></select></label>
            <label><span>Decision notes</span><textarea name="notes" rows={2} maxLength={5000} placeholder="Record the customer’s instructions or approval channel." disabled={pending} /></label>
            <button type="submit" disabled={pending}>Record decision</button>
          </form> : null}
        </article>
      ))}</div> : <p className={styles.mutedText}>No production files have been added yet.</p>}
      <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
    </section>
  );
}
