"use client";

import Image from "next/image";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientId } from "@/lib/client-id";
import type { OrderFulfilmentStatus, ProductionProofDecision } from "@/server/db/schema";
import styles from "./storefront.module.css";

type Review = Readonly<{
  id: string;
  decision: ProductionProofDecision;
  notes: string;
  reviewerType: "staff" | "customer";
  createdAt: string;
}>;

type ProofFile = Readonly<{
  id: string;
  version: number;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  review: Review | null;
}>;

export type CustomerProofView = Readonly<{
  orderNumber: string;
  fulfilmentStatus: OrderFulfilmentStatus;
  files: readonly ProofFile[];
  revision: Readonly<{
    changesRequested: number;
    freeRevisionsRemaining: number;
    requiresAdditionalChargeReview: boolean;
  }>;
}>;

type AccessQuery = Readonly<{ expires: string; signature: string }>;

const dateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Pacific/Auckland",
});

function revisionLabel(count: number) {
  return `${count} free revision${count === 1 ? "" : "s"} remaining`;
}

function imageUrl(orderNumber: string, fileId: string, access?: AccessQuery) {
  const path = `/api/orders/${encodeURIComponent(orderNumber)}/proofs/${fileId}`;
  if (!access) return path;
  const query = new URLSearchParams(access);
  return `${path}?${query.toString()}`;
}

export function CustomerProofPanel({ proof, access }: Readonly<{
  proof: CustomerProofView;
  access?: AccessQuery;
}>) {
  const router = useRouter();
  const latest = proof.files[0];
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const keys = useRef({ approved: createClientId(), changes_requested: createClientId() });
  if (!latest) return null;

  async function submit(decision: ProductionProofDecision, notes: string) {
    if (decision === "approved" && !approvalConfirmed) {
      setFeedback("Confirm that you approve this design draft for production.");
      return;
    }
    if (decision === "changes_requested" && !notes.trim()) {
      setFeedback("List all requested changes together before submitting.");
      return;
    }
    setPending(true);
    setFeedback("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(proof.orderNumber)}/proof-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: latest.id,
          decision,
          notes: decision === "approved" ? "" : notes.trim(),
          idempotencyKey: keys.current[decision],
          ...(access ?? {}),
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Your decision could not be saved.");
      setFeedback(decision === "approved"
        ? "Thank you. Your design is approved for production."
        : "Thank you. Your requested changes have been sent to R&R Gallery.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Your decision could not be saved.");
    } finally {
      setPending(false);
    }
  }

  function requestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit("changes_requested", String(form.get("notes") ?? ""));
  }

  return (
    <section className={styles.customerProof} aria-labelledby="customer-proof-heading">
      <header className={styles.customerProofHeader}>
        <div>
          <p className={styles.eyebrow}>Artwork approval</p>
          <h2 id="customer-proof-heading">Review design draft v{latest.version}</h2>
          <p>Check the complete design carefully before it moves into production.</p>
        </div>
        <span>{revisionLabel(proof.revision.freeRevisionsRemaining)}</span>
      </header>

      <div className={styles.customerProofLayout}>
        <div className={styles.customerProofImage}>
          <Image
            src={imageUrl(proof.orderNumber, latest.id, access)}
            alt={`Design draft version ${latest.version} for order ${proof.orderNumber}`}
            width={1400}
            height={1050}
            sizes="(max-width: 820px) 100vw, 60vw"
            unoptimized
          />
          <p>Uploaded {dateTime.format(new Date(latest.createdAt))}</p>
        </div>

        <div className={styles.customerProofDecision}>
          {latest.review ? (
            <div className={styles.customerProofComplete} data-decision={latest.review.decision}>
              <strong>{latest.review.decision === "approved" ? "Approved for production" : "Changes requested"}</strong>
              {latest.review.notes ? <p>{latest.review.notes}</p> : null}
              <small>Recorded {dateTime.format(new Date(latest.review.createdAt))}</small>
            </div>
          ) : proof.fulfilmentStatus === "awaiting_customer" ? (
            <>
              <div className={styles.customerProofAction}>
                <h3>Approve this draft</h3>
                <p>Approval tells us that the artwork is ready to print.</p>
                <label className={styles.proofApprovalCheck}>
                  <input
                    type="checkbox"
                    checked={approvalConfirmed}
                    onChange={(event) => setApprovalConfirmed(event.target.checked)}
                    disabled={pending}
                  />
                  <span>I approve this design draft for production.</span>
                </label>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={pending}
                  onClick={() => void submit("approved", "")}
                >
                  Approve for production
                </button>
              </div>

              <form className={styles.customerProofAction} onSubmit={requestChanges}>
                <h3>Request changes</h3>
                <p>List every requested change together. Up to two revision rounds are included.</p>
                <label>
                  <span>Requested changes</span>
                  <textarea
                    name="notes"
                    rows={5}
                    maxLength={5000}
                    required
                    disabled={pending}
                    placeholder="Describe all wording, colour, photo placement or other changes in one message."
                  />
                </label>
                <button type="submit" className={styles.secondaryButton} disabled={pending}>
                  Send requested changes
                </button>
              </form>
            </>
          ) : (
            <p className={styles.proofWaiting}>This draft is not currently awaiting a customer decision. Please contact R&R Gallery if you need help.</p>
          )}
          <p className={styles.proofPolicy}>Changing to a different source photo may cost NZ$25. Further revision rounds may cost NZ$30. We will confirm any additional charge before applying it.</p>
          <p className={styles.formFeedback} aria-live="polite">{feedback}</p>
        </div>
      </div>

      {proof.files.length > 1 ? (
        <details className={styles.proofHistory}>
          <summary>Earlier drafts ({proof.files.length - 1})</summary>
          <ol>
            {proof.files.slice(1).map((file) => (
              <li key={file.id}>
                <strong>Draft v{file.version}</strong>
                <span>{file.review
                  ? file.review.decision === "approved" ? "Approved" : "Changes requested"
                  : "Superseded"}</span>
                <small>{dateTime.format(new Date(file.createdAt))}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
