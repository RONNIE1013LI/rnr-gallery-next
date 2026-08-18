"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./reply-assistant.module.css";

export type ReplyQueueItem = Readonly<{
  messageId: string;
  body: string;
  receivedAt: string;
  status: string;
  latestAttemptId: string | null;
  draftText: string | null;
  gateResult: string | null;
  attachmentCount: number;
  imageAnalysisStatus: "not_applicable" | "assessed" | "human_review_required";
  imageAssessmentSummary: string | null;
  humanReplyReceived: boolean;
  timeline: readonly Readonly<{
    role: "customer" | "staff";
    text: string;
    receivedAt: string;
  }>[];
}>;

type ReviewState = Readonly<{ mode: "pending" | "editing" | "accepted" | "edited" | "rejected"; text: string }>;

const replyDateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Pacific/Auckland",
});

export function formatReplyReceivedAt(value: string) {
  return replyDateTime.format(new Date(value));
}

async function jsonRequest(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("request_failed");
  return response.json();
}

export function ReplyAssistantClient({ initialItems }: Readonly<{ initialItems?: readonly ReplyQueueItem[] }>) {
  const [items, setItems] = useState<readonly ReplyQueueItem[]>(initialItems ?? []);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const feedbackSequence = useRef(0);

  async function refresh() {
    const response = await fetch("/api/reply-assistant/messages", { cache: "no-store" });
    if (response.ok) setItems((await response.json()).items ?? []);
  }

  useEffect(() => {
    if (initialItems !== undefined) return;
    let cancelled = false;
    void fetch("/api/reply-assistant/messages", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { items: [] })
      .then((body) => { if (!cancelled) setItems(body.items ?? []); });
    return () => { cancelled = true; };
  }, [initialItems]);

  function review(item: ReplyQueueItem): ReviewState {
    return reviews[item.messageId] ?? { mode: "pending", text: item.draftText ?? "" };
  }

  function update(item: ReplyQueueItem, next: ReviewState) {
    setReviews((current) => ({ ...current, [item.messageId]: next }));
  }

  async function feedback(item: ReplyQueueItem, action: string, text: string | null, reasonCode: string | null) {
    if (!item.latestAttemptId) return;
    feedbackSequence.current += 1;
    await jsonRequest(`/api/reply-assistant/drafts/${item.latestAttemptId}/feedback`, {
      action,
      humanFinalText: text,
      reasonCode,
      idempotencyKey: `${action}-${feedbackSequence.current}`,
    });
  }

  async function generate(item: ReplyQueueItem, regenerate = false) {
    setBusy(item.messageId);
    try {
      const url = regenerate && item.latestAttemptId
        ? `/api/reply-assistant/drafts/${item.latestAttemptId}/regenerate`
        : `/api/reply-assistant/messages/${item.messageId}/generate`;
      await jsonRequest(url, {});
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.queue}>
      {items.length === 0 ? <p className={styles.empty}>No pilot messages yet.</p> : null}
      {items.map((item) => {
        const current = review(item);
        const gateBlocked = !item.draftText && item.gateResult !== null && item.gateResult !== "allowed";
        const imageOnly = item.attachmentCount > 0 && item.body === "[Image attachment]";
        const visualReviewRequired = imageOnly || item.imageAnalysisStatus === "human_review_required";
        const requiresHumanReview = gateBlocked || visualReviewRequired;
        const approved = current.mode === "accepted" || current.mode === "edited";
        return (
          <article className={styles.message} key={item.messageId}>
            <header>
              <time>{formatReplyReceivedAt(item.receivedAt)}</time>
              <span data-risk={requiresHumanReview}>{item.humanReplyReceived ? "human replied" : requiresHumanReview ? "Human review required" : item.status.replaceAll("_", " ")}</span>
            </header>
            <div className={styles.customerText}><strong>Customer</strong><p>{item.body}</p></div>
            {item.timeline.length > 0 ? (
              <section className={styles.timeline} aria-label="Conversation timeline">
                <strong>Conversation timeline</strong>
                <ol>
                  {item.timeline.map((event, index) => (
                    <li key={`${event.receivedAt}-${index}`} data-role={event.role}>
                      <span>{event.role === "staff" ? "R&R" : "Customer"}</span>
                      <p>{event.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {item.attachmentCount > 0 ? (
              <section className={styles.imageAssessment}>
                <strong>Image assessment</strong>
                <p>{item.imageAssessmentSummary ?? "No safe image assessment is available."}</p>
              </section>
            ) : null}

            {item.humanReplyReceived ? (
              <div className={styles.blocked}>Human reply sent in Meta. AI draft closed.</div>
            ) : gateBlocked ? (
              <>
                <div className={styles.blocked}>Risk: {item.gateResult?.replaceAll("_", " ")}</div>
                <button className={styles.generate} type="button" disabled>Generate AI Reply</button>
              </>
            ) : item.draftText ? (
              <div className={styles.draftArea}>
                <label htmlFor={`draft-${item.messageId}`}>Reply draft</label>
                <textarea
                  id={`draft-${item.messageId}`}
                  value={current.text}
                  readOnly={current.mode !== "editing"}
                  onChange={(event) => update(item, { mode: "editing", text: event.target.value })}
                />
                <div className={styles.actions}>
                  {current.mode === "editing" ? (
                    <button type="button" onClick={async () => {
                      await feedback(item, "edited", current.text, "human_edit");
                      update(item, { mode: "edited", text: current.text });
                    }}>Accept edit</button>
                  ) : (
                    <button type="button" onClick={() => update(item, { mode: "editing", text: current.text })}>Edit</button>
                  )}
                  <button type="button" onClick={async () => {
                    await feedback(item, "accepted_unchanged", item.draftText, null);
                    update(item, { mode: "accepted", text: item.draftText ?? "" });
                  }}>Accept unchanged</button>
                  <button type="button" onClick={async () => {
                    await feedback(item, "rejected", null, "human_rejected");
                    update(item, { mode: "rejected", text: current.text });
                  }}>Reject</button>
                  <button type="button" disabled={busy === item.messageId || visualReviewRequired} onClick={() => void generate(item, true)}>Regenerate</button>
                  <button type="button" disabled={!approved} onClick={async () => {
                    await navigator.clipboard.writeText(current.text);
                    await feedback(item, "copied", current.text, null);
                  }}>Copy</button>
                  <button type="button" disabled={!approved} onClick={() => void feedback(item, "sent_confirmed", current.text, null)}>Mark as manually sent</button>
                </div>
              </div>
            ) : (
              <button className={styles.generate} type="button" disabled={busy === item.messageId || visualReviewRequired} onClick={() => void generate(item)}>Generate AI Reply</button>
            )}
          </article>
        );
      })}
    </div>
  );
}
