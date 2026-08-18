"use client";

import { useState } from "react";
import styles from "./reply-assistant.module.css";

export type LearningCandidateView = Readonly<{
  id: string;
  intent: string;
  proposedChange: string;
  reasonCodes: readonly string[];
  evidenceCount: number;
  status: "pending" | "approved" | "rejected" | "superseded";
}>;

const reasonLabel = (code: string) => code.replaceAll("_", " ");

export function LearningCandidateReview({
  candidates,
  canReview,
}: Readonly<{ candidates: readonly LearningCandidateView[]; canReview: boolean }>) {
  const [items, setItems] = useState(candidates);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(candidate: LearningCandidateView, action: "approve" | "edit_and_approve" | "reject") {
    setBusy(candidate.id);
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
      if (!response.ok) return;
      setItems((current) => current.map((item) => item.id === candidate.id
        ? { ...item, status: action === "reject" ? "rejected" : "approved" }
        : item));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.learning} aria-labelledby="learning-title">
      <div className={styles.learningHeader}>
        <div><p>Human-reviewed learning</p><h2 id="learning-title">Learning candidates</h2></div>
        <span>{items.filter((item) => item.status === "pending").length} pending</span>
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
              <p>{candidate.proposedChange}</p>
              <p className={styles.reasons}>{candidate.reasonCodes.map(reasonLabel).join(" · ")}</p>
              {canReview && candidate.status === "pending" ? (
                <div className={styles.learningControls}>
                  <textarea
                    aria-label={`Edit ${candidate.intent} proposal`}
                    value={edits[candidate.id] ?? candidate.proposedChange}
                    onChange={(event) => setEdits((current) => ({ ...current, [candidate.id]: event.target.value }))}
                    maxLength={800}
                  />
                  <div>
                    <button type="button" disabled={busy === candidate.id} onClick={() => void decide(candidate, "approve")}>Approve</button>
                    <button type="button" disabled={busy === candidate.id} onClick={() => void decide(candidate, "edit_and_approve")}>Edit &amp; Approve</button>
                    <button type="button" disabled={busy === candidate.id} onClick={() => void decide(candidate, "reject")}>Reject</button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
