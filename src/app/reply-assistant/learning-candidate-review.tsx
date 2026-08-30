"use client";

import { useState } from "react";
import styles from "./reply-assistant.module.css";

export type LearningCandidateView = Readonly<{
  id: string;
  intent: string;
  observedPattern: string;
  proposedChange: string;
  reasonCodes: readonly string[];
  evidenceCount: number;
  supportingCases: readonly Readonly<{
    customer: string;
    aiDraft: string | null;
    humanFinal: string;
    detectedChange: string;
  }>[];
  status: "pending" | "approved" | "rejected" | "superseded";
}>;

const reasonLabel = (code: string) => code.replaceAll("_", " ");

export function LearningCandidateReview({
  candidates,
  pendingCount,
  canReview,
}: Readonly<{ candidates: readonly LearningCandidateView[]; pendingCount?: number; canReview: boolean }>) {
  const [statusOverrides, setStatusOverrides] = useState<Record<string, LearningCandidateView["status"]>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const items = candidates
    .filter((candidate) => Boolean(candidate.observedPattern?.trim()) && Array.isArray(candidate.supportingCases))
    .map((candidate) => candidate.status === "pending" && statusOverrides[candidate.id]
      ? { ...candidate, status: statusOverrides[candidate.id] }
      : candidate);

  async function decide(candidate: LearningCandidateView, action: "approve" | "edit_and_approve" | "reject") {
    setBusy((current) => ({ ...current, [candidate.id]: true }));
    setErrors((current) => ({ ...current, [candidate.id]: "" }));
    try {
      const response = await fetch(`/api/reply-assistant/learning-candidates/${candidate.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          approvedText: action === "edit_and_approve" ? edits[candidate.id] || candidate.proposedChange : null,
          reason: action === "reject" ? "Rejected during admin review" : null,
        }),
      });
      if (!response.ok) {
        setErrors((current) => ({
          ...current,
          [candidate.id]: "Could not save this decision. Refresh and try again.",
        }));
        return;
      }
      setStatusOverrides((current) => ({
        ...current,
        [candidate.id]: action === "reject" ? "rejected" : "approved",
      }));
    } catch {
      setErrors((current) => ({
        ...current,
        [candidate.id]: "Could not save this decision. Refresh and try again.",
      }));
    } finally {
      setBusy((current) => ({ ...current, [candidate.id]: false }));
    }
  }

  return (
    <section className={styles.learning} aria-labelledby="learning-title">
      <div className={styles.learningHeader}>
        <div><p>Human-reviewed learning</p><h2 id="learning-title">Learning candidates</h2></div>
        <span>{pendingCount ?? items.filter((item) => item.status === "pending").length} pending</span>
      </div>
      {items.length === 0 ? <p className={styles.empty}>No learning candidates are waiting.</p> : (
        <div className={styles.learningList}>
          {items.map((candidate) => (
            <article key={candidate.id} className={styles.learningItem}>
              <div className={styles.learningMeta}>
                <strong>{candidate.intent.replaceAll("_", " ")}</strong>
                <span>{candidate.evidenceCount} cases</span>
                <span>{candidate.status === "pending" && !canReview ? "Pending admin review" : candidate.status}</span>
              </div>
              <div className={styles.learningGuidance}>
                <div><strong>Observed pattern</strong><p>{candidate.observedPattern}</p></div>
                <div><strong>Proposed guidance</strong><p>{candidate.proposedChange}</p></div>
              </div>
              <p className={styles.reasons}>{candidate.reasonCodes.map(reasonLabel).join(" · ")}</p>
              <details className={styles.learningEvidence}>
                <summary>
                  View {candidate.supportingCases.length} of {candidate.evidenceCount} supporting {candidate.evidenceCount === 1 ? "case" : "cases"}
                </summary>
                <div>
                  {candidate.supportingCases.map((supportingCase, index) => (
                    <article key={`${candidate.id}-case-${index + 1}`}>
                      <p><strong>Customer</strong>{supportingCase.customer}</p>
                      <p><strong>AI draft</strong>{supportingCase.aiDraft ?? "No AI draft was available."}</p>
                      <p><strong>Human final</strong>{supportingCase.humanFinal}</p>
                      <p><strong>Detected change</strong>{supportingCase.detectedChange}</p>
                    </article>
                  ))}
                </div>
              </details>
              {canReview && candidate.status === "pending" ? (
                <div className={styles.learningControls}>
                  <textarea
                    aria-label={`Edit ${candidate.intent} proposal`}
                    value={edits[candidate.id] ?? candidate.proposedChange}
                    onChange={(event) => setEdits((current) => ({ ...current, [candidate.id]: event.target.value }))}
                    maxLength={800}
                  />
                  <div>
                    <button type="button" disabled={Boolean(busy[candidate.id])} onClick={() => void decide(candidate, "approve")}>Approve</button>
                    <button type="button" disabled={Boolean(busy[candidate.id])} onClick={() => void decide(candidate, "edit_and_approve")}>Edit &amp; Approve</button>
                    <button type="button" disabled={Boolean(busy[candidate.id])} onClick={() => void decide(candidate, "reject")}>Reject</button>
                  </div>
                  {errors[candidate.id] ? <p className={styles.learningError} role="alert">{errors[candidate.id]}</p> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
