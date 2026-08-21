"use client";

import Image from "next/image";
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
  paymentProofOnly?: boolean;
  canDeleteFiles?: boolean;
}>;

type UploadResult = Readonly<{
  error?: string;
  result?: "created" | "duplicate";
  notification?: Readonly<{ result?: "sent" | "failed" | "not_configured" | "empty" }> | null;
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
  canUploadFiles = false,
  canReviewProofs = false,
  canRetryNotifications = false,
  notifications = [],
  jobApiBase = "/api/admin/jobs",
  notificationRetryEndpoint = "/api/admin/notifications/retry",
  paymentProofOnly = false,
  canDeleteFiles = false,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selectedKind, setSelectedKind] = useState("design_draft");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement | null;
    const selectedFiles = Array.from(input?.files ?? []);
    const bodies = paymentProofOnly ? selectedFiles.map((file) => {
      const body = new FormData();
      body.set("kind", "payment_proof");
      body.set("file", file);
      body.set("idempotencyKey", createClientId());
      return body;
    }) : (() => {
      const body = new FormData(form);
      body.set("idempotencyKey", createClientId());
      return [body];
    })();
    setPending(true);
    setFeedback("");
    try {
      let result: UploadResult | null = null;
      for (const body of bodies) {
        const response = await fetch(`${jobApiBase}/${jobId}/files`, { method: "POST", body });
        result = await response.json().catch(() => null) as UploadResult | null;
        if (!response.ok) throw new Error(result?.error || "The file could not be uploaded.");
      }
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
                : paymentProofOnly && bodies.length > 1
                  ? `${bodies.length} payment proofs uploaded.`
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

  async function deletePaymentProof(file: ProductionFileSummary) {
    if (!window.confirm("Delete this uploaded proof?")) return;
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`${jobApiBase}/${jobId}/files/${file.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "The payment proof could not be deleted.");
      setFeedback("Payment proof deleted.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The payment proof could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  const revisionLabel = `${revision.freeRevisionsRemaining} free revision${revision.freeRevisionsRemaining === 1 ? "" : "s"} remaining`;
  const visibleFiles = paymentProofOnly ? files.filter((file) => file.kind === "payment_proof") : files;
  const acceptsPdf = paymentProofOnly || selectedKind === "payment_proof";
  const acceptedFileTypes = acceptsPdf
    ? "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
    : "image/jpeg,image/png,image/webp,image/heic,image/heif";
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        {paymentProofOnly ? <strong>PaymtProved</strong> : <h2>Files &amp; customer proofing</h2>}
        <span>{visibleFiles.length} file{visibleFiles.length === 1 ? "" : "s"}</span>
      </div>
      {!paymentProofOnly ? <div className={styles.proofGuidance} data-warning={revision.requiresAdditionalChargeReview}>
        <strong>{revisionLabel}</strong>
        <p>Two change-request rounds are included. A different source photo may require $25; further revisions may require $30. Confirm any charge with the customer before adding it to an order.</p>
      </div> : null}

      {canUploadFiles ? <form className={`${styles.compactForm} ${styles.fileUploadForm}`} onSubmit={upload}>
        {paymentProofOnly ? <input name="kind" type="hidden" value="payment_proof" /> : <label><span>File purpose</span><select name="kind" value={selectedKind} onChange={(event) => setSelectedKind(event.target.value)} disabled={pending}>
          <option value="design_draft">Design draft</option>
          <option value="customer_file">Customer file</option>
          <option value="print_file">Print file</option>
          {canManageFinance ? <option value="payment_proof">Payment proof</option> : null}
        </select></label>}
        <label className={styles.fileInput}><span>{paymentProofOnly ? "PaymtProved" : acceptsPdf ? "Payment proof file" : "Image file"}</span><input name="file" type="file" multiple={paymentProofOnly} accept={acceptedFileTypes} required disabled={pending} /></label>
        <button type="submit" disabled={pending}>{paymentProofOnly ? "Upload proof" : "Upload private file"}</button>
      </form> : null}

      {visibleFiles.length ? <div className={`${styles.productionFiles} ${paymentProofOnly ? styles.paymentProofPreviewGrid : ""}`}>{visibleFiles.map((file) => (
        <article className={paymentProofOnly ? styles.paymentProofPreviewCard : undefined} key={file.id}>
          {paymentProofOnly ? <div className={styles.paymentProofPreviewMedia}>
            {file.mediaType.startsWith("image/") ? <Image src={`${jobApiBase}/${jobId}/files/${file.id}`} alt={`Payment proof ${file.originalName}`} fill sizes="160px" unoptimized /> : <span>PDF</span>}
            {canDeleteFiles ? <button type="button" className={styles.paymentProofDeleteButton} disabled={pending} aria-label={`Delete ${file.originalName}`} onClick={() => void deletePaymentProof(file)}><span aria-hidden="true">×</span></button> : null}
          </div> : null}
          <div className={styles.fileSummary}>
            <div><strong>{fileTitle(file)}</strong><span>{paymentProofOnly ? `${(file.sizeBytes / 1024).toFixed(file.sizeBytes < 10240 ? 1 : 0)} KB` : `${file.originalName} · ${(file.sizeBytes / 1024).toFixed(file.sizeBytes < 10240 ? 1 : 0)} KB`}</span></div>
            <div><small>{dateTime.format(file.createdAt)}</small><a href={`${jobApiBase}/${jobId}/files/${file.id}?download=1`}>Download</a>{!paymentProofOnly && canDeleteFiles ? <button type="button" disabled={pending} aria-label={`Delete ${file.originalName}`} onClick={() => void deletePaymentProof(file)}>Delete</button> : null}</div>
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
