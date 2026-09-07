"use client";

import { useEffect, useRef, useState } from "react";
import type {
  SafeInboxItem,
  SafeTimelineEvent,
} from "@/server/customer-service/repositories/customer-service-repository";
import styles from "./reply-assistant.module.css";

export type ReplyQueueItem = SafeInboxItem;

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

type FacebookReplyState = Readonly<{
  attemptId: string;
  status: "sending" | "sent" | "error" | "unavailable" | "uncertain";
}>;

type FacebookReplyResponse = Readonly<{
  status: "sent";
  item: SafeInboxItem;
  takeover: Omit<TakeoverUiState, "status">;
}>;

type SentFacebookItem = Readonly<{
  item: SafeInboxItem;
  pendingTimelineEventIds: readonly string[];
}>;

type FeedbackAction = "accepted_unchanged" | "edited" | "rejected" | "copied" | "sent_confirmed";

type FeedbackRequest = Readonly<{
  attemptId: string;
  action: FeedbackAction;
  idempotencyKey: string;
}>;

type EarlierTimelineState = Readonly<{
  events: readonly SafeTimelineEvent[];
  cursor: string | null;
  hasEarlier: boolean;
  status: "idle" | "loading" | "error";
}>;

type EarlierTimelineResponse = Readonly<{
  events: readonly SafeTimelineEvent[];
  cursor: string | null;
  hasEarlier: boolean;
}>;

type TakeoverUiState = Readonly<{
  status: "unknown" | "loading" | "ready" | "error";
  active: boolean;
  source: string | null;
  changedAt: string | null;
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

function inboxOrder(left: ReplyQueueItem, right: ReplyQueueItem) {
  return right.lastActivityAt.localeCompare(left.lastActivityAt)
    || left.inboxId.localeCompare(right.inboxId);
}

function normalizeInboxItems(items: readonly ReplyQueueItem[]) {
  const byInboxId = new Map<string, ReplyQueueItem>();
  for (const item of items) {
    const current = byInboxId.get(item.inboxId);
    if (!current || item.lastActivityAt >= current.lastActivityAt) {
      byInboxId.set(item.inboxId, item);
    }
  }
  return [...byInboxId.values()].sort(inboxOrder);
}

function mergeTimelineEvents(
  earlier: readonly SafeTimelineEvent[],
  current: readonly SafeTimelineEvent[],
) {
  const events = new Map<string, SafeTimelineEvent>();
  for (const event of [...earlier, ...current]) events.set(event.eventId, event);
  return [...events.values()];
}

function mergeInboxItems(current: ReplyQueueItem, sent: SafeInboxItem): ReplyQueueItem {
  return {
    ...sent,
    ...current,
    timeline: mergeTimelineEvents(sent.timeline, current.timeline),
  };
}

function timelineWindowsMatch(
  previous: Readonly<Record<string, readonly SafeTimelineEvent[]>>,
  current: Readonly<Record<string, readonly SafeTimelineEvent[]>>,
) {
  const previousIds = Object.keys(previous);
  const currentIds = Object.keys(current);
  if (previousIds.length !== currentIds.length) return false;
  return currentIds.every((inboxId) => {
    const left = previous[inboxId] ?? [];
    const right = current[inboxId] ?? [];
    return left.length === right.length
      && left.every((event, index) => event.eventId === right[index]?.eventId);
  });
}

export function ReplyAssistantClient({
  initialItems,
  liveItems,
  newInboxIds = [],
  onRefresh,
  selectedReviewSelector = null,
  channelScope = "all",
  takeoverRefreshRevision = 0,
}: Readonly<{
  initialItems?: readonly ReplyQueueItem[];
  liveItems?: readonly ReplyQueueItem[];
  newInboxIds?: readonly string[];
  onRefresh?: () => void;
  selectedReviewSelector?: string | null;
  channelScope?: "all" | "website" | "facebook";
  takeoverRefreshRevision?: number;
}>) {
  const [fetchedItems, setFetchedItems] = useState<readonly ReplyQueueItem[]>(initialItems ?? []);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [websiteReplies, setWebsiteReplies] = useState<Record<string, WebsiteReplyState>>({});
  const [facebookReplies, setFacebookReplies] = useState<Record<string, FacebookReplyState>>({});
  const [sentFacebookItems, setSentFacebookItems] = useState<Record<string, SentFacebookItem>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedbackRequests, setFeedbackRequests] = useState<Record<string, FeedbackRequest>>({});
  const [feedbackErrors, setFeedbackErrors] = useState<Record<string, string>>({});
  const [feedbackCompletions, setFeedbackCompletions] = useState<Record<string, FeedbackAction>>({});
  const [earlierTimelines, setEarlierTimelines] = useState<Record<string, EarlierTimelineState>>({});
  const [takeovers, setTakeovers] = useState<Record<string, TakeoverUiState>>({});
  const [previousTimelineWindows, setPreviousTimelineWindows] = useState<
    Record<string, readonly SafeTimelineEvent[]>
  >({});
  const [visibleCounts, setVisibleCounts] = useState<Record<"all" | "website" | "facebook", number>>({
    all: CONVERSATION_BATCH_SIZE,
    website: CONVERSATION_BATCH_SIZE,
    facebook: CONVERSATION_BATCH_SIZE,
  });
  const feedbackSequence = useRef(0);
  const feedbackRetryKeys = useRef(new Map<string, string>());
  const feedbackInFlight = useRef(new Set<string>());
  const websiteReplyInFlight = useRef(new Set<string>());
  const facebookReplyInFlight = useRef(new Set<string>());
  const facebookReplyKeys = useRef(new Map<string, string>());
  const facebookReplySequence = useRef(0);
  const selectedCardRef = useRef<HTMLElement | null>(null);
  const takeoverReadVersions = useRef(new Map<string, number>());
  const takeoverReadControllers = useRef(new Map<string, AbortController>());
  const observedTakeoverIds = useRef(new Set<string>());
  const previousTakeoverRefreshRevision = useRef<number | null>(null);
  const takeoverMutationsInFlight = useRef(new Set<string>());

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

  const sourceItems = liveItems === undefined
    ? normalizeInboxItems(fetchedItems)
    : (() => {
      const sorted = normalizeInboxItems(liveItems);
      const selected = selectedReviewSelector
        ? sorted.find((item) => item.websiteReview?.selector === selectedReviewSelector)
        : undefined;
      return selected
        ? [selected, ...sorted.filter((item) => item.inboxId !== selected.inboxId)].slice(0, 100)
        : sorted.slice(0, 100);
    })();
  const activeSentFacebookItems = Object.fromEntries(Object.entries(sentFacebookItems).filter(([inboxId, sent]) => {
    const authoritative = sourceItems.find((item) => item.inboxId === inboxId);
    if (!authoritative) return true;
    const echoed = sent.pendingTimelineEventIds.every((eventId) => authoritative.timeline.some((event) => event.eventId === eventId));
    return !echoed && authoritative.lastActivityAt <= sent.item.lastActivityAt;
  }));
  const items = sourceItems.map((item) => {
    const sent = activeSentFacebookItems[item.inboxId];
    return sent ? mergeInboxItems(item, sent.item) : item;
  });

  const currentTimelineWindows = Object.fromEntries(items.map((item) => [item.inboxId, item.timeline]));
  if (!timelineWindowsMatch(previousTimelineWindows, currentTimelineWindows)) {
    setPreviousTimelineWindows(currentTimelineWindows);
    setEarlierTimelines((states) => {
      let next = states;
      for (const item of items) {
        const current = states[item.inboxId];
        if (!current) continue;
        const merged = mergeTimelineEvents(
          mergeTimelineEvents(current.events, previousTimelineWindows[item.inboxId] ?? []),
          item.timeline,
        );
        if (merged.length === current.events.length) continue;
        if (next === states) next = { ...states };
        next[item.inboxId] = { ...current, events: merged };
      }
      return next;
    });
  }

  const visibleCount = visibleCounts[channelScope];
  const visibleItems = items.slice(0, visibleCount);
  const remainingCount = items.length - visibleItems.length;
  const visibleTakeoverIds = visibleItems
    .filter((item) => (item.channel === "facebook" || item.source === "redis_website") && /^[a-f0-9]{64}$/.test(item.inboxId))
    .map((item) => item.inboxId);
  const visibleTakeoverKey = visibleTakeoverIds.join(":");

  useEffect(() => {
    if (!visibleTakeoverKey) return;
    const refreshAll = previousTakeoverRefreshRevision.current !== takeoverRefreshRevision;
    previousTakeoverRefreshRevision.current = takeoverRefreshRevision;
    const inboxIds = visibleTakeoverKey
      .split(":")
      .filter((inboxId) => !takeoverMutationsInFlight.current.has(inboxId))
      .filter((inboxId) => refreshAll || !observedTakeoverIds.current.has(inboxId));
    for (const inboxId of inboxIds) {
      observedTakeoverIds.current.add(inboxId);
      takeoverReadControllers.current.get(inboxId)?.abort();
      const controller = new AbortController();
      takeoverReadControllers.current.set(inboxId, controller);
      const version = (takeoverReadVersions.current.get(inboxId) ?? 0) + 1;
      takeoverReadVersions.current.set(inboxId, version);
      void fetch(`/api/reply-assistant/conversations/${encodeURIComponent(inboxId)}/takeover`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error("takeover_read_failed");
        const state = await response.json() as Omit<TakeoverUiState, "status">;
        if (takeoverReadVersions.current.get(inboxId) === version) {
          setTakeovers((states) => ({ ...states, [inboxId]: { status: "ready", ...state } }));
        }
      }).catch(() => {
        if (!controller.signal.aborted && takeoverReadVersions.current.get(inboxId) === version) setTakeovers((states) => ({
          ...states,
          [inboxId]: { status: "error", active: false, source: null, changedAt: null },
        }));
      }).finally(() => {
        if (takeoverReadControllers.current.get(inboxId) === controller) {
          takeoverReadControllers.current.delete(inboxId);
        }
      });
    }
  }, [visibleTakeoverKey, takeoverRefreshRevision]);

  useEffect(() => () => {
    for (const controller of takeoverReadControllers.current.values()) controller.abort();
    takeoverReadControllers.current.clear();
    takeoverReadVersions.current.clear();
    observedTakeoverIds.current.clear();
    previousTakeoverRefreshRevision.current = null;
  }, []);

  useEffect(() => {
    selectedCardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedReviewSelector]);

  function review(item: ReplyQueueItem): ReviewState {
    return reviews[item.inboxId] ?? {
      mode: "pending",
      text: item.draftText ?? "",
      sourceAttemptId: item.latestAttemptId,
    };
  }

  function update(item: ReplyQueueItem, next: ReviewState) {
    setReviews((current) => ({ ...current, [item.inboxId]: next }));
  }

  function setFeedbackError(inboxId: string, message: string | null) {
    setFeedbackErrors((errors) => {
      if (message === null) {
        const remaining = { ...errors };
        delete remaining[inboxId];
        return remaining;
      }
      return { ...errors, [inboxId]: message };
    });
  }

  async function feedback(item: ReplyQueueItem, action: FeedbackAction, text: string | null, reasonCode: string | null) {
    if (!item.latestAttemptId) return false;
    const attemptId = item.latestAttemptId;
    const intent = `${attemptId}:${action}`;
    if (feedbackInFlight.current.has(intent)) return false;
    const idempotencyKey = feedbackRetryKeys.current.get(intent) ?? `${action}-${++feedbackSequence.current}`;
    feedbackRetryKeys.current.set(intent, idempotencyKey);
    feedbackInFlight.current.add(intent);
    setFeedbackRequests((requests) => ({
      ...requests,
      [item.inboxId]: { attemptId, action, idempotencyKey },
    }));
    setFeedbackError(item.inboxId, null);
    try {
      await jsonRequest(`/api/reply-assistant/drafts/${attemptId}/feedback`, {
        action,
        humanFinalText: text,
        reasonCode,
        idempotencyKey,
      });
      if (action === "copied") feedbackRetryKeys.current.delete(intent);
      else setFeedbackCompletions((completions) => ({ ...completions, [attemptId]: action }));
      return true;
    } catch {
      setFeedbackError(item.inboxId, "We could not save this review. Please try again.");
      return false;
    } finally {
      feedbackInFlight.current.delete(intent);
      setFeedbackRequests((requests) => {
        const request = requests[item.inboxId];
        if (!request
          || request.attemptId !== attemptId
          || request.action !== action
          || request.idempotencyKey !== idempotencyKey) return requests;
        const remaining = { ...requests };
        delete remaining[item.inboxId];
        return remaining;
      });
    }
  }

  async function generate(item: ReplyQueueItem, regenerate = false) {
    setBusy(item.inboxId);
    try {
      const url = regenerate && item.latestAttemptId
        ? `/api/reply-assistant/drafts/${item.latestAttemptId}/regenerate`
        : `/api/reply-assistant/messages/${item.latestMessageId}/generate`;
      await jsonRequest(url, {});
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sendWebsiteReply(item: ReplyQueueItem, current: WebsiteReplyState) {
    if (!item.websiteReview?.selector || websiteReplyInFlight.current.has(item.inboxId)) return;
    const text = current.text.trim();
    if (!text) return;
    websiteReplyInFlight.current.add(item.inboxId);
    setWebsiteReplies((states) => ({
      ...states,
      [item.inboxId]: { ...current, text, status: "sending" },
    }));
    try {
      await jsonRequest("/api/reply-assistant/website-replies", {
        reviewSelector: item.websiteReview.selector,
        text,
      });
      setWebsiteReplies((states) => ({
        ...states,
        [item.inboxId]: { ...current, text, status: "sent" },
      }));
      onRefresh?.();
    } catch {
      setWebsiteReplies((states) => ({
        ...states,
        [item.inboxId]: { ...current, text, status: "error" },
      }));
    } finally {
      websiteReplyInFlight.current.delete(item.inboxId);
    }
  }

  async function sendFacebookReply(item: ReplyQueueItem, current: ReviewState) {
    if (!item.latestAttemptId
      || !/^[a-f0-9]{64}$/.test(item.inboxId)
      || facebookReplyInFlight.current.has(item.inboxId)
      || takeoverMutationsInFlight.current.has(item.inboxId)) return;
    const attemptId = item.latestAttemptId;
    const text = current.text.trim();
    if (!text || Array.from(text).length > 2_000) return;
    const intent = `${attemptId}:${text}`;
    const idempotencyKey = facebookReplyKeys.current.get(intent) ?? `facebook-send-${++facebookReplySequence.current}`;
    facebookReplyKeys.current.set(intent, idempotencyKey);
    facebookReplyInFlight.current.add(item.inboxId);
    takeoverMutationsInFlight.current.add(item.inboxId);
    takeoverReadControllers.current.get(item.inboxId)?.abort();
    takeoverReadControllers.current.delete(item.inboxId);
    takeoverReadVersions.current.set(item.inboxId, (takeoverReadVersions.current.get(item.inboxId) ?? 0) + 1);
    setFacebookReplies((states) => ({ ...states, [item.inboxId]: { attemptId, status: "sending" } }));
    try {
      const response = await fetch("/api/reply-assistant/facebook-replies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inboxId: item.inboxId,
          attemptId,
          text,
          idempotencyKey,
        }),
      });
      const body = await response.json().catch(() => null) as FacebookReplyResponse | { error?: { code?: string } } | null;
      if (response.ok && body && "status" in body && body.status === "sent" && "item" in body && "takeover" in body) {
        setSentFacebookItems((items) => ({
          ...items,
          [item.inboxId]: {
            item: body.item,
            pendingTimelineEventIds: body.item.timeline
              .filter((event) => !item.timeline.some((currentEvent) => currentEvent.eventId === event.eventId))
              .map((event) => event.eventId),
          },
        }));
        setTakeovers((states) => ({ ...states, [item.inboxId]: { status: "ready", ...body.takeover } }));
        setFacebookReplies((states) => ({ ...states, [item.inboxId]: { attemptId, status: "sent" } }));
        onRefresh?.();
        return;
      }
      const code = body && "error" in body ? body.error?.code : null;
      const status = response.status === 502 && code === "META_SEND_FAILED"
        ? "error"
        : code === "FACEBOOK_REPLY_UNAVAILABLE" ? "unavailable" : "uncertain";
      setFacebookReplies((states) => ({ ...states, [item.inboxId]: { attemptId, status } }));
      setTakeovers((states) => states[item.inboxId]?.status === "ready" ? states : ({
        ...states,
        [item.inboxId]: { status: "error", active: false, source: null, changedAt: null },
      }));
    } catch {
      setFacebookReplies((states) => ({ ...states, [item.inboxId]: { attemptId, status: "uncertain" } }));
      setTakeovers((states) => states[item.inboxId]?.status === "ready" ? states : ({
        ...states,
        [item.inboxId]: { status: "error", active: false, source: null, changedAt: null },
      }));
    } finally {
      facebookReplyInFlight.current.delete(item.inboxId);
      takeoverMutationsInFlight.current.delete(item.inboxId);
    }
  }

  async function loadEarlierTimeline(item: ReplyQueueItem, current: EarlierTimelineState | undefined) {
    const cursor = current?.cursor ?? item.timeline[0]?.eventId ?? (item.source === "shared_meta" ? `meta:${item.inboxId}` : null);
    if (!cursor || current?.status === "loading") return;
    setEarlierTimelines((states) => ({
      ...states,
      [item.inboxId]: {
        events: current?.events ?? [],
        cursor,
        hasEarlier: current?.hasEarlier ?? item.hasEarlierTimeline,
        status: "loading",
      },
    }));
    try {
      const response = await fetch(
        `/api/reply-assistant/inbox/${encodeURIComponent(item.inboxId)}/timeline?cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store", headers: { accept: "application/json" } },
      );
      if (!response.ok) throw new Error("timeline_request_failed");
      const page = await response.json() as EarlierTimelineResponse;
      setEarlierTimelines((states) => ({
        ...states,
        [item.inboxId]: {
          events: mergeTimelineEvents(
            page.events,
            mergeTimelineEvents(states[item.inboxId]?.events ?? [], item.timeline),
          ),
          cursor: page.cursor,
          hasEarlier: page.hasEarlier,
          status: "idle",
        },
      }));
    } catch {
      setEarlierTimelines((states) => ({
        ...states,
        [item.inboxId]: {
          events: states[item.inboxId]?.events ?? [],
          cursor: states[item.inboxId]?.cursor ?? cursor,
          hasEarlier: states[item.inboxId]?.hasEarlier ?? true,
          status: "error",
        },
      }));
    }
  }

  async function mutateTakeover(item: ReplyQueueItem, active: boolean) {
    if (takeoverMutationsInFlight.current.has(item.inboxId)) return;
    takeoverMutationsInFlight.current.add(item.inboxId);
    takeoverReadControllers.current.get(item.inboxId)?.abort();
    takeoverReadControllers.current.delete(item.inboxId);
    takeoverReadVersions.current.set(item.inboxId, (takeoverReadVersions.current.get(item.inboxId) ?? 0) + 1);
    const previous = takeovers[item.inboxId] ?? { status: "unknown", active: false, source: null, changedAt: null };
    setTakeovers((states) => ({ ...states, [item.inboxId]: { ...previous, status: "loading" } }));
    try {
      const response = await fetch(`/api/reply-assistant/conversations/${encodeURIComponent(item.inboxId)}/takeover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!response.ok) throw new Error("takeover_write_failed");
      const state = await response.json() as Omit<TakeoverUiState, "status">;
      setTakeovers((states) => ({ ...states, [item.inboxId]: { status: "ready", ...state } }));
    } catch {
      setTakeovers((states) => ({ ...states, [item.inboxId]: { ...previous, status: "error" } }));
    } finally {
      takeoverMutationsInFlight.current.delete(item.inboxId);
    }
  }

  return (
    <div className={styles.queue}>
      {items.length === 0 ? <p className={styles.empty}>No pilot messages yet.</p> : null}
      {visibleItems.map((item) => {
        const current = review(item);
        const currentWebsiteReply = websiteReplies[item.inboxId] ?? {
          text: "",
          sourceReviewSelector: item.websiteReview?.selector ?? "",
          status: "editing" as const,
        };
        const websiteReviewChanged = Boolean(item.websiteReview)
          && currentWebsiteReply.sourceReviewSelector !== item.websiteReview?.selector;
        const gateBlocked = !item.draftText && item.gateResult !== null && item.gateResult !== "allowed";
        const earlierTimeline = earlierTimelines[item.inboxId];
        const timeline = mergeTimelineEvents(earlierTimeline?.events ?? [], item.timeline);
        const latestCustomerText = [...timeline].reverse().find((event) => event.role === "customer")?.text ?? "";
        const imageOnly = item.attachmentCount > 0 && latestCustomerText === "[Image attachment]";
        const visualReviewRequired = imageOnly || item.imageAnalysisStatus === "human_review_required";
        const requiresHumanReview = gateBlocked || visualReviewRequired || item.websiteReview !== null;
        const serverChanged = current.sourceAttemptId !== item.latestAttemptId;
        const approved = !serverChanged && (current.mode === "accepted" || current.mode === "edited");
        const locallyEditing = current.mode === "editing";
        const feedbackPending = feedbackRequests[item.inboxId]?.attemptId === item.latestAttemptId;
        const feedbackCompletion = item.latestAttemptId ? feedbackCompletions[item.latestAttemptId] ?? null : null;
        const outcomeCompleted = feedbackCompletion === "accepted_unchanged"
          || feedbackCompletion === "edited"
          || feedbackCompletion === "rejected";
        const feedbackError = feedbackErrors[item.inboxId] ?? null;
        const facebookReply = facebookReplies[item.inboxId]?.attemptId === item.latestAttemptId
          ? facebookReplies[item.inboxId]
          : undefined;
        const selected = selectedReviewSelector !== null
          && item.websiteReview?.selector === selectedReviewSelector;
        return (
          <article
            className={styles.message}
            key={item.inboxId}
            data-selected={selected}
            ref={selected ? selectedCardRef : undefined}
          >
            <header>
              <time>{formatReplyReceivedAt(item.lastActivityAt)}</time>
              <div className={styles.statuses}>
                <span className={styles.channelBadge} data-channel={item.channel}>{item.channel === "website" ? "Website" : "Facebook"}</span>
                {newInboxIds.includes(item.inboxId) ? <span className={styles.newBadge}>New</span> : null}
                {item.unreadCount > 0 ? <span className={styles.unreadBadge}>{item.unreadCount} unread</span> : null}
                <span data-risk={requiresHumanReview}>{item.humanReplyReceived ? "human replied" : requiresHumanReview ? "Human review required" : item.status.replaceAll("_", " ")}</span>
                {item.websiteReview ? <span className={styles.alertBadge} data-alert={item.websiteReview.alertStatus}>Alert {item.websiteReview.alertStatus.replaceAll("_", " ")}</span> : null}
              </div>
            </header>
            {(item.channel === "facebook" || item.source === "redis_website") && /^[a-f0-9]{64}$/.test(item.inboxId) ? (
              <div className={styles.takeoverBar}>
                <span>
                  {takeovers[item.inboxId]?.status === "error"
                    ? "AI handling status unavailable"
                    : takeovers[item.inboxId]?.status === "ready"
                      ? takeovers[item.inboxId]?.active ? "Human takeover active" : "AI handling available"
                      : "Checking AI handling…"}
                </span>
                {takeovers[item.inboxId]?.status === "ready" ? (
                  takeovers[item.inboxId]?.active ? (
                    <button type="button" disabled={facebookReply?.status === "sending"} onClick={() => void mutateTakeover(item, false)}>Release conversation to AI</button>
                  ) : (
                    <button type="button" disabled={facebookReply?.status === "sending"} onClick={() => void mutateTakeover(item, true)}>Take over conversation</button>
                  )
                ) : null}
              </div>
            ) : null}
            <div className={styles.messageBody}>
              <div className={styles.messageContext}>
                {timeline.length > 0 || (item.source === "shared_meta" && (earlierTimeline?.hasEarlier ?? item.hasEarlierTimeline)) ? (
                  <section className={styles.timeline} aria-label="Conversation timeline">
                    <div className={styles.timelineHeader}>
                      <strong>Conversation timeline</strong>
                      <span className={styles.timelineChannel}>{item.channel === "website" ? "Website" : "Facebook"}</span>
                    </div>
                    <ol>
                      {timeline.map((event) => (
                        <li key={event.eventId} data-role={event.role}>
                          <span>{event.pageOutbound ? "Page reply" : event.role === "staff" ? "R&R" : event.role === "assistant" ? "Assistant" : "Customer"}</span>
                          <p>{event.text}</p>
                        </li>
                      ))}
                    </ol>
                    {(earlierTimeline?.hasEarlier ?? item.hasEarlierTimeline) ? (
                      <button
                        type="button"
                        className={styles.loadEarlier}
                        aria-label="Load earlier conversation history"
                        disabled={earlierTimeline?.status === "loading"}
                        onClick={() => void loadEarlierTimeline(item, earlierTimeline)}
                      >{earlierTimeline?.status === "loading" ? "Loading…" : "Load earlier"}</button>
                    ) : null}
                    {earlierTimeline?.status === "error" ? (
                      <div className={styles.serverChanged} role="alert">Earlier history could not be loaded. Try again.</div>
                    ) : null}
                  </section>
                ) : null}
                {item.historyIncompleteReason ? <p>{item.historyIncompleteReason}</p> : null}
                {item.attachmentCount > 0 ? (
                  <section className={styles.imageAssessment}>
                    <strong>Image assessment</strong>
                    <p>{item.imageAssessmentSummary ?? "No safe image assessment is available."}</p>
                  </section>
                ) : null}
              </div>
              <div className={styles.messageResponse}>
              {facebookReply?.status === "sent" ? <div className={styles.sendStatus}>Reply sent to Facebook.</div> : null}
              {item.channel === "website" ? (
              item.humanReplyReceived ? (
                <div className={styles.blocked}>Human website reply sent. Review resolved.</div>
              ) : item.websiteReview ? (
                item.websiteReview.selector ? (
                <div className={styles.websiteReply}>
                  <label htmlFor={`website-reply-${item.inboxId}`}>Website reply</label>
                  <textarea
                    id={`website-reply-${item.inboxId}`}
                    value={currentWebsiteReply.text}
                    maxLength={2_000}
                    onChange={(event) => setWebsiteReplies((states) => ({
                      ...states,
                      [item.inboxId]: {
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
            ) : item.source === "shared_meta" ? (
              <div className={styles.blocked}>Reply in <a href="https://business.facebook.com/latest/inbox" target="_blank" rel="noopener noreferrer">Meta Business Suite</a>. Use human takeover here to pause AI replies. Page replies are shown from the actual Meta transcript.</div>
            ) : item.humanReplyReceived && !locallyEditing ? (
              <div className={styles.blocked}>Human reply sent in Meta. AI draft closed.</div>
            ) : gateBlocked ? (
              <>
                <div className={styles.blocked}>Risk: {item.gateResult?.replaceAll("_", " ")}</div>
                <button className={styles.generate} type="button" disabled>Generate AI Reply</button>
              </>
            ) : item.draftText || locallyEditing ? (
              <div className={styles.draftArea}>
                <label htmlFor={`draft-${item.inboxId}`}>Reply draft</label>
                <textarea
                  id={`draft-${item.inboxId}`}
                  value={current.text}
                  maxLength={2_000}
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
                {facebookReply?.status === "error" ? <div className={styles.serverChanged} role="alert">Facebook did not send this reply. You can try again.</div> : null}
                {facebookReply?.status === "unavailable" ? <div className={styles.serverChanged} role="alert">This Facebook reply is no longer available. Refresh the conversation before sending.</div> : null}
                {facebookReply?.status === "uncertain" ? <div className={styles.serverChanged} role="alert">We could not confirm delivery to Facebook. Do not send again until you refresh this conversation.</div> : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    data-variant="primary"
                    disabled={!current.text.trim() || Array.from(current.text.trim()).length > 2_000 || !item.latestAttemptId || serverChanged || takeovers[item.inboxId]?.status === "loading" || facebookReply?.status === "sending" || facebookReply?.status === "sent" || facebookReply?.status === "unavailable" || facebookReply?.status === "uncertain"}
                    onClick={() => void sendFacebookReply(item, current)}
                  >{facebookReply?.status === "sending" ? "Sending…" : "Send to Facebook"}</button>
                  {current.mode === "editing" ? (
                    <button type="button" data-variant="primary" disabled={serverChanged || feedbackPending || outcomeCompleted} onClick={async () => {
                      if (!await feedback(item, "edited", current.text, "human_edit")) return;
                      update(item, { mode: "edited", text: current.text, sourceAttemptId: item.latestAttemptId });
                    }}>Accept edit</button>
                  ) : (
                    <button type="button" disabled={feedbackPending || outcomeCompleted} onClick={() => update(item, {
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
                  <button type="button" disabled={busy === item.inboxId || feedbackPending || visualReviewRequired || serverChanged} onClick={() => void generate(item, true)}>Regenerate</button>
                  <button type="button" disabled={!approved || serverChanged || feedbackPending} onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(current.text);
                    } catch {
                      setFeedbackError(item.inboxId, "The reply could not be copied. Please try again.");
                      return;
                    }
                    if (!await feedback(item, "copied", current.text, null)) {
                      setFeedbackError(item.inboxId, "The text was copied, but its review event was not saved. Copy again to retry.");
                    }
                  }}>Copy</button>
                  <button type="button" disabled={!approved || serverChanged || feedbackPending || feedbackCompletion === "sent_confirmed"} onClick={() => void feedback(item, "sent_confirmed", current.text, null)}>Mark as sent externally</button>
                </div>
              </div>
            ) : (
              <button className={styles.generate} data-variant="primary" type="button" disabled={busy === item.inboxId || visualReviewRequired} onClick={() => void generate(item)}>Generate AI Reply</button>
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
