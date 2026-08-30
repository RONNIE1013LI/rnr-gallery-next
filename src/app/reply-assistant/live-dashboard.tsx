"use client";

import { useEffect, useRef, useState } from "react";
import { ReplyAssistantClient, type ReplyQueueItem } from "@/components/reply-assistant/reply-assistant-client";
import type {
  PilotMetricCounts,
  ReplyAssistantCaseMemoryPage,
  ReplyAssistantLearningCandidatePage,
} from "@/server/customer-service/repositories/customer-service-repository";
import { CaseMemoryReview, type CaseMemoryView } from "./case-memory-review";
import { LearningCandidateReview, type LearningCandidateView } from "./learning-candidate-review";
import {
  channelMetricCards,
  replyAssistantMetricCards,
  type ReplyAssistantMetricCard,
} from "./metric-cards";
import styles from "./reply-assistant.module.css";

const ACTIVE_POLL_MS = 2_500;
const RETRY_POLL_MS = 5_000;

type LiveUpdateResponse = Readonly<{
  cursor: string;
  hasMore: boolean;
  queueItems: readonly ReplyQueueItem[];
  metrics: PilotMetricCounts | null;
  learningCandidates: ReplyAssistantLearningCandidatePage | null;
  caseMemories: ReplyAssistantCaseMemoryPage | null;
}>;

export function mergeReplyQueueItems(
  current: readonly ReplyQueueItem[],
  changes: readonly ReplyQueueItem[],
  selectedReviewSelector?: string | null,
) {
  const byId = new Map(current.map((item) => [item.messageId, item]));
  for (const item of changes) byId.set(item.messageId, item);
  const sorted = [...byId.values()].sort((left, right) => (
    right.receivedAt.localeCompare(left.receivedAt) || right.messageId.localeCompare(left.messageId)
  ));
  const selected = selectedReviewSelector
    ? sorted.find((item) => item.websiteReview?.selector === selectedReviewSelector)
    : undefined;
  return selected
    ? [selected, ...sorted.filter((item) => item.messageId !== selected.messageId)].slice(0, 100)
    : sorted.slice(0, 100);
}

export function ReplyAssistantLiveDashboard({
  initialCursor,
  initialItems,
  initialMetricCards,
  initialMetrics,
  initialLearningCandidates,
  initialCaseMemories,
  canReview,
  selectedReviewSelector,
}: Readonly<{
  initialCursor: string;
  initialItems: readonly ReplyQueueItem[];
  initialMetricCards: readonly ReplyAssistantMetricCard[];
  initialMetrics?: PilotMetricCounts;
  initialLearningCandidates: readonly LearningCandidateView[];
  initialCaseMemories: readonly CaseMemoryView[];
  canReview: boolean;
  selectedReviewSelector?: string | null;
}>) {
  const [items, setItems] = useState(initialItems);
  const [newMessageIds, setNewMessageIds] = useState<readonly string[]>([]);
  const [metricCards, setMetricCards] = useState(initialMetricCards);
  const [metricCounts, setMetricCounts] = useState<PilotMetricCounts | null>(initialMetrics ?? null);
  const [metricScope, setMetricScope] = useState<"all" | "website" | "facebook">("all");
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [learningCandidates, setLearningCandidates] = useState(initialLearningCandidates);
  const [caseMemories, setCaseMemories] = useState(initialCaseMemories);
  const [connectionState, setConnectionState] = useState<"active" | "reconnecting">("active");
  const cursorRef = useRef(initialCursor);
  const itemsRef = useRef(initialItems);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const pageIsVisible = () => document.visibilityState !== "hidden";

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void poll(); }, delay);
    };

    const poll = async () => {
      if (cancelled || inFlight || !pageIsVisible()) return;
      inFlight = true;
      let nextDelay = ACTIVE_POLL_MS;
      try {
        const response = await fetch(`/api/reply-assistant/updates?cursor=${encodeURIComponent(cursorRef.current)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error("live_updates_failed");
        const update = await response.json() as LiveUpdateResponse;
        if (cancelled) return;
        const knownIds = new Set(itemsRef.current.map((item) => item.messageId));
        const arrived = update.queueItems
          .filter((item) => !knownIds.has(item.messageId))
          .map((item) => item.messageId);
        if (arrived.length) {
          setNewMessageIds((current) => [...new Set([...current, ...arrived])]);
        }
        if (update.queueItems.length) {
          setItems((current) => mergeReplyQueueItems(current, update.queueItems, selectedReviewSelector));
        }
        if (update.metrics) {
          setMetricCounts(update.metrics);
          setMetricCards(replyAssistantMetricCards(update.metrics));
        }
        if (update.learningCandidates) setLearningCandidates(update.learningCandidates.items);
        if (update.caseMemories) setCaseMemories(update.caseMemories.items);
        cursorRef.current = update.cursor;
        setConnectionState("active");
        nextDelay = update.hasMore ? 0 : ACTIVE_POLL_MS;
      } catch {
        if (!cancelled) setConnectionState("reconnecting");
        nextDelay = RETRY_POLL_MS;
      } finally {
        inFlight = false;
        if (!cancelled && pageIsVisible()) schedule(nextDelay);
      }
    };

    const catchUp = () => {
      if (pageIsVisible()) {
        if (timer) clearTimeout(timer);
        void poll();
      }
    };
    refreshRef.current = catchUp;
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        catchUp();
      }
    };

    if (pageIsVisible()) schedule(ACTIVE_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      cancelled = true;
      refreshRef.current = () => undefined;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
    };
  }, [selectedReviewSelector]);

  const visibleMetricCards = metricScope === "all"
    ? metricCards
    : metricCounts?.channelMetrics
      ? channelMetricCards(metricCounts.channelMetrics[metricScope])
      : metricCards;
  const displayedMetricCards = showAllMetrics ? visibleMetricCards : visibleMetricCards.slice(0, 8);

  return (
    <div className={styles.liveDashboard}>
      <div className={styles.dashboardToolbar}>
        {metricCounts?.channelMetrics ? (
          <div className={styles.metricFilters} aria-label="Metric channel">
            {(["all", "website", "facebook"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                aria-label={`${scope[0].toUpperCase()}${scope.slice(1)} metrics`}
                aria-pressed={metricScope === scope}
                onClick={() => {
                  setMetricScope(scope);
                  setShowAllMetrics(false);
                }}
              >
                {scope[0].toUpperCase()}{scope.slice(1)}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.liveStatus} aria-live="polite" data-state={connectionState}>
          {connectionState === "reconnecting" ? "Live updates reconnecting" : "Live updates active"}
        </div>
      </div>
      <section className={styles.metricPanel} aria-label="Reply assistant metrics">
        <div className={styles.metrics}>{displayedMetricCards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        {visibleMetricCards.length > 8 ? (
          <button
            type="button"
            className={styles.metricDisclosure}
            aria-expanded={showAllMetrics}
            onClick={() => setShowAllMetrics((current) => !current)}
          >
            {showAllMetrics ? "Show core metrics" : `Show all ${visibleMetricCards.length} metrics`}
          </button>
        ) : null}
      </section>
      <LearningCandidateReview candidates={learningCandidates} canReview={canReview} />
      <CaseMemoryReview cases={caseMemories} canReview={canReview} />
      <section className={styles.conversationPanel} aria-label="Needs attention conversations">
        <div className={styles.conversationHeading}>
          <h2>Needs attention</h2>
          <span>{items.length} {items.length === 1 ? "conversation" : "conversations"}</span>
        </div>
        <ReplyAssistantClient
          initialItems={initialItems}
          liveItems={items}
          newMessageIds={newMessageIds}
          onRefresh={() => refreshRef.current()}
          selectedReviewSelector={selectedReviewSelector}
        />
      </section>
    </div>
  );
}
