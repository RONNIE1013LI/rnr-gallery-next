"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./reply-assistant.module.css";

export type ReplyQueueItem = Readonly<{
  messageId: string;
  channel: "facebook" | "website";
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
  websiteReview: Readonly<{
    selector: string;
    reason: "high_risk" | "unresolved" | "realtime_required" | "provider_error" | "output_blocked" | "budget_blocked" | "system_failure";
    alertStatus: "not_created" | "pending" | "leased" | "retry_wait" | "sent" | "failed";
  }> | null;
  timeline: readonly Readonly<{
    role: "customer" | "assistant" | "staff";
    text: string;
    receivedAt: string;
  }>[];
}>;

type ReviewState = Readonly<{
  mode: "pending" | "editing" | "accepted" | "edited" | "rejected";
  text: string;
  sourceAttemptId: string | null;
}>;

type WebsiteReplyState = Readonly<{
  text: string;
  sourceReviewSelector: string;
  status: "editing" | "sending" | "sent" | "error";
}>;

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

export function ReplyAssistantClient({
  initialItems,
  liveItems,
  newMessageIds = [],
  onRefresh,
  selectedReviewSelector = null,
}: Readonly<{
  initialItems?: readonly ReplyQueueItem[];
  liveItems?: readonly ReplyQueueItem[];
  newMessageIds?: readonly string[];
  onRefresh?: () => void;
  selectedReviewSelector?: string | null;
}>) {
  const [fetchedItems, setFetchedItems] = useState<readonly ReplyQueueItem[]>(initialItems ?? []);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [websiteReplies, setWebsiteReplies] = useState<Record<string, WebsiteReplyState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const feedbackSequence = useRef(0);
  const websiteReplyInFlight = useRef(new Set<string>());
  const selectedCardRef = useRef<HTMLElement | null>(null);

  async function refresh() {
    if (liveItems !== undefined) {
      onRefresh?.();
      return;
    }
    const response = await fetch("/api/reply-assistant/messages", { cache: "no-store" });
    if (response.ok) setFetchedItems((await response.json()).items ?? []);
  }

  useEffect(() => {
    if (initialItems !== undefined) return;
    let cancelled = false;
    void fetch("/api/reply-assistant/messages", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { items: [] })
      .then((body) => { if (!cancelled) setFetchedItems(body.items ?? []); });
    return () => { cancelled = true; };
  }, [initialItems]);

  const items = liveItems === undefined
    ? fetchedItems
    : [...new Map(liveItems.map((item) => [item.messageId, item])).values()]
      .sort((left, right) => (
        right.receivedAt.localeCompare(left.receivedAt) || right.messageId.localeCompare(left.messageId)
      ))
      .slice(0, 100);

  useEffect(() => {
    selectedCardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedReviewSelector]);

  function review(item: ReplyQueueItem): ReviewState {
    return reviews[item.messageId] ?? {
      mode: "pending",
      text: item.draftText ?? "",
      sourceAttemptId: item.latestAttemptId,
    };
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

  async function sendWebsiteReply(item: ReplyQueueItem, current: WebsiteReplyState) {
    if (!item.websiteReview || websiteReplyInFlight.current.has(item.messageId)) return;
    const text = current.text.trim();
    if (!text) return;
    websiteReplyInFlight.current.add(item.messageId);
    setWebsiteReplies((states) => ({
      ...states,
      [item.messageId]: { ...current, text, status: "sending" },
    }));
    try {
      await jsonRequest("/api/reply-assistant/website-replies", {
        reviewSelector: item.websiteReview.selector,
        text,
      });
      setWebsiteReplies((states) => ({
        ...states,
        [item.messageId]: { ...current, text, status: "sent" },
      }));
      onRefresh?.();
    } catch {
      setWebsiteReplies((states) => ({
        ...states,
        [item.messageId]: { ...current, text, status: "error" },
      }));
    } finally {
      websiteReplyInFlight.current.delete(item.messageId);
    }
  }

  return (
    <div className={styles.queue}>
      {items.length === 0 ? <p className={styles.empty}>No pilot messages yet.</p> : null}
      {items.map((item) => {
        const current = review(item);
        const currentWebsiteReply = websiteReplies[item.messageId] ?? {
          text: "",
          sourceReviewSelector: item.websiteReview?.selector ?? "",
          status: "editing" as const,
        };
        const websiteReviewChanged = Boolean(item.websiteReview)
          && currentWebsiteReply.sourceReviewSelector !== item.websiteReview?.selector;
        const gateBlocked = !item.draftText && item.gateResult !== null && item.gateResult !== "allowed";
        const imageOnly = item.attachmentCount > 0 && item.body === "[Image attachment]";
        const visualReviewRequired = imageOnly || item.imageAnalysisStatus === "human_review_required";
        const requiresHumanReview = gateBlocked || visualReviewRequired || item.websiteReview !== null;
        const serverChanged = current.sourceAttemptId !== item.latestAttemptId;
        const approved = !serverChanged && (current.mode === "accepted" || current.mode === "edited");
        const locallyEditing = current.mode === "editing";
        return (
          <article
            className={styles.message}
            key={item.messageId}
            data-selected={item.websiteReview?.selector === selectedReviewSelector}
            ref={item.websiteReview?.selector === selectedReviewSelector ? selectedCardRef : undefined}
          >
            <header>
              <time>{formatReplyReceivedAt(item.receivedAt)}</time>
              <div className={styles.statuses}>
                <span className={styles.channelBadge} data-channel={item.channel}>{item.channel === "website" ? "Website" : "Facebook"}</span>
                {newMessageIds.includes(item.messageId) ? <span className={styles.newBadge}>New</span> : null}
                <span data-risk={requiresHumanReview}>{item.humanReplyReceived ? "human replied" : requiresHumanReview ? "Human review required" : item.status.replaceAll("_", " ")}</span>
                {item.websiteReview ? <span className={styles.alertBadge} data-alert={item.websiteReview.alertStatus}>Alert {item.websiteReview.alertStatus.replaceAll("_", " ")}</span> : null}
              </div>
            </header>
            <div className={styles.customerText}><strong>Customer</strong><p>{item.body}</p></div>
            {item.timeline.length > 0 ? (
              <section className={styles.timeline} aria-label="Conversation timeline">
                <div className={styles.timelineHeader}>
                  <strong>Conversation timeline</strong>
                  <span className={styles.timelineChannel}>{item.channel === "website" ? "Website" : "Facebook"}</span>
                </div>
                <ol>
                  {item.timeline.map((event, index) => (
                    <li key={`${event.receivedAt}-${index}`} data-role={event.role}>
                      <span>{event.role === "staff" ? "R&R" : event.role === "assistant" ? "Assistant" : "Customer"}</span>
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

            {item.channel === "website" ? (
              item.humanReplyReceived ? (
                <div className={styles.blocked}>Human website reply sent. Review resolved.</div>
              ) : item.websiteReview ? (
                <div className={styles.websiteReply}>
                  <label htmlFor={`website-reply-${item.messageId}`}>Website reply</label>
                  <textarea
                    id={`website-reply-${item.messageId}`}
                    value={currentWebsiteReply.text}
                    maxLength={2_000}
                    onChange={(event) => setWebsiteReplies((states) => ({
                      ...states,
                      [item.messageId]: {
                        text: event.target.value,
                        sourceReviewSelector: currentWebsiteReply.sourceReviewSelector,
                        status: "editing",
                      },
                    }))}
                  />
                  {websiteReviewChanged ? (
                    <div className={styles.serverChanged}>Server review changed. Your reply is preserved but cannot be sent.</div>
                  ) : null}
                  {currentWebsiteReply.status === "sent" ? <div className={styles.sendStatus}>Website reply sent.</div> : null}
                  {currentWebsiteReply.status === "error" ? <div className={styles.serverChanged}>Reply was not sent. Review the case and try again.</div> : null}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      disabled={!currentWebsiteReply.text.trim() || websiteReviewChanged || currentWebsiteReply.status === "sending" || currentWebsiteReply.status === "sent"}
                      onClick={() => void sendWebsiteReply(item, currentWebsiteReply)}
                    >Send website reply</button>
                  </div>
                </div>
              ) : (
                <div className={styles.blocked}>No open website review.</div>
              )
            ) : item.humanReplyReceived && !locallyEditing ? (
              <div className={styles.blocked}>Human reply sent in Meta. AI draft closed.</div>
            ) : gateBlocked ? (
              <>
                <div className={styles.blocked}>Risk: {item.gateResult?.replaceAll("_", " ")}</div>
                <button className={styles.generate} type="button" disabled>Generate AI Reply</button>
              </>
            ) : item.draftText || locallyEditing ? (
              <div className={styles.draftArea}>
                <label htmlFor={`draft-${item.messageId}`}>Reply draft</label>
                <textarea
                  id={`draft-${item.messageId}`}
                  value={current.text}
                  readOnly={current.mode !== "editing"}
                  onChange={(event) => update(item, {
                    mode: "editing",
                    text: event.target.value,
                    sourceAttemptId: current.sourceAttemptId,
                  })}
                />
                {serverChanged ? (
                  <div className={styles.serverChanged}>
                    {current.mode === "editing"
                      ? "Server state changed. Your edit is preserved."
                      : "Server state changed. Review the new draft before using it."}
                  </div>
                ) : null}
                <div className={styles.actions}>
                  {current.mode === "editing" ? (
                    <button type="button" disabled={serverChanged} onClick={async () => {
                      await feedback(item, "edited", current.text, "human_edit");
                      update(item, { mode: "edited", text: current.text, sourceAttemptId: item.latestAttemptId });
                    }}>Accept edit</button>
                  ) : (
                    <button type="button" onClick={() => update(item, {
                      mode: "editing",
                      text: serverChanged ? item.draftText ?? "" : current.text,
                      sourceAttemptId: item.latestAttemptId,
                    })}>Edit</button>
                  )}
                  <button type="button" disabled={serverChanged} onClick={async () => {
                    await feedback(item, "accepted_unchanged", item.draftText, null);
                    update(item, { mode: "accepted", text: item.draftText ?? "", sourceAttemptId: item.latestAttemptId });
                  }}>Accept unchanged</button>
                  <button type="button" disabled={serverChanged} onClick={async () => {
                    await feedback(item, "rejected", null, "human_rejected");
                    update(item, { mode: "rejected", text: current.text, sourceAttemptId: item.latestAttemptId });
                  }}>Reject</button>
                  <button type="button" disabled={busy === item.messageId || visualReviewRequired || serverChanged} onClick={() => void generate(item, true)}>Regenerate</button>
                  <button type="button" disabled={!approved || serverChanged} onClick={async () => {
                    await navigator.clipboard.writeText(current.text);
                    await feedback(item, "copied", current.text, null);
                  }}>Copy</button>
                  <button type="button" disabled={!approved || serverChanged} onClick={() => void feedback(item, "sent_confirmed", current.text, null)}>Mark as manually sent</button>
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
