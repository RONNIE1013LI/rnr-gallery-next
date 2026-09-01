"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const byId = new Map(current.map((item) => [item.inboxId, item]));
  for (const item of changes) {
    const existing = byId.get(item.inboxId);
    if (!existing || item.lastActivityAt >= existing.lastActivityAt) byId.set(item.inboxId, item);
  }
  const sorted = [...byId.values()].sort((left, right) => (
    right.lastActivityAt.localeCompare(left.lastActivityAt) || left.inboxId.localeCompare(right.inboxId)
  ));
  const selected = selectedReviewSelector
    ? sorted.find((item) => item.websiteReview?.selector === selectedReviewSelector)
    : undefined;
  return selected
    ? [selected, ...sorted.filter((item) => item.inboxId !== selected.inboxId)].slice(0, 100)
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
  const [newInboxIds, setNewInboxIds] = useState<readonly string[]>([]);
  const [metricCards, setMetricCards] = useState(initialMetricCards);
  const [metricCounts, setMetricCounts] = useState<PilotMetricCounts | null>(initialMetrics ?? null);
  const [channelScope, setChannelScope] = useState<"all" | "website" | "facebook">("all");
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [learningCandidates, setLearningCandidates] = useState(initialLearningCandidates);
  const [caseMemories, setCaseMemories] = useState(initialCaseMemories);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "failed">("idle");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const cursorRef = useRef(initialCursor);
  const itemsRef = useRef(initialItems);
  const activeControllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => { itemsRef.current = items; }, [items]);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setRefreshState("refreshing");
    try {
      const response = await fetch(`/api/reply-assistant/updates?cursor=${encodeURIComponent(cursorRef.current)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("live_updates_failed");
      const update = await response.json() as LiveUpdateResponse;
      if (controller.signal.aborted) return;
      const knownLatestMessageByInbox = new Map(itemsRef.current.map((item) => [item.inboxId, item.latestMessageId]));
      const arrived = update.queueItems
        .filter((item) => knownLatestMessageByInbox.get(item.inboxId) !== item.latestMessageId)
        .map((item) => item.inboxId);
      if (arrived.length) {
        setNewInboxIds((current) => [...new Set([...current, ...arrived])]);
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
      setLastUpdatedAt(new Date());
      setRefreshState("idle");
    } catch {
      if (!controller.signal.aborted) setRefreshState("failed");
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      inFlightRef.current = false;
    }
  }, [selectedReviewSelector]);

  useEffect(() => () => {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  const visibleMetricCards = channelScope === "all"
    ? metricCards
    : metricCounts?.channelMetrics
      ? channelMetricCards(metricCounts.channelMetrics[channelScope])
      : metricCards;
  const displayedMetricCards = showAllMetrics ? visibleMetricCards : visibleMetricCards.slice(0, 8);
  const filteredItems = channelScope === "all"
    ? items
    : items.filter((item) => item.channel === channelScope);

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
                aria-pressed={channelScope === scope}
                onClick={() => {
                  setChannelScope(scope);
                  setShowAllMetrics(false);
                }}
              >
                {scope[0].toUpperCase()}{scope.slice(1)}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.refreshControls}>
          <div className={styles.liveStatus} aria-live="polite" data-state={refreshState}>
            {refreshState === "failed"
              ? "Refresh failed"
              : refreshState === "refreshing"
                ? "Refreshing"
                : lastUpdatedAt
                  ? `Last updated ${lastUpdatedAt.toLocaleTimeString()}`
                  : "Updates on request"}
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            aria-label="Refresh conversations"
            disabled={refreshState === "refreshing"}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
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
      <LearningCandidateReview
        candidates={learningCandidates}
        pendingCount={metricCounts?.learningCandidatesPending}
        canReview={canReview}
      />
      <CaseMemoryReview cases={caseMemories} canReview={canReview} />
      <section className={styles.conversationPanel} aria-label="Needs attention conversations">
        <div className={styles.conversationHeading}>
          <h2>Needs attention</h2>
          <span>{filteredItems.length} {filteredItems.length === 1 ? "conversation" : "conversations"}</span>
        </div>
        <ReplyAssistantClient
          initialItems={initialItems.filter((item) => channelScope === "all" || item.channel === channelScope)}
          liveItems={filteredItems}
          newInboxIds={newInboxIds}
          onRefresh={() => { void refresh(); }}
          selectedReviewSelector={selectedReviewSelector}
          channelScope={channelScope}
        />
      </section>
    </div>
  );
}
