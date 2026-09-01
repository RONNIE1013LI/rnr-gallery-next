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
    selector: string | null;
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

type FeedbackAction = "accepted_unchanged" | "edited" | "rejected" | "copied" | "sent_confirmed";

type FeedbackRequest = Readonly<{
  attemptId: string;
  action: FeedbackAction;
  idempotencyKey: string;
}>;

const replyDateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Pacific/Auckland",
});

const CONVERSATION_BATCH_SIZE = 12;

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
  channelScope = "all",
}: Readonly<{
  initialItems?: readonly ReplyQueueItem[];
  liveItems?: readonly ReplyQueueItem[];
  newMessageIds?: readonly string[];
  onRefresh?: () => void;
  selectedReviewSelector?: string | null;
  channelScope?: "all" | "website" | "facebook";
}>) {
  const [fetchedItems, setFetchedItems] = useState<readonly ReplyQueueItem[]>(initialItems ?? []);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [websiteReplies, setWebsiteReplies] = useState<Record<string, WebsiteReplyState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedbackRequests, setFeedbackRequests] = useState<Record<string, FeedbackRequest>>({});
  const [feedbackErrors, setFeedbackErrors] = useState<Record<string, string>>({});
  const [feedbackCompletions, setFeedbackCompletions] = useState<Record<string, FeedbackAction>>({});
  const [visibleCounts, setVisibleCounts] = useState<Record<"all" | "website" | "facebook", number>>({
    all: CONVERSATION_BATCH_SIZE,
    website: CONVERSATION_BATCH_SIZE,
    facebook: CONVERSATION_BATCH_SIZE,
  });
  const feedbackSequence = useRef(0);
  const feedbackRetryKeys = useRef(new Map<string, string>());
  const feedbackInFlight = useRef(new Set<string>());
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
    : (() => {
      const sorted = [...new Map(liveItems.map((item) => [item.messageId, item])).values()]
        .sort((left, right) => (
          right.receivedAt.localeCompare(left.receivedAt) || right.messageId.localeCompare(left.messageId)
        ));
      const selected = selectedReviewSelector
        ? sorted.find((item) => item.websiteReview?.selector === selectedReviewSelector)
        : undefined;
      return selected
        ? [selected, ...sorted.filter((item) => item.messageId !== selected.messageId)].slice(0, 100)
        : sorted.slice(0, 100);
    })();
  const visibleCount = visibleCounts[channelScope];
  const visibleItems = items.slice(0, visibleCount);
  const remainingCount = items.length - visibleItems.length;

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

  function setFeedbackError(messageId: string, message: string | null) {
    setFeedbackErrors((errors) => {
      if (message === null) {
        const remaining = { ...errors };
        delete remaining[messageId];
        return remaining;
      }
      return { ...errors, [messageId]: message };
    });
  }

  async function feedback(item: ReplyQueueItem, action: FeedbackAction, text: string | null, reasonCode: string | null) {
    if (!item.latestAttemptId) return false;
    const intent = `${item.latestAttemptId}:${action}`;
    if (feedbackInFlight.current.has(intent)) return false;
    const idempotencyKey = feedbackRetryKeys.current.get(intent) ?? `${action}-${++feedbackSequence.current}`;
    feedbackRetryKeys.current.set(intent, idempotencyKey);
    feedbackInFlight.current.add(intent);
    setFeedbackRequests((requests) => ({
      ...requests,
      [item.messageId]: { attemptId: item.latestAttemptId!, action, idempotencyKey },
    }));
    setFeedbackError(item.messageId, null);
    try {
      await jsonRequest(`/api/reply-assistant/drafts/${item.latestAttemptId}/feedback`, {
        action,
        humanFinalText: text,
        reasonCode,
        idempotencyKey,
      });
      if (action === "copied") feedbackRetryKeys.current.delete(intent);
      else setFeedbackCompletions((completions) => ({ ...completions, [item.messageId]: action }));
      return true;
    } catch {
      setFeedbackError(item.messageId, "We could not save this review. Please try again.");
      return false;
    } finally {
      feedbackInFlight.current.delete(intent);
      setFeedbackRequests((requests) => {
        if (!requests[item.messageId]) return requests;
        const remaining = { ...requests };
        delete remaining[item.messageId];
        return remaining;
      });
    }
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
    if (!item.websiteReview?.selector || websiteReplyInFlight.current.has(item.messageId)) return;
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
      {visibleItems.map((item) => {
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
        const feedbackPending = feedbackRequests[item.messageId] !== undefined;
        const feedbackCompletion = feedbackCompletions[item.messageId] ?? null;
        const outcomeCompleted = feedbackCompletion === "accepted_unchanged"
          || feedbackCompletion === "edited"
          || feedbackCompletion === "rejected";
        const feedbackError = feedbackErrors[item.messageId] ?? null;
        const selected = selectedReviewSelector !== null
          && item.websiteReview?.selector === selectedReviewSelector;
        return (
          <article
            className={styles.message}
            key={item.messageId}
            data-selected={selected}
            ref={selected ? selectedCardRef : undefined}
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
            <div className={styles.messageBody}>
              <div className={styles.messageContext}>
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
              </div>
              <div className={styles.messageResponse}>
              {item.channel === "website" ? (
              item.humanReplyReceived ? (
                <div className={styles.blocked}>Human website reply sent. Review resolved.</div>
              ) : item.websiteReview ? (
                item.websiteReview.selector ? (
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
                      data-variant="primary"
                      disabled={!currentWebsiteReply.text.trim() || websiteReviewChanged || currentWebsiteReply.status === "sending" || currentWebsiteReply.status === "sent"}
                      onClick={() => void sendWebsiteReply(item, currentWebsiteReply)}
                    >Send website reply</button>
                  </div>
                </div>
                ) : (
                  <div className={styles.blocked}>Website review action is preparing. Refresh shortly.</div>
                )
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
                {feedbackError ? <div className={styles.serverChanged} role="alert">{feedbackError}</div> : null}
                <div className={styles.actions}>
                  {current.mode === "editing" ? (
                    <button type="button" data-variant="primary" disabled={serverChanged || feedbackPending || outcomeCompleted} onClick={async () => {
                      if (!await feedback(item, "edited", current.text, "human_edit")) return;
                      update(item, { mode: "edited", text: current.text, sourceAttemptId: item.latestAttemptId });
                    }}>Accept edit</button>
                  ) : (
                    <button type="button" disabled={serverChanged || feedbackPending || outcomeCompleted} onClick={() => update(item, {
                      mode: "editing",
                      text: serverChanged ? item.draftText ?? "" : current.text,
                      sourceAttemptId: item.latestAttemptId,
                    })}>Edit</button>
                  )}
                  <button type="button" data-variant="primary" disabled={serverChanged || feedbackPending || outcomeCompleted} onClick={async () => {
                    if (!await feedback(item, "accepted_unchanged", item.draftText, null)) return;
                    update(item, { mode: "accepted", text: item.draftText ?? "", sourceAttemptId: item.latestAttemptId });
                  }}>Accept unchanged</button>
                  <button type="button" data-variant="danger" disabled={serverChanged || feedbackPending || outcomeCompleted} onClick={async () => {
                    if (!await feedback(item, "rejected", null, "human_rejected")) return;
                    update(item, { mode: "rejected", text: current.text, sourceAttemptId: item.latestAttemptId });
                  }}>Reject</button>
                  <button type="button" disabled={busy === item.messageId || feedbackPending || visualReviewRequired || serverChanged} onClick={() => void generate(item, true)}>Regenerate</button>
                  <button type="button" disabled={!approved || serverChanged || feedbackPending} onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(current.text);
                    } catch {
                      setFeedbackError(item.messageId, "The reply could not be copied. Please try again.");
                      return;
                    }
                    if (!await feedback(item, "copied", current.text, null)) {
                      setFeedbackError(item.messageId, "The text was copied, but its review event was not saved. Copy again to retry.");
                    }
                  }}>Copy</button>
                  <button type="button" disabled={!approved || serverChanged || feedbackPending || feedbackCompletion === "sent_confirmed"} onClick={() => void feedback(item, "sent_confirmed", current.text, null)}>Mark as manually sent</button>
                </div>
              </div>
            ) : (
              <button className={styles.generate} data-variant="primary" type="button" disabled={busy === item.messageId || visualReviewRequired} onClick={() => void generate(item)}>Generate AI Reply</button>
            )}
              </div>
            </div>
          </article>
        );
      })}
      {items.length > CONVERSATION_BATCH_SIZE ? (
        <footer className={styles.queueFooter}>
          <span>Showing {visibleItems.length} of {items.length} conversations</span>
          {remainingCount > 0 ? (
            <button
              type="button"
              aria-label={`Show ${Math.min(CONVERSATION_BATCH_SIZE, remainingCount)} more conversations`}
              onClick={() => setVisibleCounts((counts) => ({
                ...counts,
                [channelScope]: counts[channelScope] + CONVERSATION_BATCH_SIZE,
              }))}
            >
              Show more
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
