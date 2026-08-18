"use client";

import { useState } from "react";
import styles from "./reply-assistant.module.css";

export type CaseMemoryView = Readonly<{
  id: string;
  intent: string;
  normalizedSituation: string;
  humanFinalReply: string;
  status: "pending_review" | "approved_reusable" | "excluded" | "revoked";
}>;

export function CaseMemoryReview({
  cases,
  canReview,
}: Readonly<{ cases: readonly CaseMemoryView[]; canReview: boolean }>) {
  const [items, setItems] = useState(cases);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(item: CaseMemoryView, action: "approve" | "reject") {
    setBusy(item.id);
    try {
      const response = await fetch(`/api/reply-assistant/case-memories/${item.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: action === "reject" ? "Not reusable" : null }),
      });
      if (!response.ok) return;
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.learning} aria-labelledby="case-memory-title">
      <div className={styles.learningHeader}>
        <div><p>Approved experience only</p><h2 id="case-memory-title">Case memories</h2></div>
        <span>{items.length} pending</span>
      </div>
      {items.length === 0 ? <p className={styles.empty}>No case memories are waiting.</p> : (
        <div className={styles.learningList}>
          {items.map((item) => (
            <article key={item.id} className={styles.learningItem}>
              <div className={styles.learningMeta}>
                <strong>{item.intent.replaceAll("_", " ")}</strong>
                <span>{canReview ? "Pending review" : "Pending admin review"}</span>
              </div>
              <p>{item.normalizedSituation}</p>
              <p className={styles.reasons}>{item.humanFinalReply}</p>
              {canReview ? (
                <div className={styles.learningControls}>
                  <div>
                    <button type="button" disabled={busy === item.id} onClick={() => void decide(item, "approve")}>Approve case</button>
                    <button type="button" disabled={busy === item.id} onClick={() => void decide(item, "reject")}>Reject case</button>
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
