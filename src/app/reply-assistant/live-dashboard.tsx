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

const aucklandParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const weekdays = [
  { day: 1 as const, name: "Monday" },
  { day: 2 as const, name: "Tuesday" },
  { day: 3 as const, name: "Wednesday" },
  { day: 4 as const, name: "Thursday" },
  { day: 5 as const, name: "Friday" },
  { day: 6 as const, name: "Saturday" },
  { day: 0 as const, name: "Sunday" },
] as const;

function normalMode(mode: AiControlConfig["mode"]) {
  return mode[0] + mode.slice(1).toLowerCase();
}

function formatSchedulePeriod(period: AiControlConfig["periods"][number]) {
  const day = weekdays.find((entry) => entry.day === period.day)?.name ?? "Unknown day";
  return `${day} — AI ON: ${period.start === "00:00" && period.end === "23:59" ? "All day" : `${period.start}–${period.end}`}`;
}

function aucklandClockParts(value: Date) {
  const parts = Object.fromEntries(aucklandParts.formatToParts(value).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function buildAucklandOverrideExpiry(date: string, time: string, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;
  const requested = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (requested.month < 1 || requested.month > 12 || requested.day < 1 || requested.day > 31 || requested.hour > 23 || requested.minute > 59) return null;

  const localEpoch = Date.UTC(requested.year, requested.month - 1, requested.day, requested.hour, requested.minute);
  let epoch = localEpoch;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rendered = aucklandClockParts(new Date(epoch));
    epoch = localEpoch - (Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute) - epoch);
  }
  const expiresAt = new Date(epoch);
  const rendered = aucklandClockParts(expiresAt);
  if (!Number.isFinite(expiresAt.getTime())
    || rendered.year !== requested.year
    || rendered.month !== requested.month
    || rendered.day !== requested.day
    || rendered.hour !== requested.hour
    || rendered.minute !== requested.minute
    || expiresAt.getTime() <= now.getTime()
    || expiresAt.getTime() > now.getTime() + 24 * 60 * 60 * 1_000) return null;
  return expiresAt.toISOString();
}

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
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideTime, setOverrideTime] = useState("");
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

  const setTemporaryOverride = useCallback((state: "ON" | "OFF") => {
    const expiresAt = buildAucklandOverrideExpiry(overrideDate, overrideTime);
    if (!expiresAt) {
      setControlError("Choose a future Pacific/Auckland date and time within 24 hours.");
      return;
    }
    void saveAiControl({ override: { state, expiresAt } });
  }, [overrideDate, overrideTime, saveAiControl]);

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
          <strong data-state={aiControl.effective.effectiveState}>AI is {aiControl.effective.effectiveState}</strong>
        </div>
        {!aiControl.available ? <p className={styles.controlWarning}>Runtime store unavailable — effective state is OFF.</p> : null}
        <section className={styles.currentStatus} aria-label="Current AI status">
          <h3>Current status</h3>
          {aiControl.effective.source === "master_kill" ? <>
            <p><strong>Reason:</strong> Master AI switch is disabled</p>
            <p><strong>Normal mode:</strong> {normalMode(aiControl.config.mode)}</p>
            <p><strong>Next scheduled transition:</strong> Paused until Master AI is enabled</p>
          </> : aiControl.effective.source === "override" ? <>
            <p>Temporary override until {formatAiDateTime(aiControl.effective.nextTransitionAt)}</p>
            <p><strong>Normal mode:</strong> {normalMode(aiControl.config.mode)}</p>
          </> : <>
            <p><strong>Normal mode:</strong> {normalMode(aiControl.config.mode)}</p>
            {aiControl.config.mode === "SCHEDULE" ? <p><strong>Next change:</strong> {formatAiDateTime(aiControl.effective.nextTransitionAt)}</p> : null}
          </>}
        </section>
        <div className={styles.controlActions}>
          <span>AI operating mode</span>
          {(["ON", "OFF", "SCHEDULE"] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={aiControl.config.mode === mode} disabled={!aiControl.available || controlBusy || aiControl.config.mode === mode} onClick={() => void saveAiControl({ mode })}>{mode}</button>
          ))}
          <button type="button" disabled={controlBusy} onClick={() => void refreshAiControl()}>Refresh control</button>
        </div>
        <p className={styles.scheduleExplanation}>AI will be ON during the scheduled periods below.</p>
        <div className={styles.scheduleEditor}>
          <label>Day<select value={scheduleDraft.day} disabled={!aiControl.available || controlBusy} onChange={(event) => setScheduleDraft((current) => ({ ...current, day: Number(event.target.value) }))}>
            {weekdays.map(({ day, name }) => <option key={name} value={day}>{name}</option>)}
          </select></label>
          <label>Start<input type="time" value={scheduleDraft.start} disabled={!aiControl.available || controlBusy} onChange={(event) => setScheduleDraft((current) => ({ ...current, start: event.target.value }))} /></label>
          <label>End<input type="time" value={scheduleDraft.end} disabled={!aiControl.available || controlBusy} onChange={(event) => setScheduleDraft((current) => ({ ...current, end: event.target.value }))} /></label>
          <button type="button" disabled={!aiControl.available || controlBusy || scheduleDraft.start === scheduleDraft.end} onClick={() => void saveAiControl({
            mode: "SCHEDULE",
            periods: [...aiControl.config.periods, { ...scheduleDraft, day: scheduleDraft.day as 0 | 1 | 2 | 3 | 4 | 5 | 6 }],
          })}>Add schedule period</button>
        </div>
        {aiControl.config.periods.length ? <ul className={styles.scheduleList} aria-label="Scheduled AI ON periods">{aiControl.config.periods.map((period, index) => ({ period, index })).sort((left, right) => {
          const leftOrder = left.period.day === 0 ? 7 : left.period.day;
          const rightOrder = right.period.day === 0 ? 7 : right.period.day;
          return leftOrder - rightOrder || left.period.start.localeCompare(right.period.start);
        }).map(({ period, index }) => (
          <li key={`${period.day}-${period.start}-${period.end}-${index}`}><span>{formatSchedulePeriod(period)}</span><button type="button" disabled={controlBusy} onClick={() => void saveAiControl({ periods: aiControl.config.periods.filter((_, current) => current !== index) })}>Remove</button></li>
        ))}</ul> : null}
        <div className={styles.overrideControls}>
          <div className={styles.overrideHeading}><strong>Temporary override</strong><span>Timezone: Pacific/Auckland</span></div>
          <label>Override date<input type="date" value={overrideDate} disabled={!aiControl.available || controlBusy} onChange={(event) => setOverrideDate(event.target.value)} /></label>
          <label>Override time<input type="time" value={overrideTime} disabled={!aiControl.available || controlBusy} onChange={(event) => setOverrideTime(event.target.value)} /></label>
          <button type="button" disabled={!aiControl.available || controlBusy} onClick={() => setTemporaryOverride("ON")}>Turn AI ON temporarily</button>
          <button type="button" disabled={!aiControl.available || controlBusy} onClick={() => setTemporaryOverride("OFF")}>Turn AI OFF temporarily</button>
          {aiControl.config.override ? <button type="button" disabled={controlBusy} onClick={() => void saveAiControl({ override: null })}>Cancel override</button> : null}
        </div>
        {aiControl.config.override ? <p className={styles.controlNotice}>Temporary override: AI {aiControl.config.override.state}. Until: {formatAiDateTime(aiControl.config.override.expiresAt)}</p> : null}
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
