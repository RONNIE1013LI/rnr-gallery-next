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
import type { AiControlConfig } from "@/server/rnr-ai/control/types";
import type { EffectiveAiControl } from "@/server/rnr-ai/control/schedule";
import styles from "./reply-assistant.module.css";

type LiveUpdateResponse = Readonly<{
  cursor: string;
  hasMore: boolean;
  queueItems: readonly ReplyQueueItem[];
  metrics: PilotMetricCounts | null;
  learningCandidates: ReplyAssistantLearningCandidatePage | null;
  caseMemories: ReplyAssistantCaseMemoryPage | null;
}>;

export type AiControlView = Readonly<{
  available: boolean;
  config: AiControlConfig;
  effective: EffectiveAiControl;
}>;

type MetaReviewMetadata = Readonly<{
  reviewKey: string;
  conversationKey: string;
  risk: "YELLOW" | "RED";
  createdAt: string;
  expiresAt: string;
}>;

type MetaReviewDetail = MetaReviewMetadata & Readonly<{
  replyText: string | null;
  reasons: readonly string[];
}>;

const unavailableAiControl: AiControlView = {
  available: false,
  config: { revision: 0, mode: "OFF", timezone: "Pacific/Auckland", periods: [], override: null },
  effective: { effectiveState: "OFF", source: "invalid", nextTransitionAt: null },
};

const aiDateTime = new Intl.DateTimeFormat("en-NZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Pacific/Auckland",
});

function formatAiDateTime(value: string | null) {
  return value ? aiDateTime.format(new Date(value)) : "None";
}

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
  initialAiControl = unavailableAiControl,
}: Readonly<{
  initialCursor: string;
  initialItems: readonly ReplyQueueItem[];
  initialMetricCards: readonly ReplyAssistantMetricCard[];
  initialMetrics?: PilotMetricCounts;
  initialLearningCandidates: readonly LearningCandidateView[];
  initialCaseMemories: readonly CaseMemoryView[];
  canReview: boolean;
  selectedReviewSelector?: string | null;
  initialAiControl?: AiControlView;
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
  const [aiControl, setAiControl] = useState(initialAiControl);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [overrideExpiresAt, setOverrideExpiresAt] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState({ day: 1, start: "09:00", end: "17:00" });
  const [metaReviews, setMetaReviews] = useState<readonly MetaReviewMetadata[]>([]);
  const [selectedMetaReview, setSelectedMetaReview] = useState<MetaReviewDetail | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "failed">("idle");
  const cursorRef = useRef(initialCursor);
  const itemsRef = useRef(initialItems);
  const activeControllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => { itemsRef.current = items; }, [items]);

  const refreshAiControl = useCallback(async () => {
    setControlBusy(true);
    setControlError(null);
    try {
      const response = await fetch("/api/reply-assistant/control", { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("control_read_failed");
      const body = await response.json() as Omit<AiControlView, "available">;
      setAiControl({ ...body, available: true });
    } catch {
      setAiControl(unavailableAiControl);
      setControlError("Runtime store unavailable — effective state is OFF.");
    } finally {
      setControlBusy(false);
    }
  }, []);

  const saveAiControl = useCallback(async (input: Readonly<{
    mode?: AiControlConfig["mode"];
    periods?: AiControlConfig["periods"];
    override?: Readonly<{ state: "ON" | "OFF"; expiresAt: string }> | null;
  }>) => {
    setControlBusy(true);
    setControlError(null);
    try {
      const response = await fetch("/api/reply-assistant/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: aiControl.config.revision,
          mode: input.mode ?? aiControl.config.mode,
          periods: input.periods ?? aiControl.config.periods,
          override: input.override === undefined
            ? aiControl.config.override && { state: aiControl.config.override.state, expiresAt: aiControl.config.override.expiresAt }
            : input.override,
        }),
      });
      if (response.status === 409) {
        setControlError("Control changed elsewhere. Refresh control before retrying.");
        return;
      }
      if (!response.ok) throw new Error("control_write_failed");
      const body = await response.json() as Omit<AiControlView, "available">;
      setAiControl({ ...body, available: true });
    } catch {
      setControlError("AI control was not changed. Refresh and try again.");
    } finally {
      setControlBusy(false);
    }
  }, [aiControl]);

  const forceState = useCallback((state: "ON" | "OFF") => {
    const expiresAt = overrideExpiresAt.trim();
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
      setControlError("Enter an exact ISO 8601 override expiry.");
      return;
    }
    if (!window.confirm(`Force AI ${state} until exactly ${expiresAt}?`)) return;
    void saveAiControl({ override: { state, expiresAt } });
  }, [overrideExpiresAt, saveAiControl]);

  const refreshMetaReviews = useCallback(async () => {
    setReviewState("loading");
    setSelectedMetaReview(null);
    try {
      const response = await fetch("/api/reply-assistant/meta-reviews", { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("review_list_failed");
      setMetaReviews(((await response.json()) as { reviews: readonly MetaReviewMetadata[] }).reviews);
      setReviewState("idle");
    } catch {
      setReviewState("failed");
    }
  }, []);

  const openMetaReview = useCallback(async (reviewKey: string) => {
    setReviewState("loading");
    try {
      const response = await fetch(`/api/reply-assistant/meta-reviews/${encodeURIComponent(reviewKey)}`, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("review_detail_failed");
      setSelectedMetaReview(await response.json() as MetaReviewDetail);
      setReviewState("idle");
    } catch {
      setReviewState("failed");
    }
  }, []);

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
      <section className={styles.aiControlPanel} aria-label="AI control">
        <div className={styles.controlHeader}>
          <div><p>Shared R&amp;R AI Brain</p><h2>AI control</h2></div>
          <strong data-state={aiControl.effective.effectiveState}>{aiControl.effective.effectiveState}</strong>
        </div>
        {!aiControl.available ? <p className={styles.controlWarning}>Runtime store unavailable — effective state is OFF.</p> : null}
        <dl className={styles.controlFacts}>
          <div><dt>Configured mode</dt><dd>{aiControl.config.mode}</dd></div>
          <div><dt>Timezone</dt><dd>{aiControl.config.timezone}</dd></div>
          <div><dt>Source</dt><dd>{aiControl.effective.source.replaceAll("_", " ")}</dd></div>
          <div><dt>Next transition</dt><dd>{formatAiDateTime(aiControl.effective.nextTransitionAt)}</dd></div>
        </dl>
        <div className={styles.controlActions}>
          {(["ON", "OFF", "SCHEDULE"] as const).map((mode) => (
            <button key={mode} type="button" disabled={!aiControl.available || controlBusy || aiControl.config.mode === mode} onClick={() => void saveAiControl({ mode })}>Set {mode}</button>
          ))}
          <button type="button" disabled={controlBusy} onClick={() => void refreshAiControl()}>Refresh control</button>
        </div>
        <div className={styles.scheduleEditor}>
          <label>Day<select value={scheduleDraft.day} disabled={!aiControl.available || controlBusy} onChange={(event) => setScheduleDraft((current) => ({ ...current, day: Number(event.target.value) }))}>
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select></label>
          <label>Start<input type="time" value={scheduleDraft.start} disabled={!aiControl.available || controlBusy} onChange={(event) => setScheduleDraft((current) => ({ ...current, start: event.target.value }))} /></label>
          <label>End<input type="time" value={scheduleDraft.end} disabled={!aiControl.available || controlBusy} onChange={(event) => setScheduleDraft((current) => ({ ...current, end: event.target.value }))} /></label>
          <button type="button" disabled={!aiControl.available || controlBusy || scheduleDraft.start === scheduleDraft.end} onClick={() => void saveAiControl({
            mode: "SCHEDULE",
            periods: [...aiControl.config.periods, { ...scheduleDraft, day: scheduleDraft.day as 0 | 1 | 2 | 3 | 4 | 5 | 6 }],
          })}>Add schedule period</button>
        </div>
        {aiControl.config.periods.length ? <ul className={styles.scheduleList}>{aiControl.config.periods.map((period, index) => (
          <li key={`${period.day}-${period.start}-${period.end}-${index}`}><span>Day {period.day}, {period.start}–{period.end}</span><button type="button" disabled={controlBusy} onClick={() => void saveAiControl({ periods: aiControl.config.periods.filter((_, current) => current !== index) })}>Remove</button></li>
        ))}</ul> : null}
        <div className={styles.overrideControls}>
          <label>Override expiry (ISO 8601)<input value={overrideExpiresAt} placeholder="2026-09-05T00:00:00+12:00" onChange={(event) => setOverrideExpiresAt(event.target.value)} /></label>
          <button type="button" disabled={!aiControl.available || controlBusy} onClick={() => forceState("ON")}>Force ON</button>
          <button type="button" disabled={!aiControl.available || controlBusy} onClick={() => forceState("OFF")}>Force OFF</button>
          {aiControl.config.override ? <button type="button" disabled={controlBusy} onClick={() => void saveAiControl({ override: null })}>Clear override</button> : null}
        </div>
        {aiControl.config.override ? <p className={styles.controlNotice}>Override {aiControl.config.override.state} expires {formatAiDateTime(aiControl.config.override.expiresAt)}.</p> : null}
        {controlError ? <p className={styles.controlError} role="alert">{controlError}</p> : null}
      </section>
      <section className={styles.metaReviewPanel} aria-label="Meta human reviews">
        <div className={styles.controlHeader}><div><p>Encrypted, 48-hour retention</p><h2>Meta human reviews</h2></div><button type="button" disabled={reviewState === "loading"} onClick={() => void refreshMetaReviews()}>Refresh Meta reviews</button></div>
        {reviewState === "failed" ? <p className={styles.controlError} role="alert">Meta reviews could not be loaded.</p> : null}
        {metaReviews.length === 0 ? <p className={styles.empty}>No Meta reviews loaded.</p> : (
          <ul className={styles.metaReviewList}>{metaReviews.map((review, index) => <li key={review.reviewKey}>
            <div><strong>{review.risk}</strong><span>Review {index + 1} · expires {formatAiDateTime(review.expiresAt)}</span></div>
            <button type="button" aria-label="Open protected review" disabled={reviewState === "loading"} onClick={() => void openMetaReview(review.reviewKey)}>Open</button>
          </li>)}</ul>
        )}
        {selectedMetaReview ? <article className={styles.metaReviewDetail}>
          <strong>{selectedMetaReview.risk} review</strong>
          <p>{selectedMetaReview.replyText ?? "No proposed reply is available."}</p>
          <ul>{selectedMetaReview.reasons.map((reason) => <li key={reason}>{reason.replaceAll("_", " ")}</li>)}</ul>
        </article> : null}
      </section>
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
