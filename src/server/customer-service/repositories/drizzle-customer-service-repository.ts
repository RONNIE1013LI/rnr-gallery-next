import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceWebsiteBudgetState,
  customerServiceCaseMemories,
  customerServiceCaseRetrievals,
  customerServiceConversationEvents,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceHumanReplyMatches,
  customerServiceHumanReplyMatchEvents,
  customerServiceHumanReviews,
  customerServiceReviewAlertOutbox,
  customerServiceReviewSelectors,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
  customerServiceLearningCandidates,
  customerServiceMessages,
  customerServicePilotRuns,
  customerServiceRateLimitBuckets,
  customerServiceRetentionHolds,
  customerServiceTurns,
  customerServiceUiChanges,
  customerServiceUiRevision,
  customerServiceWebSessions,
  customerServiceWebsiteAssistantMessages,
  customerServiceWebsiteMetricEvents,
} from "@/server/db/schema";
import type {
  CustomerServiceRepository,
  ChannelMetricCounts,
  FeedbackEventInput,
  GateBlockedAttemptInput,
  HashedIncomingMessage,
  HashedConversationEvent,
  ProviderAttemptCompletion,
  ProviderAttemptReservation,
  SafeQueuePage,
} from "./customer-service-repository";
import { parseImageAnalysisResult } from "../image-analysis-schema";
import { IMAGE_LIMITS } from "../attachments/limits";
import { classifyAcknowledgement } from "../conversation/acknowledgement";
import { canAppendHumanReply } from "../conversation/human-reply-grouping";
import { chooseHumanReplyTurn } from "../learning/human-reply-matcher";
import { classifyHumanEdit } from "../learning/edit-classifier";
import { assessCaseMemoryEligibility } from "../learning/case-memory";
import { sanitizeCaseMemoryText } from "../learning/case-memory-sanitizer";
import { scoreCaseMemory } from "../learning/case-retrieval";
import { buildLearningSummary } from "../learning/learning-summary";
import { localDateScopeKey } from "../usage-cost";
import {
  websiteHumanReviewResponse,
  type WebsiteHumanReviewReason,
} from "../website/human-review";
import { sanitizeWebsiteModelInput } from "../website/model-input-sanitizer";
import {
  createWebsiteReviewSelectorRecord,
  verifyWebsiteReviewSelector,
} from "../website/review-selector";
import { REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS } from "../website/review-alert-policy";
import { verifyWebsiteRendererProof } from "../website/structured-decision";
import type {
  WebsitePublicUpdateCursor,
  WebsitePublicUpdateRecord,
} from "../website/public-updates";
import { enqueueInternalNotifications } from "@/server/notifications/drizzle-internal-notification-outbox-repository";
import {
  createReplyAssistantUpdateReader,
  encodeReplyAssistantCursor,
} from "../live-updates";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const WEBSITE_RATE_LIMITS = Object.freeze({
  sessionMinute: 5,
  sessionHour: 30,
  sessionTotal: 100,
  networkMinute: 10,
  networkHour: 60,
});
const WEBSITE_CHAT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const WEBSITE_RATE_BUCKET_MAX_MS = 24 * 60 * 60 * 1_000;
const RETENTION_REDACTION = "[expired website chat]";

function channelMetricCountsSql(channel: "facebook" | "website") {
  return sql`jsonb_build_object(
    'sessions', case when ${channel} = 'website'
      then (select count(*) from customer_service_web_sessions)
      else (select count(*) from customer_service_conversations where channel = 'facebook') end,
    'meaningfulTurns', (select count(*) from customer_service_turns
      where channel = ${channel}
        and status <> 'open'
        and suppression_reason is distinct from 'completed_acknowledgement'),
    'responses', (
      select count(*) from customer_service_conversation_events
      where channel = ${channel} and role = 'staff' and event_type = 'human_outbound'
    ) + case when ${channel} = 'website'
      then (select count(*) from customer_service_website_assistant_messages)
      else 0 end,
    'directTemplateReplies', case when ${channel} = 'website'
      then (select count(*) from customer_service_turns turns
        where turns.channel = 'website'
          and turns.status <> 'open'
          and turns.suppression_reason is distinct from 'completed_acknowledgement'
          and exists (
            select 1 from customer_service_website_assistant_messages replies
            where replies.turn_id = turns.id and replies.kind = 'validated_ai'
          ))
      else 0 end,
    'noReply', case when ${channel} = 'website'
      then (select count(*) from customer_service_turns turns
        where turns.channel = 'website'
          and turns.status <> 'open'
          and turns.suppression_reason is distinct from 'completed_acknowledgement'
          and not exists (
            select 1 from customer_service_website_assistant_messages replies
            where replies.turn_id = turns.id and replies.kind = 'validated_ai'
          )
          and exists (
            select 1 from customer_service_ai_attempts attempts
            where attempts.message_id = turns.representative_message_id
              and attempts.provider_error_code = 'website_no_reply_needed'
          ))
      else 0 end,
    'humanReviewsOpened', case when ${channel} = 'website'
      then (select count(*) from customer_service_human_reviews) else 0 end,
    'humanReviewsResolved', case when ${channel} = 'website'
      then (select count(*) from customer_service_human_reviews where status = 'resolved') else 0 end,
    'alertsQueued', case when ${channel} = 'website'
      then (select count(*) from customer_service_review_alert_outbox) else 0 end,
    'alertsDeduplicated', case when ${channel} = 'website'
      then (select coalesce(sum(deduplicated_count), 0) from customer_service_review_alert_outbox) else 0 end,
    'alertsSent', case when ${channel} = 'website'
      then (select count(*) from customer_service_review_alert_outbox where status = 'sent') else 0 end,
    'alertsFailed', case when ${channel} = 'website'
      then (select count(*) from customer_service_review_alert_outbox where status = 'failed') else 0 end,
    'websiteHumanReplies', case when ${channel} = 'website'
      then (select count(*) from customer_service_conversation_events
        where channel = 'website' and role = 'staff' and event_type = 'human_outbound') else 0 end,
    'rateBlocks', case when ${channel} = 'website'
      then (select count(*) from customer_service_website_metric_events where event_type = 'rate_block') else 0 end,
    'budgetBlocks', (select count(*) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.status = 'budget_blocked'),
    'providerCalls', (select count(*) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.provider_called),
    'inputTokens', (select coalesce(sum(attempts.input_tokens), 0) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.provider_called),
    'cachedInputTokens', (select coalesce(sum(attempts.cached_input_tokens), 0) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.provider_called),
    'outputTokens', (select coalesce(sum(attempts.output_tokens), 0) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.provider_called),
    'totalCostMicrousd', (select coalesce(sum(attempts.estimated_cost_microusd), 0) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.provider_called),
    'totalLatencyMs', (select coalesce(sum(attempts.latency_ms), 0) from customer_service_ai_attempts attempts
      join customer_service_messages messages on messages.id = attempts.message_id
      where messages.channel = ${channel} and attempts.provider_called),
    'publicUpdates', case when ${channel} = 'website'
      then (select count(*) from customer_service_website_assistant_messages) else 0 end,
    'totalPublicUpdateLatencyMs', case when ${channel} = 'website' then (
      select coalesce(sum(greatest(0, extract(epoch from (published.published_at - messages.received_at)) * 1000)), 0)
      from customer_service_website_assistant_messages published
      join customer_service_messages messages on messages.id = published.message_id
    ) else 0 end,
    'automaticBusinessActions', 0,
    'automaticSends', 0
  )`;
}

function parseChannelMetricCounts(value: unknown): ChannelMetricCounts {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (name: keyof ChannelMetricCounts) => Number(row[name] ?? 0);
  return Object.freeze({
    sessions: count("sessions"),
    meaningfulTurns: count("meaningfulTurns"),
    responses: count("responses"),
    directTemplateReplies: count("directTemplateReplies"),
    noReply: count("noReply"),
    humanReviewsOpened: count("humanReviewsOpened"),
    humanReviewsResolved: count("humanReviewsResolved"),
    alertsQueued: count("alertsQueued"),
    alertsDeduplicated: count("alertsDeduplicated"),
    alertsSent: count("alertsSent"),
    alertsFailed: count("alertsFailed"),
    websiteHumanReplies: count("websiteHumanReplies"),
    rateBlocks: count("rateBlocks"),
    budgetBlocks: count("budgetBlocks"),
    providerCalls: count("providerCalls"),
    inputTokens: count("inputTokens"),
    cachedInputTokens: count("cachedInputTokens"),
    outputTokens: count("outputTokens"),
    totalCostMicrousd: count("totalCostMicrousd"),
    totalLatencyMs: count("totalLatencyMs"),
    publicUpdates: count("publicUpdates"),
    totalPublicUpdateLatencyMs: count("totalPublicUpdateLatencyMs"),
    crossSessionIsolation: "test_only_invariant",
    automaticBusinessActions: 0,
    automaticSends: 0,
  });
}

function isHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

function startOfUtcMinute(value: Date) {
  return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}

function startOfUtcHour(value: Date) {
  return new Date(Math.floor(value.getTime() / 3_600_000) * 3_600_000);
}

function websiteBudgetScopeKeys(dailyScopeKey: string, website: boolean) {
  if (!website) return [] as const;
  const date = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(dailyScopeKey)?.[1];
  if (!date) throw new Error("customer_service_budget_daily_scope_invalid");
  return [`daily:website:${date}`, "total:website"] as const;
}

function websitePublicUpdateAfter(
  createdAt: typeof customerServiceConversationEvents.createdAt | typeof customerServiceWebsiteAssistantMessages.publishedAt,
  id: typeof customerServiceConversationEvents.id | typeof customerServiceWebsiteAssistantMessages.id,
  source: WebsitePublicUpdateRecord["source"],
  after: WebsitePublicUpdateCursor | null,
) {
  if (!after) return undefined;
  const orderingTimestamp = sql`${after.orderingKey}::timestamptz`;
  const sourceOrder = source === "event" ? 0 : 1;
  const afterSourceOrder = after.source === "event" ? 0 : 1;
  if (sourceOrder < afterSourceOrder) return gt(createdAt, orderingTimestamp);
  if (sourceOrder > afterSourceOrder) return or(gt(createdAt, orderingTimestamp), eq(createdAt, orderingTimestamp));
  return or(
    gt(createdAt, orderingTimestamp),
    and(eq(createdAt, orderingTimestamp), gt(id, after.id)),
  );
}

function websiteReviewReason(
  outcome: Parameters<CustomerServiceRepository["openWebsiteHumanReview"]>[0]["outcome"],
  gateResult: string | null,
): WebsiteHumanReviewReason {
  if (outcome === "gate_blocked") {
    if (gateResult === "high_risk" || gateResult === "unresolved" || gateResult === "realtime_required") {
      return gateResult;
    }
    return "unresolved";
  }
  if (outcome === "realtime_required") return "realtime_required";
  if (outcome === "budget_blocked") return "budget_blocked";
  if (outcome === "provider_error") return "provider_error";
  if (outcome === "output_blocked") return "output_blocked";
  return "system_failure";
}

function redactedWebsiteReviewSummary(body: string) {
  const sanitized = sanitizeWebsiteModelInput(body).text;
  return (sanitized || "[Customer message removed]").slice(0, 160);
}

async function consumeWebsiteRateLimits(
  transaction: Transaction,
  input: NonNullable<HashedConversationEvent["websiteRateLimit"]>,
  now: Date,
) {
  if (!isHash(input.sessionKeyHash) || !isHash(input.networkKeyHash) || input.sessionExpiresAt <= now) {
    throw new Error("website_rate_limit_identity_invalid");
  }
  const minute = startOfUtcMinute(now);
  const hour = startOfUtcHour(now);
  const sessionStartedAt = new Date(input.sessionExpiresAt.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const sessionWindowStartedAt = new Date(
    sessionStartedAt.getTime()
      + Math.floor((now.getTime() - sessionStartedAt.getTime()) / WEBSITE_RATE_BUCKET_MAX_MS)
      * WEBSITE_RATE_BUCKET_MAX_MS,
  );
  const sessionWindowExpiresAt = new Date(Math.min(
    sessionWindowStartedAt.getTime() + WEBSITE_RATE_BUCKET_MAX_MS,
    input.sessionExpiresAt.getTime(),
  ));
  const networkBuckets = [
    { kind: "network_hour" as const, key: input.networkKeyHash, window: hour, expiresAt: new Date(hour.getTime() + 3_600_000), limit: WEBSITE_RATE_LIMITS.networkHour },
    { kind: "network_minute" as const, key: input.networkKeyHash, window: minute, expiresAt: new Date(minute.getTime() + 60_000), limit: WEBSITE_RATE_LIMITS.networkMinute },
  ];
  const sessionBuckets = [
    { kind: "session_hour" as const, key: input.sessionKeyHash, window: hour, expiresAt: new Date(hour.getTime() + 3_600_000), limit: WEBSITE_RATE_LIMITS.sessionHour },
    { kind: "session_minute" as const, key: input.sessionKeyHash, window: minute, expiresAt: new Date(minute.getTime() + 60_000), limit: WEBSITE_RATE_LIMITS.sessionMinute },
    { kind: "session_total" as const, key: input.sessionKeyHash, window: sessionWindowStartedAt, expiresAt: sessionWindowExpiresAt, limit: WEBSITE_RATE_LIMITS.sessionTotal },
  ];

  const consume = async (buckets: typeof networkBuckets | typeof sessionBuckets) => {
    let allowed = true;
    for (const bucket of [...buckets].sort((left, right) => `${left.kind}:${left.key}`.localeCompare(`${right.kind}:${right.key}`))) {
      if (
        bucket.expiresAt <= bucket.window
        || bucket.expiresAt.getTime() - bucket.window.getTime() > WEBSITE_RATE_BUCKET_MAX_MS
      ) throw new Error("website_rate_limit_window_invalid");
      const result = await transaction.execute(sql`
        insert into ${customerServiceRateLimitBuckets} (
          bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count
        ) values (${bucket.kind}, ${bucket.key}, ${bucket.window}, ${bucket.expiresAt}, 1)
        on conflict (bucket_kind, bucket_key_hash, window_started_at) do update
          set request_count = ${customerServiceRateLimitBuckets.requestCount} + 1,
              updated_at = now()
          where ${customerServiceRateLimitBuckets.requestCount} < ${bucket.limit}
        returning id
      `);
      if (!result.rows.length) allowed = false;
    }
    return allowed;
  };
  const networkAllowed = await consume(networkBuckets);
  if (!networkAllowed && input.isNewSession) return false;
  return (await consume(sessionBuckets)) && networkAllowed;
}

async function recordWebsiteRateBlock(
  transaction: Transaction,
  eventKeyHash: string,
  occurredAt: Date,
) {
  await transaction.insert(customerServiceWebsiteMetricEvents).values({
    eventType: "rate_block",
    eventKeyHash,
    occurredAt,
    expiresAt: new Date(occurredAt.getTime() + 24 * 60 * 60 * 1_000),
  }).onConflictDoNothing();
}

async function nextAttemptNumber(transaction: Transaction, messageId: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${messageId}))`);
  const [row] = await transaction.select({ value: max(customerServiceAiAttempts.attemptNumber) })
    .from(customerServiceAiAttempts)
    .where(eq(customerServiceAiAttempts.messageId, messageId));
  return (row?.value ?? 0) + 1;
}

async function nextImageAttemptNumber(transaction: Transaction, messageId: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'image:' + messageId}))`);
  const [row] = await transaction.select({ value: max(customerServiceImageAnalysisAttempts.attemptNumber) })
    .from(customerServiceImageAnalysisAttempts)
    .where(eq(customerServiceImageAnalysisAttempts.messageId, messageId));
  return (row?.value ?? 0) + 1;
}

async function insertGateAttempt(transaction: Transaction, input: GateBlockedAttemptInput) {
  const [attempt] = await transaction.insert(customerServiceAiAttempts).values({
    messageId: input.messageId,
    attemptNumber: await nextAttemptNumber(transaction, input.messageId),
    trigger: input.trigger,
    intent: input.intent,
    riskLevel: input.riskLevel,
    gateResult: input.gateResult,
    gateReasons: input.gateReasons,
    knowledgeVersion: input.knowledgeVersion,
    status: "gate_blocked",
    providerCalled: false,
    completedAt: new Date(),
  }).returning({ id: customerServiceAiAttempts.id });
  await transaction.update(customerServiceMessages)
    .set({ ingestStatus: "blocked" })
    .where(eq(customerServiceMessages.id, input.messageId));
  return attempt.id;
}

async function ensureBudgetRows(transaction: Transaction, keys: readonly string[]) {
  await transaction.insert(customerServiceBudgetState)
    .values(keys.map((scopeKey) => ({ scopeKey })))
    .onConflictDoNothing();
  return transaction.select().from(customerServiceBudgetState)
    .where(sql`${customerServiceBudgetState.scopeKey} in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})`)
    .orderBy(asc(customerServiceBudgetState.scopeKey))
    .for("update");
}

async function ensureWebsiteBudgetRows(transaction: Transaction, keys: readonly string[]) {
  await transaction.insert(customerServiceWebsiteBudgetState)
    .values(keys.map((scopeKey) => ({ scopeKey })))
    .onConflictDoNothing();
  return transaction.select().from(customerServiceWebsiteBudgetState)
    .where(sql`${customerServiceWebsiteBudgetState.scopeKey} in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})`)
    .orderBy(asc(customerServiceWebsiteBudgetState.scopeKey))
    .for("update");
}

async function releaseProviderBudget(
  transaction: Transaction,
  dailyScopeKey: string,
  channel: "facebook" | "website",
  reserved: number,
) {
  await ensureBudgetRows(transaction, [dailyScopeKey, "total"].sort());
  await transaction.update(customerServiceBudgetState).set({
    reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${reserved})`,
  }).where(sql`${customerServiceBudgetState.scopeKey} in (${dailyScopeKey}, 'total')`);
  if (channel === "website") {
    const websiteKeys = websiteBudgetScopeKeys(dailyScopeKey, true);
    await ensureWebsiteBudgetRows(transaction, [...websiteKeys].sort());
    await transaction.update(customerServiceWebsiteBudgetState).set({
      reservedMicrousd: sql`greatest(0, ${customerServiceWebsiteBudgetState.reservedMicrousd} - ${reserved})`,
    }).where(sql`${customerServiceWebsiteBudgetState.scopeKey} in (${sql.join(websiteKeys.map((key) => sql`${key}`), sql`, `)})`);
  }
}

async function settleProviderBudget(
  transaction: Transaction,
  dailyScopeKey: string,
  channel: "facebook" | "website",
  reserved: number,
  settled: number,
) {
  await ensureBudgetRows(transaction, [dailyScopeKey, "total"].sort());
  await transaction.update(customerServiceBudgetState).set({
    reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${reserved})`,
    spentMicrousd: sql`${customerServiceBudgetState.spentMicrousd} + ${settled}`,
  }).where(sql`${customerServiceBudgetState.scopeKey} in (${dailyScopeKey}, 'total')`);
  if (channel === "website") {
    const websiteKeys = websiteBudgetScopeKeys(dailyScopeKey, true);
    await ensureWebsiteBudgetRows(transaction, [...websiteKeys].sort());
    await transaction.update(customerServiceWebsiteBudgetState).set({
      reservedMicrousd: sql`greatest(0, ${customerServiceWebsiteBudgetState.reservedMicrousd} - ${reserved})`,
      spentMicrousd: sql`${customerServiceWebsiteBudgetState.spentMicrousd} + ${settled}`,
    }).where(sql`${customerServiceWebsiteBudgetState.scopeKey} in (${sql.join(websiteKeys.map((key) => sql`${key}`), sql`, `)})`);
  }
}

async function validatedAnalysisSummary(
  database: Database,
  messageId: string,
  attachmentIds: readonly string[],
) {
  const assessment = await validatedImageAssessment(database, messageId, attachmentIds);
  return assessment?.status === "assessed" ? assessment.summary : null;
}

async function validatedImageAssessment(
  database: Database,
  messageId: string,
  attachmentIds: readonly string[],
) {
  const attempts = await database.select({
    id: customerServiceImageAnalysisAttempts.id,
    analysisResult: customerServiceImageAnalysisAttempts.analysisResult,
  }).from(customerServiceImageAnalysisAttempts).where(and(
    eq(customerServiceImageAnalysisAttempts.messageId, messageId),
    eq(customerServiceImageAnalysisAttempts.status, "analyzed"),
  )).orderBy(desc(customerServiceImageAnalysisAttempts.startedAt));

  for (const attempt of attempts) {
    const inputs = await database.select({
      attachmentId: customerServiceImageAnalysisInputs.attachmentId,
      ordinal: customerServiceImageAnalysisInputs.ordinal,
      cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
    }).from(customerServiceImageAnalysisInputs)
      .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attempt.id))
      .orderBy(asc(customerServiceImageAnalysisInputs.ordinal));
    if (
      inputs.length !== attachmentIds.length
      || inputs.some((input, index) => input.attachmentId !== attachmentIds[index])
      || inputs.some((input) => input.cleanupStatus !== "deleted")
    ) continue;
    try {
      const analysis = parseImageAnalysisResult(
        attempt.analysisResult,
        inputs.map((input) => input.ordinal),
      );
      return {
        status: analysis.overallStatus === "assessed" ? "assessed" as const : "human_review_required" as const,
        summary: analysis.safeSummary,
      };
    } catch {
      // Invalid historical results are never reused in a new draft.
    }
  }
  return null;
}

async function validatedQueueImageAssessments(
  database: Database,
  attachmentIdsByMessage: ReadonlyMap<string, readonly string[]>,
) {
  const messageIds = [...attachmentIdsByMessage.keys()];
  if (!messageIds.length) return new Map<string, NonNullable<Awaited<ReturnType<typeof validatedImageAssessment>>>>();
  const attempts = await database.select({
    id: customerServiceImageAnalysisAttempts.id,
    messageId: customerServiceImageAnalysisAttempts.messageId,
    attemptNumber: customerServiceImageAnalysisAttempts.attemptNumber,
    analysisResult: customerServiceImageAnalysisAttempts.analysisResult,
    startedAt: customerServiceImageAnalysisAttempts.startedAt,
  }).from(customerServiceImageAnalysisAttempts).where(and(
    inArray(customerServiceImageAnalysisAttempts.messageId, messageIds),
    eq(customerServiceImageAnalysisAttempts.status, "analyzed"),
  )).orderBy(
    desc(customerServiceImageAnalysisAttempts.startedAt),
    desc(customerServiceImageAnalysisAttempts.attemptNumber),
  );
  const inputs = attempts.length
    ? await database.select({
      attemptId: customerServiceImageAnalysisInputs.analysisAttemptId,
      attachmentId: customerServiceImageAnalysisInputs.attachmentId,
      ordinal: customerServiceImageAnalysisInputs.ordinal,
      cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
    }).from(customerServiceImageAnalysisInputs).where(inArray(
      customerServiceImageAnalysisInputs.analysisAttemptId,
      attempts.map((attempt) => attempt.id),
    )).orderBy(
      asc(customerServiceImageAnalysisInputs.analysisAttemptId),
      asc(customerServiceImageAnalysisInputs.ordinal),
    )
    : [];
  const inputsByAttempt = new Map<string, typeof inputs>();
  for (const input of inputs) {
    inputsByAttempt.set(input.attemptId, [...(inputsByAttempt.get(input.attemptId) ?? []), input]);
  }
  const attemptsByMessage = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    attemptsByMessage.set(attempt.messageId, [...(attemptsByMessage.get(attempt.messageId) ?? []), attempt]);
  }
  const assessments = new Map<string, NonNullable<Awaited<ReturnType<typeof validatedImageAssessment>>>>();
  for (const [messageId, attachmentIds] of attachmentIdsByMessage) {
    for (const attempt of attemptsByMessage.get(messageId) ?? []) {
      const inputsForAttempt = inputsByAttempt.get(attempt.id) ?? [];
      if (
        inputsForAttempt.length !== attachmentIds.length
        || inputsForAttempt.some((input, index) => input.attachmentId !== attachmentIds[index])
        || inputsForAttempt.some((input) => input.cleanupStatus !== "deleted")
      ) continue;
      try {
        const analysis = parseImageAnalysisResult(
          attempt.analysisResult,
          inputsForAttempt.map((input) => input.ordinal),
        );
        assessments.set(messageId, {
          status: analysis.overallStatus === "assessed" ? "assessed" : "human_review_required",
          summary: analysis.safeSummary,
        });
        break;
      } catch {
        // Invalid historical results are never exposed to the review queue.
      }
    }
  }
  return assessments;
}

export function createDrizzleCustomerServiceRepository(
  database: Database,
  options: Readonly<{
    reviewSelectorSecret?: string;
    now?: () => Date;
  }> = {},
): CustomerServiceRepository {
  const reviewSelectorSecret = options.reviewSelectorSecret ?? "";
  const now = options.now ?? (() => new Date());

  async function lockConversation(transaction: Transaction, conversationId: string) {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'turn:' + conversationId}))`);
  }

  function selectorRecordForReview(review: Readonly<{
    id: string;
    generation: number;
  }>, issuedAt = now()) {
    if (reviewSelectorSecret.length < 32) return null;
    const record = createWebsiteReviewSelectorRecord({
      reviewId: review.id,
      generation: review.generation,
      secret: reviewSelectorSecret,
      now: issuedAt,
    });
    return Object.freeze({
      ...record,
      selectorHash: createHash("sha256").update(record.selector).digest("hex"),
    });
  }

  function selectorForReview(review: Readonly<{ id: string; generation: number }>, issuedAt = now()) {
    return selectorRecordForReview(review, issuedAt)?.selector ?? null;
  }

  function selectorMatchesReview(selector: string, review: Readonly<{
    id: string;
    generation: number;
  }>, now: Date) {
    return reviewSelectorSecret.length >= 32 && verifyWebsiteReviewSelector({
      selector,
      reviewId: review.id,
      generation: review.generation,
      secret: reviewSelectorSecret,
      now,
    });
  }

  async function turnForMessage(transaction: Transaction, messageId: string) {
    const [turn] = await transaction.select({
      id: customerServiceTurns.id,
      conversationId: customerServiceTurns.conversationId,
      status: customerServiceTurns.status,
      lastEventAt: customerServiceTurns.lastEventAt,
      suppressionReason: customerServiceTurns.suppressionReason,
    }).from(customerServiceTurns)
      .where(eq(customerServiceTurns.representativeMessageId, messageId))
      .limit(1);
    return turn ?? null;
  }

  async function hasHumanReplyAfterTurn(transaction: Transaction, turn: Readonly<{
    conversationId: string;
    lastEventAt: Date;
  }>) {
    const [reply] = await transaction.select({ id: customerServiceConversationEvents.id })
      .from(customerServiceConversationEvents)
      .where(and(
        eq(customerServiceConversationEvents.conversationId, turn.conversationId),
        eq(customerServiceConversationEvents.eventType, "human_outbound"),
        sql`${customerServiceConversationEvents.receivedAt} >= ${turn.lastEventAt}`,
      )).limit(1);
    return Boolean(reply);
  }

  async function settleImageJobBudget(
    transaction: Transaction,
    job: Readonly<{
      id: string;
      imageAnalysisAttemptId: string | null;
      textAttemptId: string | null;
      reservedCostMicrousd: number;
      budgetDailyScopeKey: string | null;
      budgetSettledAt: Date | null;
    }>,
    textAttemptId = job.textAttemptId,
  ) {
    if (job.budgetSettledAt) return false;
    const settled = await transaction.update(customerServiceImageJobs).set({
      reservedCostMicrousd: 0,
      budgetSettledAt: new Date(),
    }).where(and(
      eq(customerServiceImageJobs.id, job.id),
      isNull(customerServiceImageJobs.budgetSettledAt),
    )).returning({ id: customerServiceImageJobs.id });
    if (!settled.length) return false;
    if (job.reservedCostMicrousd > 0) {
      if (!job.budgetDailyScopeKey) throw new Error("customer_service_image_job_reservation_invalid");
      await ensureBudgetRows(transaction, [job.budgetDailyScopeKey, "total"].sort());
      const [imageUsage] = job.imageAnalysisAttemptId
        ? await transaction.select({
          cost: customerServiceImageAnalysisAttempts.estimatedCostMicrousd,
          providerCalled: customerServiceImageAnalysisAttempts.providerCalled,
        })
          .from(customerServiceImageAnalysisAttempts)
          .where(eq(customerServiceImageAnalysisAttempts.id, job.imageAnalysisAttemptId)).limit(1)
        : [];
      const [textUsage] = textAttemptId
        ? await transaction.select({
          cost: customerServiceAiAttempts.estimatedCostMicrousd,
          providerCalled: customerServiceAiAttempts.providerCalled,
        })
          .from(customerServiceAiAttempts)
          .where(eq(customerServiceAiAttempts.id, textAttemptId)).limit(1)
        : [];
      const actualCost = (imageUsage?.cost ?? 0) + (textUsage?.cost ?? 0);
      const hasUnknownProviderCost = (imageUsage?.providerCalled && imageUsage.cost === null)
        || (textUsage?.providerCalled && textUsage.cost === null);
      const settledCost = hasUnknownProviderCost
        ? Math.max(job.reservedCostMicrousd, actualCost)
        : actualCost;
      await transaction.update(customerServiceBudgetState).set({
        reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${job.reservedCostMicrousd})`,
        spentMicrousd: sql`${customerServiceBudgetState.spentMicrousd} + ${settledCost}`,
      }).where(sql`${customerServiceBudgetState.scopeKey} in (${job.budgetDailyScopeKey}, 'total')`);
    }
    return true;
  }

  async function cleanupImageInputs(input: Readonly<{
    attemptId?: string;
    dueAt?: Date;
    now: Date;
    limit: number;
    remove(storageKey: string): Promise<void>;
  }>) {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
      throw new Error("customer_service_image_cleanup_limit_invalid");
    }
    const claimToken = randomUUID();
    const staleClaimBefore = new Date(input.now.getTime() - IMAGE_LIMITS.cleanupClaimMs);
    const claimed = await database.transaction(async (transaction) => {
      const rows = await transaction.select({
        attemptId: customerServiceImageAnalysisInputs.analysisAttemptId,
        attachmentId: customerServiceImageAnalysisInputs.attachmentId,
        privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
      }).from(customerServiceImageAnalysisInputs).where(and(
        inArray(customerServiceImageAnalysisInputs.cleanupStatus, ["pending", "stored", "failed"]),
        isNull(customerServiceImageAnalysisInputs.deletedAt),
        isNotNull(customerServiceImageAnalysisInputs.privateStorageKey),
        input.attemptId ? eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId) : undefined,
        input.dueAt ? lte(customerServiceImageAnalysisInputs.deleteDueAt, input.dueAt) : undefined,
        sql`(${customerServiceImageAnalysisInputs.cleanupClaimToken} is null or ${customerServiceImageAnalysisInputs.cleanupClaimedAt} <= ${staleClaimBefore})`,
      )).orderBy(asc(customerServiceImageAnalysisInputs.deleteDueAt))
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (!rows.length) return rows;
      for (const row of rows) {
        await transaction.update(customerServiceImageAnalysisInputs).set({
          cleanupClaimToken: claimToken,
          cleanupClaimedAt: input.now,
        }).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, row.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, row.attachmentId),
        ));
      }
      return rows;
    });

    let deleted = 0;
    let failed = 0;
    for (const item of claimed) {
      const storageKey = item.privateStorageKey;
      if (!storageKey) continue;
      let removed = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          input.remove(storageKey),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("image_cleanup_timeout")), IMAGE_LIMITS.cleanupTimeoutMs);
            timeout.unref?.();
          }),
        ]);
        removed = true;
      } catch {
        removed = false;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      const privateStorageKeyHash = createHash("sha256").update(storageKey).digest("hex");
      const updated = await database.update(customerServiceImageAnalysisInputs).set(removed ? {
        cleanupStatus: "deleted",
        privateStorageKey: null,
        privateStorageKeyHash,
        deleteDueAt: null,
        deletedAt: new Date(),
        failureCode: null,
        cleanupClaimToken: null,
        cleanupClaimedAt: null,
      } : {
        cleanupStatus: "failed",
        failureCode: "image_cleanup_failed",
        deletedAt: null,
        cleanupClaimToken: null,
        cleanupClaimedAt: null,
      }).where(and(
        eq(customerServiceImageAnalysisInputs.analysisAttemptId, item.attemptId),
        eq(customerServiceImageAnalysisInputs.attachmentId, item.attachmentId),
        eq(customerServiceImageAnalysisInputs.cleanupClaimToken, claimToken),
        eq(customerServiceImageAnalysisInputs.privateStorageKey, storageKey),
      )).returning({ attachmentId: customerServiceImageAnalysisInputs.attachmentId });
      if (updated.length) {
        if (removed) deleted += 1;
        else failed += 1;
      }
    }
    return { selected: claimed.length, deleted, failed };
  }

  async function loadQueuePage(limit: number, messageIds?: readonly string[], selectorNow = now()) {
    const latestAttempts = database.select({
      messageId: customerServiceAiAttempts.messageId,
      attemptNumber: max(customerServiceAiAttempts.attemptNumber).as("latest_attempt_number"),
    }).from(customerServiceAiAttempts)
      .groupBy(customerServiceAiAttempts.messageId)
      .as("latest_attempts");
    const eligible = sql`(
      exists (
        select 1 from customer_service_turns turns
        where turns.representative_message_id = ${customerServiceMessages.id}
          and (
            turns.status in ('sealed', 'pilot_complete')
            or (turns.status = 'suppressed' and turns.suppression_reason = 'human_outbound_received')
          )
      )
      or exists (
        select 1 from customer_service_attachments attachments
        where attachments.message_id = ${customerServiceMessages.id}
      )
      or not exists (
        select 1 from customer_service_conversation_events events
        where events.legacy_message_id = ${customerServiceMessages.id}
      )
    )`;
    const queueQuery = database.select({
      messageId: customerServiceMessages.id,
      channel: customerServiceMessages.channel,
      conversationId: customerServiceMessages.conversationId,
      body: customerServiceMessages.body,
      receivedAt: customerServiceMessages.receivedAt,
      status: customerServiceMessages.ingestStatus,
      latestAttemptId: customerServiceAiAttempts.id,
      draftText: customerServiceAiAttempts.draftText,
      gateResult: customerServiceAiAttempts.gateResult,
      humanReplyReceived: sql<boolean>`exists (
        select 1 from customer_service_turns turns
        where turns.representative_message_id = ${customerServiceMessages.id}
          and turns.status = 'suppressed'
          and turns.suppression_reason = 'human_outbound_received'
      )`,
    }).from(customerServiceMessages)
      .leftJoin(latestAttempts, eq(latestAttempts.messageId, customerServiceMessages.id))
      .leftJoin(customerServiceAiAttempts, and(
        eq(customerServiceAiAttempts.messageId, latestAttempts.messageId),
        eq(customerServiceAiAttempts.attemptNumber, latestAttempts.attemptNumber),
      ))
      .where(messageIds?.length
        ? and(inArray(customerServiceMessages.id, [...messageIds]), eligible)
        : eligible)
      .orderBy(desc(customerServiceMessages.receivedAt), desc(customerServiceMessages.id))
      .limit(Math.max(1, Math.min(500, limit)));
    const rows = await queueQuery;
    const items = rows.map((row) => ({ ...row, receivedAt: row.receivedAt.toISOString() }));
    const attachmentRows = items.length
      ? await database.select({
        messageId: customerServiceAttachments.messageId,
        attachmentId: customerServiceAttachments.id,
      }).from(customerServiceAttachments).where(inArray(
        customerServiceAttachments.messageId,
        items.map((item) => item.messageId),
      )).orderBy(asc(customerServiceAttachments.ordinal))
      : [];
    const attachmentIdsByMessage = new Map<string, string[]>();
    for (const attachment of attachmentRows) {
      attachmentIdsByMessage.set(attachment.messageId, [
        ...(attachmentIdsByMessage.get(attachment.messageId) ?? []),
        attachment.attachmentId,
      ]);
    }
    const assessments = await validatedQueueImageAssessments(database, attachmentIdsByMessage);
    const conversationIds = [...new Set(items.map((item) => item.conversationId))];
    const websiteConversationIds = [...new Set(items
      .filter((item) => item.channel === "website")
      .map((item) => item.conversationId))];
    const reviewRows = websiteConversationIds.length
      ? await database.select({
        id: customerServiceHumanReviews.id,
        conversationId: customerServiceHumanReviews.conversationId,
        generation: customerServiceHumanReviews.generation,
        reason: customerServiceHumanReviews.reason,
        alertStatus: customerServiceReviewAlertOutbox.status,
      }).from(customerServiceHumanReviews)
        .leftJoin(
          customerServiceReviewAlertOutbox,
          eq(customerServiceReviewAlertOutbox.humanReviewId, customerServiceHumanReviews.id),
        )
        .where(and(
          inArray(customerServiceHumanReviews.conversationId, websiteConversationIds),
          eq(customerServiceHumanReviews.channel, "website"),
          eq(customerServiceHumanReviews.status, "open"),
        ))
      : [];
    const selectorRecords = reviewRows.flatMap((review) => {
      const record = selectorRecordForReview(review, selectorNow);
      return record ? [{ review, record }] : [];
    });
    const persistedSelectorRecords = selectorRecords.length
      ? await database.insert(customerServiceReviewSelectors).values(selectorRecords.map(({ review, record }) => ({
        humanReviewId: review.id,
        generation: review.generation,
        selectorHash: record.selectorHash,
        expiresAt: record.expiresAt,
      }))).onConflictDoUpdate({
        target: [
          customerServiceReviewSelectors.humanReviewId,
          customerServiceReviewSelectors.generation,
          customerServiceReviewSelectors.expiresAt,
        ],
        set: { selectorHash: sql`excluded.selector_hash` },
      }).returning({
        humanReviewId: customerServiceReviewSelectors.humanReviewId,
        selectorHash: customerServiceReviewSelectors.selectorHash,
      })
      : [];
    const persistedHashByReview = new Map(persistedSelectorRecords.map((record) => [
      record.humanReviewId,
      record.selectorHash,
    ]));
    // Secret rotation must be coordinated across serving processes. The returned-row check
    // prevents this process from emitting a selector unless its current digest was persisted.
    const selectorByReview = new Map(selectorRecords.flatMap(({ review, record }) => (
      persistedHashByReview.get(review.id) === record.selectorHash
        ? [[review.id, record.selector] as const]
        : []
    )));
    const reviewByConversation = new Map(reviewRows.map((review) => [review.conversationId, review]));
    const timelineRows = conversationIds.length
      ? await database.execute<{
        conversation_id: string;
        role: "customer" | "assistant" | "staff";
        body: string;
        received_at: Date;
      }>(sql`
        select conversation_id, role, body, received_at
        from (
          select *, row_number() over (
            partition by conversation_id
            order by received_at desc, created_at desc, source_order desc, id desc
          ) as ordinal
          from (
            select
              conversation_id,
              role::text as role,
              body,
              received_at,
              created_at,
              id,
              0 as source_order
            from ${customerServiceConversationEvents}
            where ${customerServiceConversationEvents.conversationId} in (${sql.join(
              conversationIds.map((id) => sql`${id}`),
              sql`, `,
            )})
              and ${customerServiceConversationEvents.eventType} in ('customer_message', 'human_outbound')
            union all
            select
              conversation_id,
              'assistant' as role,
              body,
              published_at as received_at,
              created_at,
              id,
              1 as source_order
            from ${customerServiceWebsiteAssistantMessages}
            where ${customerServiceWebsiteAssistantMessages.conversationId} in (${sql.join(
              conversationIds.map((id) => sql`${id}`),
              sql`, `,
            )})
              and ${customerServiceWebsiteAssistantMessages.channel} = 'website'
          ) combined
        ) recent
        where ordinal <= 8
        order by conversation_id, received_at asc, created_at asc, source_order asc, id asc
      `)
      : { rows: [] as Array<{
        conversation_id: string;
        role: "customer" | "staff";
        body: string;
        received_at: Date;
      }> };
    const timelineByConversation = new Map<string, Array<{
      role: "customer" | "assistant" | "staff";
      text: string;
      receivedAt: string;
    }>>();
    for (const event of timelineRows.rows) {
      timelineByConversation.set(event.conversation_id, [
        ...(timelineByConversation.get(event.conversation_id) ?? []),
        {
          role: event.role,
          text: event.body,
          receivedAt: new Date(event.received_at).toISOString(),
        },
      ]);
    }
    return {
      items: items.map((item) => {
        const attachmentIds = attachmentIdsByMessage.get(item.messageId) ?? [];
        const assessment = assessments.get(item.messageId);
        const websiteReview = item.channel === "website"
          ? reviewByConversation.get(item.conversationId)
          : undefined;
        const selector = websiteReview ? selectorByReview.get(websiteReview.id) ?? null : null;
        const websiteReviewDto: SafeQueuePage["items"][number]["websiteReview"] = websiteReview && selector ? {
          selector,
          reason: websiteReview.reason,
          alertStatus: websiteReview.alertStatus ?? "not_created",
        } : null;
        return {
          messageId: item.messageId,
          channel: item.channel,
          body: item.body,
          receivedAt: item.receivedAt,
          status: item.status,
          latestAttemptId: item.humanReplyReceived || item.channel === "website" ? null : item.latestAttemptId,
          draftText: item.humanReplyReceived || item.channel === "website" ? null : item.draftText,
          gateResult: item.humanReplyReceived || item.channel === "website" ? null : item.gateResult,
          humanReplyReceived: item.humanReplyReceived,
          websiteReview: websiteReviewDto,
          attachmentCount: attachmentIds.length,
          imageAnalysisStatus: attachmentIds.length
            ? assessment?.status ?? "human_review_required"
            : "not_applicable" as const,
          imageAssessmentSummary: assessment?.summary ?? null,
          timeline: timelineByConversation.get(item.conversationId) ?? [],
        };
      }),
    };
  }

  const repository: CustomerServiceRepository = {
    async resolveWebsiteReviewDeepLink(input) {
      if (!isHash(input.tokenHash)) return null;
      const [review] = await database.select({
        id: customerServiceHumanReviews.id,
        generation: customerServiceHumanReviews.generation,
        messageId: customerServiceTurns.representativeMessageId,
      })
        .from(customerServiceHumanReviews)
        .innerJoin(customerServiceTurns, eq(customerServiceTurns.id, customerServiceHumanReviews.triggerTurnId))
        .where(and(
          eq(customerServiceHumanReviews.channel, "website"),
          eq(customerServiceHumanReviews.status, "open"),
          eq(customerServiceHumanReviews.deepLinkTokenHash, input.tokenHash),
          gt(customerServiceHumanReviews.deepLinkExpiresAt, input.now),
        ))
        .limit(1);
      if (!review?.messageId) return null;
      const selector = selectorForReview(review, input.now);
      if (!selector) return null;
      const item = (await loadQueuePage(1, [review.messageId], input.now)).items[0];
      if (!item || item.channel !== "website" || !item.websiteReview) return null;
      return {
        selector,
        item: {
          ...item,
          websiteReview: { ...item.websiteReview, selector },
        },
      };
    },

    async answerWebsiteReview(input) {
      const text = input.text.trim();
      if (
        !input.actorUserId.trim()
        || Array.from(text).length < 1
        || Array.from(text).length > 2_000
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
      ) return { status: "unavailable" as const };

      return database.transaction(async (transaction) => {
        const selectorHash = createHash("sha256").update(input.reviewSelector).digest("hex");
        const [candidate] = await transaction.select({
          id: customerServiceHumanReviews.id,
          conversationId: customerServiceHumanReviews.conversationId,
          generation: customerServiceHumanReviews.generation,
        }).from(customerServiceReviewSelectors)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewSelectors.humanReviewId),
          )
          .where(and(
            eq(customerServiceReviewSelectors.selectorHash, selectorHash),
            eq(customerServiceReviewSelectors.generation, customerServiceHumanReviews.generation),
            gt(customerServiceReviewSelectors.expiresAt, input.now),
          ))
          .limit(1);
        if (!candidate || !selectorMatchesReview(input.reviewSelector, candidate, input.now)) {
          return { status: "unavailable" as const };
        }

        await lockConversation(transaction, candidate.conversationId);
        const [review] = await transaction.select({
          id: customerServiceHumanReviews.id,
          conversationId: customerServiceHumanReviews.conversationId,
          generation: customerServiceHumanReviews.generation,
          triggerTurnId: customerServiceHumanReviews.triggerTurnId,
          channel: customerServiceHumanReviews.channel,
          status: customerServiceHumanReviews.status,
          resolutionEventId: customerServiceHumanReviews.resolutionEventId,
        }).from(customerServiceHumanReviews)
          .where(and(
            eq(customerServiceHumanReviews.id, candidate.id),
            eq(customerServiceHumanReviews.conversationId, candidate.conversationId),
          ))
          .limit(1)
          .for("update");
        if (
          !review
          || review.channel !== "website"
          || !selectorMatchesReview(input.reviewSelector, review, input.now)
        ) return { status: "unavailable" as const };

        if (review.status === "resolved") {
          const [existing] = review.resolutionEventId
            ? await transaction.select({
              body: customerServiceConversationEvents.body,
              channel: customerServiceConversationEvents.channel,
              role: customerServiceConversationEvents.role,
              eventType: customerServiceConversationEvents.eventType,
            }).from(customerServiceConversationEvents)
              .where(and(
                eq(customerServiceConversationEvents.id, review.resolutionEventId),
                eq(customerServiceConversationEvents.conversationId, review.conversationId),
              ))
              .limit(1)
            : [];
          return existing?.channel === "website"
            && existing.role === "staff"
            && existing.eventType === "human_outbound"
            && existing.body === text
            ? { status: "duplicate" as const }
            : { status: "unavailable" as const };
        }

        const externalMessageKeyHash = createHash("sha256")
          .update(`website-human-outbound\0${review.id}`)
          .digest("hex");
        const [event] = await transaction.insert(customerServiceConversationEvents).values({
          conversationId: review.conversationId,
          turnId: review.triggerTurnId,
          channel: "website",
          externalMessageKeyHash,
          role: "staff",
          eventType: "human_outbound",
          body: text,
          redactionCodes: [],
          learningEligible: false,
          receivedAt: input.now,
        }).onConflictDoNothing().returning({ id: customerServiceConversationEvents.id });
        if (!event) return { status: "unavailable" as const };

        const [resolved] = await transaction.update(customerServiceHumanReviews).set({
          status: "resolved",
          resolvedAt: input.now,
          resolvedByUserId: input.actorUserId,
          resolutionEventId: event.id,
        }).where(and(
          eq(customerServiceHumanReviews.id, review.id),
          eq(customerServiceHumanReviews.channel, "website"),
          eq(customerServiceHumanReviews.status, "open"),
        )).returning({ id: customerServiceHumanReviews.id });
        if (!resolved) throw new Error("website_review_resolution_cas_failed");

        const applicableTurns = await transaction.select({
          id: customerServiceTurns.id,
          messageId: customerServiceTurns.representativeMessageId,
        }).from(customerServiceTurns).where(and(
          eq(customerServiceTurns.conversationId, review.conversationId),
          eq(customerServiceTurns.channel, "website"),
          inArray(customerServiceTurns.status, ["open", "sealed"]),
          or(
            eq(customerServiceTurns.id, review.triggerTurnId),
            inArray(customerServiceTurns.processingStatus, ["pending", "running"]),
          ),
        )).for("update");
        const turnIds = applicableTurns.map((turn) => turn.id);
        if (turnIds.length) {
          await transaction.update(customerServiceTurns).set({
            status: "suppressed",
            sealedAt: input.now,
            suppressionReason: "human_outbound_received",
            processingStatus: "cancelled",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
            lastProcessingError: "human_outbound_received",
          }).where(inArray(customerServiceTurns.id, turnIds));
        }
        const messageIds = applicableTurns
          .map((turn) => turn.messageId)
          .filter((messageId): messageId is string => Boolean(messageId));
        if (messageIds.length) {
          await transaction.update(customerServiceAiAttempts).set({
            status: "abandoned",
            draftText: null,
          }).where(and(
            inArray(customerServiceAiAttempts.messageId, messageIds),
            eq(customerServiceAiAttempts.status, "draft_ready"),
          ));
        }
        await transaction.update(customerServiceReviewAlertOutbox).set({
          status: "failed",
          lastErrorCode: "review_resolved_before_delivery",
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        }).where(and(
          eq(customerServiceReviewAlertOutbox.humanReviewId, review.id),
          or(
            inArray(customerServiceReviewAlertOutbox.status, ["pending", "retry_wait"]),
            and(
              eq(customerServiceReviewAlertOutbox.status, "leased"),
              isNull(customerServiceReviewAlertOutbox.providerSendStartedAt),
            ),
          ),
        ));
        await transaction.update(customerServiceConversations).set({ updatedAt: input.now })
          .where(and(
            eq(customerServiceConversations.id, review.conversationId),
            eq(customerServiceConversations.channel, "website"),
          ));
        return { status: "sent" as const };
      });
    },

    async listWebsitePublicUpdates(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 101) {
        throw new Error("website_public_updates_limit_invalid");
      }
      const events = await database.select({
        id: customerServiceConversationEvents.id,
        role: customerServiceConversationEvents.role,
        eventType: customerServiceConversationEvents.eventType,
        body: customerServiceConversationEvents.body,
        createdAt: customerServiceConversationEvents.createdAt,
        orderingKey: sql<string>`to_char(${customerServiceConversationEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        processingAttempts: customerServiceTurns.processingAttempts,
      }).from(customerServiceConversationEvents)
        .leftJoin(customerServiceTurns, eq(customerServiceTurns.id, customerServiceConversationEvents.turnId))
        .where(and(
          eq(customerServiceConversationEvents.conversationId, input.conversationId),
          eq(customerServiceConversationEvents.channel, "website"),
          or(
            eq(customerServiceConversationEvents.eventType, "customer_message"),
            and(
              eq(customerServiceConversationEvents.eventType, "human_outbound"),
              eq(customerServiceConversationEvents.role, "staff"),
            ),
          ),
          websitePublicUpdateAfter(
            customerServiceConversationEvents.createdAt,
            customerServiceConversationEvents.id,
            "event",
            input.after,
          ),
        ))
        .orderBy(asc(customerServiceConversationEvents.createdAt), asc(customerServiceConversationEvents.id))
        .limit(input.limit);
      const assistantMessages = await database.select({
        id: customerServiceWebsiteAssistantMessages.id,
        kind: customerServiceWebsiteAssistantMessages.kind,
        body: customerServiceWebsiteAssistantMessages.body,
        createdAt: customerServiceWebsiteAssistantMessages.publishedAt,
        orderingKey: sql<string>`to_char(${customerServiceWebsiteAssistantMessages.publishedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      }).from(customerServiceWebsiteAssistantMessages)
        .where(and(
          eq(customerServiceWebsiteAssistantMessages.conversationId, input.conversationId),
          eq(customerServiceWebsiteAssistantMessages.channel, "website"),
          websitePublicUpdateAfter(
            customerServiceWebsiteAssistantMessages.publishedAt,
            customerServiceWebsiteAssistantMessages.id,
            "assistant",
            input.after,
          ),
        ))
        .orderBy(asc(customerServiceWebsiteAssistantMessages.publishedAt), asc(customerServiceWebsiteAssistantMessages.id))
        .limit(input.limit);
      return [...events.map((event): WebsitePublicUpdateRecord => ({
        source: "event",
        id: event.id,
        role: event.role === "staff" ? "staff" : "customer",
        text: event.body,
        createdAt: event.createdAt,
        orderingKey: event.orderingKey,
        state: event.eventType === "human_outbound"
          ? "human_outbound"
          : (event.processingAttempts ?? 0) > 1 ? "recovery" : "pending",
      })), ...assistantMessages.map((message): WebsitePublicUpdateRecord => ({
        source: "assistant",
        id: message.id,
        role: "assistant",
        text: message.body,
        createdAt: message.createdAt,
        orderingKey: message.orderingKey,
        state: message.kind === "validated_ai" ? "committed_assistant" : "review",
      }))].sort((left, right) => {
        if (left.orderingKey !== right.orderingKey) return left.orderingKey < right.orderingKey ? -1 : 1;
        const source = (left.source === "event" ? 0 : 1) - (right.source === "event" ? 0 : 1);
        if (source) return source;
        return left.id.localeCompare(right.id);
      }).slice(0, input.limit);
    },

    async resolveWebsiteSession(input) {
      const [session] = await database.select({
        conversationId: customerServiceWebSessions.conversationId,
        expiresAt: customerServiceWebSessions.expiresAt,
      }).from(customerServiceWebSessions).where(and(
        eq(customerServiceWebSessions.channel, "website"),
        eq(customerServiceWebSessions.sessionTokenHash, input.sessionTokenHash),
        eq(customerServiceWebSessions.status, "active"),
        sql`${customerServiceWebSessions.expiresAt} > ${input.now}`,
      )).limit(1);
      return session ?? null;
    },

    async ensureWebsiteSession(input) {
      return database.transaction(async (transaction) => {
        await transaction.insert(customerServiceConversations).values({
          channel: "website",
          externalKeyHash: input.externalConversationKeyHash,
          createdAt: input.now,
          updatedAt: input.now,
        }).onConflictDoNothing();
        const [conversation] = await transaction.select({ id: customerServiceConversations.id })
          .from(customerServiceConversations)
          .where(and(
            eq(customerServiceConversations.channel, "website"),
            eq(customerServiceConversations.externalKeyHash, input.externalConversationKeyHash),
          ))
          .limit(1);
        if (!conversation) throw new Error("website_session_conversation_missing");

        await transaction.insert(customerServiceWebSessions).values({
          conversationId: conversation.id,
          channel: "website",
          sessionTokenHash: input.sessionTokenHash,
          status: "active",
          expiresAt: input.expiresAt,
          lastSeenAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }).onConflictDoNothing();

        const [session] = await transaction.select({
          conversationId: customerServiceWebSessions.conversationId,
          expiresAt: customerServiceWebSessions.expiresAt,
        }).from(customerServiceWebSessions).where(and(
          eq(customerServiceWebSessions.channel, "website"),
          eq(customerServiceWebSessions.sessionTokenHash, input.sessionTokenHash),
          eq(customerServiceWebSessions.status, "active"),
          sql`${customerServiceWebSessions.expiresAt} > ${input.now}`,
        )).limit(1);
        if (!session || session.conversationId !== conversation.id) {
          throw new Error("website_session_conflict");
        }

        await transaction.update(customerServiceWebSessions).set({
          lastSeenAt: input.now,
          updatedAt: input.now,
        }).where(and(
          eq(customerServiceWebSessions.sessionTokenHash, input.sessionTokenHash),
          eq(customerServiceWebSessions.conversationId, conversation.id),
          eq(customerServiceWebSessions.status, "active"),
          sql`${customerServiceWebSessions.expiresAt} > ${input.now}`,
        ));
        return session;
      });
    },

    async ingestConversationEvent(input: HashedConversationEvent) {
      return database.transaction(async (transaction) => {
        if (input.websiteRateLimit) {
          if (input.channel !== "website" || input.role !== "customer") {
            throw new Error("website_rate_limit_event_invalid");
          }
          await transaction.execute(sql`
            select pg_advisory_xact_lock(hashtext(${'website-message:' + input.externalMessageKeyHash}))
          `);
          const [duplicate] = await transaction.select({ id: customerServiceMessages.id })
            .from(customerServiceMessages)
            .where(and(
              eq(customerServiceMessages.channel, "website"),
              eq(customerServiceMessages.externalMessageKeyHash, input.externalMessageKeyHash),
            )).limit(1);
          if (duplicate) return { status: "duplicate" as const };
          const allowed = await consumeWebsiteRateLimits(transaction, input.websiteRateLimit, input.receivedAt);
          if (!allowed) {
            await recordWebsiteRateBlock(transaction, input.externalMessageKeyHash, input.receivedAt);
            return { status: "rate_limited" as const };
          }
        }

        const insertedConversation = await transaction.insert(customerServiceConversations).values({
          channel: input.channel,
          externalKeyHash: input.externalConversationKeyHash,
        }).onConflictDoNothing().returning({ id: customerServiceConversations.id });
        const [conversation] = insertedConversation.length
          ? insertedConversation
          : await transaction.select({ id: customerServiceConversations.id })
            .from(customerServiceConversations)
            .where(and(
              eq(customerServiceConversations.channel, input.channel),
              eq(customerServiceConversations.externalKeyHash, input.externalConversationKeyHash),
            )).limit(1);

        if (input.websiteRateLimit) {
          await lockConversation(transaction, conversation.id);
          await transaction.insert(customerServiceWebSessions).values({
            conversationId: conversation.id,
            channel: "website",
            sessionTokenHash: input.websiteRateLimit.sessionKeyHash,
            status: "active",
            expiresAt: input.websiteRateLimit.sessionExpiresAt,
            lastSeenAt: input.receivedAt,
            createdAt: input.receivedAt,
            updatedAt: input.receivedAt,
          }).onConflictDoNothing();
          const [session] = await transaction.select({
            conversationId: customerServiceWebSessions.conversationId,
          }).from(customerServiceWebSessions)
            .where(and(
              eq(customerServiceWebSessions.channel, "website"),
              eq(customerServiceWebSessions.sessionTokenHash, input.websiteRateLimit.sessionKeyHash),
              eq(customerServiceWebSessions.status, "active"),
              sql`${customerServiceWebSessions.expiresAt} > ${input.receivedAt}`,
            )).limit(1);
          if (!session || session.conversationId !== conversation.id) {
            throw new Error("website_session_conflict");
          }
          await transaction.update(customerServiceWebSessions).set({
            lastSeenAt: input.receivedAt,
            updatedAt: input.receivedAt,
          }).where(and(
            eq(customerServiceWebSessions.sessionTokenHash, input.websiteRateLimit.sessionKeyHash),
            eq(customerServiceWebSessions.conversationId, conversation.id),
          ));
        }

        const body = input.text?.trim() || "[Image attachment]";
        if (input.role === "staff") {
          await lockConversation(transaction, conversation.id);
          const inserted = await transaction.insert(customerServiceConversationEvents).values({
            conversationId: conversation.id,
            channel: input.channel,
            externalMessageKeyHash: input.externalMessageKeyHash,
            role: "staff",
            eventType: "human_outbound",
            body,
            bodyHash: input.bodyHash ?? null,
            redactionCodes: input.redactionCodes ?? [],
            replyToExternalMessageKeyHash: input.replyToExternalMessageKeyHash ?? null,
            learningEligible: input.learningEligible ?? false,
            receivedAt: input.receivedAt,
          }).onConflictDoNothing().returning({ id: customerServiceConversationEvents.id });
          if (!inserted.length) return { status: "duplicate" as const };

          const eventId = inserted[0].id;
          const groupWindowMs = input.humanReplyGroupMs ?? 90_000;
          if (!Number.isSafeInteger(groupWindowMs) || groupWindowMs < 10_000 || groupWindowMs > 120_000) {
            throw new Error("customer_service_human_reply_group_window_invalid");
          }
          const groupCutoff = new Date(input.receivedAt.getTime() - groupWindowMs);
          const [openGroup] = await transaction.select({
            id: customerServiceHumanReplyMatches.id,
            conversationId: customerServiceHumanReplyMatches.conversationId,
            lastOutboundAt: customerServiceHumanReplyMatches.lastOutboundAt,
            humanFinalText: customerServiceHumanReplyMatches.humanFinalText,
          }).from(customerServiceHumanReplyMatches).where(and(
            eq(customerServiceHumanReplyMatches.conversationId, conversation.id),
            eq(customerServiceHumanReplyMatches.status, "pending"),
            sql`${customerServiceHumanReplyMatches.lastOutboundAt} >= ${groupCutoff}`,
            lte(customerServiceHumanReplyMatches.lastOutboundAt, input.receivedAt),
          )).orderBy(desc(customerServiceHumanReplyMatches.lastOutboundAt)).limit(1).for("update");
          const [memberCount] = openGroup
            ? await transaction.select({ value: sql<number>`count(*)::int` })
              .from(customerServiceHumanReplyMatchEvents)
              .where(eq(customerServiceHumanReplyMatchEvents.matchId, openGroup.id))
            : [];
          const [interruption] = openGroup
            ? await transaction.select({ id: customerServiceConversationEvents.id })
              .from(customerServiceConversationEvents)
              .where(and(
                eq(customerServiceConversationEvents.conversationId, conversation.id),
                eq(customerServiceConversationEvents.eventType, "customer_message"),
                sql`${customerServiceConversationEvents.receivedAt} > ${openGroup.lastOutboundAt}`,
                lte(customerServiceConversationEvents.receivedAt, input.receivedAt),
              )).limit(1)
            : [];
          const replyTargets = openGroup
            ? await transaction.select({ value: customerServiceConversationEvents.replyToExternalMessageKeyHash })
              .from(customerServiceHumanReplyMatchEvents)
              .innerJoin(customerServiceConversationEvents, eq(
                customerServiceConversationEvents.id,
                customerServiceHumanReplyMatchEvents.eventId,
              ))
              .where(eq(customerServiceHumanReplyMatchEvents.matchId, openGroup.id))
            : [];
          const distinctReplyTargets = [...new Set(replyTargets.map((item) => item.value))];
          const groupReplyTarget = distinctReplyTargets.length === 1 ? distinctReplyTargets[0] : "mixed";
          const append = openGroup && canAppendHumanReply({
            group: {
              conversationId: openGroup.conversationId,
              lastOutboundAt: openGroup.lastOutboundAt,
              messageCount: memberCount?.value ?? 0,
              characterCount: openGroup.humanFinalText.length,
              replyToExternalMessageKeyHash: groupReplyTarget,
            },
            conversationId: conversation.id,
            receivedAt: input.receivedAt,
            textLength: body.length,
            interveningCustomer: Boolean(interruption),
            replyToExternalMessageKeyHash: input.replyToExternalMessageKeyHash ?? null,
            windowMs: groupWindowMs,
          });
          let groupId: string;
          let ordinal: number;
          if (append && openGroup) {
            ordinal = memberCount?.value ?? 0;
            groupId = openGroup.id;
            await transaction.update(customerServiceHumanReplyMatches).set({
              lastOutboundAt: input.receivedAt,
              humanFinalText: `${openGroup.humanFinalText}\n${body}`,
            }).where(and(
              eq(customerServiceHumanReplyMatches.id, openGroup.id),
              eq(customerServiceHumanReplyMatches.status, "pending"),
            ));
          } else {
            ordinal = 0;
            const [createdGroup] = await transaction.insert(customerServiceHumanReplyMatches).values({
              conversationId: conversation.id,
              status: "pending",
              firstOutboundAt: input.receivedAt,
              lastOutboundAt: input.receivedAt,
              humanFinalText: body,
              contextSummary: "[Pending conservative match]",
            }).returning({ id: customerServiceHumanReplyMatches.id });
            groupId = createdGroup.id;
          }
          await transaction.insert(customerServiceHumanReplyMatchEvents).values({
            matchId: groupId,
            eventId,
            conversationId: conversation.id,
            ordinal,
          });

          const [repliedEvent] = input.replyToExternalMessageKeyHash
            ? await transaction.select({ turnId: customerServiceConversationEvents.turnId })
              .from(customerServiceConversationEvents)
              .where(and(
                eq(customerServiceConversationEvents.conversationId, conversation.id),
                eq(customerServiceConversationEvents.externalMessageKeyHash, input.replyToExternalMessageKeyHash),
                eq(customerServiceConversationEvents.eventType, "customer_message"),
              )).limit(1)
            : [];
          let targetTurn: { id: string } | undefined;
          if (repliedEvent?.turnId) {
            [targetTurn] = await transaction.select({ id: customerServiceTurns.id })
              .from(customerServiceTurns)
              .where(and(
                eq(customerServiceTurns.id, repliedEvent.turnId),
                inArray(customerServiceTurns.status, ["open", "sealed"]),
              )).limit(1).for("update");
          } else if (!input.replyToExternalMessageKeyHash) {
            [targetTurn] = await transaction.select({ id: customerServiceTurns.id })
              .from(customerServiceTurns)
              .where(and(
                eq(customerServiceTurns.conversationId, conversation.id),
                inArray(customerServiceTurns.status, ["open", "sealed"]),
                lte(customerServiceTurns.lastEventAt, input.receivedAt),
              )).orderBy(desc(customerServiceTurns.lastEventAt)).limit(1).for("update");
          }
          if (targetTurn) {
            await transaction.update(customerServiceTurns).set({
              status: "suppressed",
              sealedAt: input.receivedAt,
              suppressionReason: "human_outbound_received",
              processingStatus: "cancelled",
              processingLeaseToken: null,
              processingLeaseExpiresAt: null,
              processingCompletedAt: input.receivedAt,
            }).where(and(
              eq(customerServiceTurns.id, targetTurn.id),
              inArray(customerServiceTurns.status, ["open", "sealed"]),
            ));
          }
          return { status: "context_only" as const };
        }

        const customerText = input.text?.trim() || null;
        const debounceMs = input.debounceMs ?? 2_000;
        if (!Number.isSafeInteger(debounceMs) || debounceMs < 250 || debounceMs > 10_000) {
          throw new Error("customer_service_turn_debounce_invalid");
        }
        const debounceUntil = new Date(input.receivedAt.getTime() + debounceMs);
        await lockConversation(transaction, conversation.id);
        const [coveringHumanReply] = input.channel === "website"
          ? await transaction.select({ id: customerServiceConversationEvents.id })
            .from(customerServiceConversationEvents)
            .where(and(
              eq(customerServiceConversationEvents.conversationId, conversation.id),
              eq(customerServiceConversationEvents.channel, "website"),
              eq(customerServiceConversationEvents.eventType, "human_outbound"),
              gt(customerServiceConversationEvents.receivedAt, input.receivedAt),
            )).limit(1)
          : [];
        const humanReplyWon = Boolean(coveringHumanReply);
        const canAggregate = !humanReplyWon && input.attachments.length === 0 && customerText !== null;
        const [openTurn] = canAggregate
          ? await transaction.select({
            id: customerServiceTurns.id,
            representativeMessageId: customerServiceTurns.representativeMessageId,
            body: customerServiceTurns.body,
            fragmentCount: customerServiceTurns.fragmentCount,
          }).from(customerServiceTurns).where(and(
            eq(customerServiceTurns.conversationId, conversation.id),
            eq(customerServiceTurns.status, "open"),
            sql`${customerServiceTurns.openedAt} <= ${debounceUntil}`,
            sql`${customerServiceTurns.debounceUntil} >= ${input.receivedAt}`,
            sql`not exists (
              select 1 from ${customerServiceAttachments}
              where ${customerServiceAttachments.messageId} = ${customerServiceTurns.representativeMessageId}
            )`,
          )).orderBy(desc(customerServiceTurns.lastEventAt)).limit(1).for("update")
          : [];
        const combinedBody = openTurn ? `${openTurn.body}\n${body}` : body;
        const mayExtend = Boolean(openTurn)
          && openTurn.fragmentCount < 8
          && combinedBody.length <= 2_400;
        if (input.websiteRateLimit && !mayExtend) {
          const [runnableTurn] = await transaction.select({ id: customerServiceTurns.id })
            .from(customerServiceTurns)
            .where(and(
              eq(customerServiceTurns.conversationId, conversation.id),
              inArray(customerServiceTurns.status, ["open", "sealed"]),
              inArray(customerServiceTurns.processingStatus, ["pending", "running"]),
            )).limit(1).for("update");
          if (runnableTurn) {
            await recordWebsiteRateBlock(transaction, input.externalMessageKeyHash, input.receivedAt);
            return { status: "rate_limited" as const };
          }
        }
        const [message] = await transaction.insert(customerServiceMessages).values({
          conversationId: conversation.id,
          channel: input.channel,
          externalMessageKeyHash: input.externalMessageKeyHash,
          body,
          customerText,
          productContext: input.channel === "website" ? input.productContext ?? null : null,
          receivedAt: input.receivedAt,
        }).onConflictDoNothing().returning({ id: customerServiceMessages.id });
        if (!message) return { status: "duplicate" as const };
        const [turn] = mayExtend && openTurn
          ? await transaction.update(customerServiceTurns).set({
            openedAt: sql`least(${customerServiceTurns.openedAt}, ${input.receivedAt})`,
            lastEventAt: sql`greatest(${customerServiceTurns.lastEventAt}, ${input.receivedAt})`,
            debounceUntil: sql`greatest(${customerServiceTurns.debounceUntil}, ${debounceUntil})`,
            nextRunAt: sql`greatest(${customerServiceTurns.nextRunAt}, ${debounceUntil})`,
            fragmentCount: sql`${customerServiceTurns.fragmentCount} + 1`,
          }).where(and(
            eq(customerServiceTurns.id, openTurn.id),
            eq(customerServiceTurns.status, "open"),
          )).returning({ id: customerServiceTurns.id })
          : await transaction.insert(customerServiceTurns).values({
            conversationId: conversation.id,
            channel: input.channel,
            representativeMessageId: message.id,
            body,
            ...(humanReplyWon ? {
              status: "suppressed" as const,
              sealedAt: input.receivedAt,
              suppressionReason: "human_outbound_received" as const,
              processingStatus: "cancelled" as const,
              processingCompletedAt: input.receivedAt,
              lastProcessingError: "human_outbound_received",
            } : {}),
            debounceUntil,
            nextRunAt: debounceUntil,
            openedAt: input.receivedAt,
            lastEventAt: input.receivedAt,
          }).returning({ id: customerServiceTurns.id });
        await transaction.insert(customerServiceConversationEvents).values({
          conversationId: conversation.id,
          turnId: turn.id,
          legacyMessageId: message.id,
          channel: input.channel,
          externalMessageKeyHash: input.externalMessageKeyHash,
          role: "customer",
          eventType: "customer_message",
          body,
          receivedAt: input.receivedAt,
        });
        let representativeMessageId = message.id;
        if (canAggregate) {
          const orderedEvents = await transaction.select({
            body: customerServiceConversationEvents.body,
            legacyMessageId: customerServiceConversationEvents.legacyMessageId,
            receivedAt: customerServiceConversationEvents.receivedAt,
            productContext: customerServiceMessages.productContext,
          }).from(customerServiceConversationEvents)
            .leftJoin(customerServiceMessages, eq(
              customerServiceMessages.id,
              customerServiceConversationEvents.legacyMessageId,
            )).where(
            eq(customerServiceConversationEvents.turnId, turn.id),
          ).orderBy(
            asc(customerServiceConversationEvents.receivedAt),
            asc(customerServiceConversationEvents.createdAt),
            asc(customerServiceConversationEvents.id),
          );
          const firstEvent = orderedEvents[0];
          const lastEvent = orderedEvents.at(-1);
          representativeMessageId = firstEvent?.legacyMessageId ?? message.id;
          const orderedBody = orderedEvents.map((event) => event.body).join("\n");
          await transaction.update(customerServiceTurns).set({
            representativeMessageId,
            body: orderedBody,
            openedAt: firstEvent?.receivedAt ?? input.receivedAt,
            lastEventAt: lastEvent?.receivedAt ?? input.receivedAt,
            fragmentCount: orderedEvents.length,
          }).where(eq(customerServiceTurns.id, turn.id));
          await transaction.update(customerServiceMessages).set({
            body: orderedBody,
            customerText: orderedBody,
            ...(input.channel === "website"
              ? { productContext: lastEvent?.productContext ?? null }
              : {}),
          }).where(eq(customerServiceMessages.id, representativeMessageId));
        }
        if (input.attachments.length) {
          await transaction.insert(customerServiceAttachments).values(input.attachments.map((attachment) => ({
            messageId: message.id,
            conversationId: conversation.id,
            externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
            ordinal: attachment.ordinal,
            kind: "image" as const,
            normalizedKind: attachment.kind,
            mimeTypeHint: attachment.mimeTypeHint,
            status: attachment.kind === "unsupported" ? "rejected" as const : "metadata_received" as const,
            failureCode: attachment.failureCode ?? null,
          })));
        }
        if (input.imageJob) {
          await transaction.insert(customerServiceImageJobs).values({
            id: input.imageJob.id,
            messageId: message.id,
            conversationId: conversation.id,
            status: input.imageJob.status,
            sourceCiphertext: input.imageJob.sourceCiphertext,
            sourceExpiresAt: input.imageJob.sourceExpiresAt,
            failureCode: input.imageJob.failureCode,
            nextRunAt: input.receivedAt,
            ...(input.imageJob.status === "human_review_required" ? { completedAt: input.receivedAt } : {}),
          });
          await transaction.update(customerServiceTurns).set({
            processingStatus: "completed",
            processingCompletedAt: input.receivedAt,
          }).where(eq(customerServiceTurns.id, turn.id));
        }
        if (humanReplyWon) return { status: "context_only" as const };
        return {
          status: "turn_pending" as const,
          messageId: representativeMessageId,
          turnId: turn.id,
          debounceUntil,
        };
      });
    },

    async sealDueCustomerTurn(input) {
      return database.transaction(async (transaction) => {
        const [turn] = await transaction.select().from(customerServiceTurns)
          .where(eq(customerServiceTurns.id, input.turnId)).limit(1).for("update");
        if (!turn || turn.status !== "open" || !turn.representativeMessageId) {
          return { status: "already_terminal" as const };
        }
        if (turn.debounceUntil.getTime() > input.now.getTime()) {
          return { status: "not_due" as const };
        }
        const historyRows = await transaction.select({
          role: customerServiceConversationEvents.role,
          text: customerServiceConversationEvents.body,
        }).from(customerServiceConversationEvents).where(and(
          eq(customerServiceConversationEvents.conversationId, turn.conversationId),
          sql`${customerServiceConversationEvents.turnId} is distinct from ${turn.id}`,
          lte(customerServiceConversationEvents.receivedAt, turn.openedAt),
        )).orderBy(
          desc(customerServiceConversationEvents.receivedAt),
          desc(customerServiceConversationEvents.createdAt),
          desc(customerServiceConversationEvents.id),
        ).limit(6);
        const acknowledgement = classifyAcknowledgement({
          currentText: turn.body,
          recentHistory: historyRows.reverse(),
        });
        if (acknowledgement.suppress) {
          await transaction.update(customerServiceTurns).set({
            status: "suppressed",
            sealedAt: input.now,
            suppressionReason: acknowledgement.reason,
            processingStatus: "completed",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
          }).where(and(
            eq(customerServiceTurns.id, turn.id),
            eq(customerServiceTurns.status, "open"),
          ));
          return {
            status: "suppressed" as const,
            turnId: turn.id,
            reason: acknowledgement.reason,
          };
        }
        const [pilot] = await transaction.select().from(customerServicePilotRuns)
          .where(and(
            eq(customerServicePilotRuns.channel, turn.channel),
            eq(customerServicePilotRuns.status, "active"),
          )).limit(1).for("update");
        if (!pilot || pilot.nextSequence > pilot.messageLimit) {
          if (pilot) {
            await transaction.update(customerServicePilotRuns).set({
              status: "completed",
              completedAt: input.now,
            }).where(eq(customerServicePilotRuns.id, pilot.id));
          }
          await transaction.update(customerServiceTurns).set({
            status: "pilot_complete",
            sealedAt: input.now,
            processingStatus: "completed",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
          }).where(eq(customerServiceTurns.id, turn.id));
          return {
            status: "pilot_complete" as const,
            turnId: turn.id,
            messageId: turn.representativeMessageId,
          };
        }
        await transaction.update(customerServiceTurns).set({
          status: "sealed",
          sealedAt: input.now,
          pilotRunId: pilot.id,
          pilotSequence: pilot.nextSequence,
        }).where(and(
          eq(customerServiceTurns.id, turn.id),
          eq(customerServiceTurns.status, "open"),
        ));
        await transaction.update(customerServiceMessages).set({
          body: turn.body,
          customerText: turn.body,
          pilotRunId: pilot.id,
          pilotSequence: pilot.nextSequence,
        }).where(eq(customerServiceMessages.id, turn.representativeMessageId));
        await transaction.update(customerServicePilotRuns).set({
          nextSequence: pilot.nextSequence + 1,
        }).where(eq(customerServicePilotRuns.id, pilot.id));
        return {
          status: "sealed" as const,
          turnId: turn.id,
          messageId: turn.representativeMessageId,
          pilotSequence: pilot.nextSequence,
        };
      });
    },

    async claimDueCustomerTurn(input) {
      if (input.leaseExpiresAt.getTime() <= input.now.getTime()) {
        throw new Error("customer_service_turn_lease_invalid");
      }
      if (input.channels?.length === 0) return null;

      const candidateId = await database.transaction(async (transaction) => {
        const conditions = [
          inArray(customerServiceTurns.status, ["open", "sealed"]),
          lte(customerServiceTurns.nextRunAt, input.now),
          or(
            eq(customerServiceTurns.processingStatus, "pending"),
            and(
              eq(customerServiceTurns.processingStatus, "running"),
              lte(customerServiceTurns.processingLeaseExpiresAt, input.now),
            ),
          ),
          sql`not exists (
            select 1 from ${customerServiceAttachments}
            where ${customerServiceAttachments.messageId} = ${customerServiceTurns.representativeMessageId}
          )`,
        ];
        if (input.turnId) conditions.push(eq(customerServiceTurns.id, input.turnId));
        if (input.channels) conditions.push(inArray(customerServiceTurns.channel, input.channels));
        const [candidate] = await transaction.select({ id: customerServiceTurns.id })
          .from(customerServiceTurns)
          .where(and(...conditions))
          .orderBy(asc(customerServiceTurns.nextRunAt), asc(customerServiceTurns.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        return candidate?.id ?? null;
      });
      if (!candidateId) return null;

      await repository.sealDueCustomerTurn({ turnId: candidateId, now: input.now });

      return database.transaction(async (transaction) => {
        const [turn] = await transaction.select({
          id: customerServiceTurns.id,
          messageId: customerServiceTurns.representativeMessageId,
          channel: customerServiceTurns.channel,
        }).from(customerServiceTurns).where(and(
          eq(customerServiceTurns.id, candidateId),
          eq(customerServiceTurns.status, "sealed"),
          lte(customerServiceTurns.nextRunAt, input.now),
          or(
            eq(customerServiceTurns.processingStatus, "pending"),
            and(
              eq(customerServiceTurns.processingStatus, "running"),
              lte(customerServiceTurns.processingLeaseExpiresAt, input.now),
            ),
          ),
        )).limit(1).for("update", { skipLocked: true });
        if (!turn?.messageId) return null;

        const [latestAttempt] = await transaction.select({
          id: customerServiceAiAttempts.id,
          status: customerServiceAiAttempts.status,
          gateResult: customerServiceAiAttempts.gateResult,
          providerCalled: customerServiceAiAttempts.providerCalled,
          reservedCostMicrousd: customerServiceAiAttempts.reservedCostMicrousd,
          startedAt: customerServiceAiAttempts.startedAt,
        }).from(customerServiceAiAttempts).where(and(
          eq(customerServiceAiAttempts.messageId, turn.messageId),
          eq(customerServiceAiAttempts.trigger, "webhook_after"),
        )).orderBy(desc(customerServiceAiAttempts.attemptNumber)).limit(1).for("update");

        const settledWebsiteResult = turn.channel === "website" && latestAttempt
          ? (() => {
            if (latestAttempt.status === "gate_blocked") {
              return latestAttempt.gateResult === "realtime_required"
                ? { status: "realtime_required" as const, attemptId: latestAttempt.id }
                : { status: "gate_blocked" as const, attemptId: latestAttempt.id };
            }
            if (latestAttempt.status === "budget_blocked") {
              return { status: "budget_blocked" as const, attemptId: latestAttempt.id };
            }
            if (latestAttempt.status === "provider_error") {
              return { status: "provider_error" as const, attemptId: latestAttempt.id };
            }
            if (latestAttempt.status === "output_blocked") {
              return { status: "output_blocked" as const, attemptId: latestAttempt.id };
            }
            if (latestAttempt.status === "draft_ready") {
              return { status: "draft_ready" as const, attemptId: latestAttempt.id };
            }
            if (
              ["pending", "provider_pending"].includes(latestAttempt.status)
              && latestAttempt.providerCalled
            ) {
              return { status: "provider_error" as const, attemptId: latestAttempt.id };
            }
            return null;
          })()
          : null;

        if (!settledWebsiteResult && latestAttempt && [
          "gate_blocked",
          "output_blocked",
          "budget_blocked",
          "abandoned",
        ].includes(latestAttempt.status)) {
          await transaction.update(customerServiceTurns).set({
            processingStatus: "completed",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
          }).where(eq(customerServiceTurns.id, turn.id));
          return null;
        }

        if (
          turn.channel !== "website"
          && latestAttempt
          && ["pending", "provider_pending"].includes(latestAttempt.status)
          && latestAttempt.providerCalled
        ) {
          await transaction.update(customerServiceTurns).set({
            processingStatus: "completed",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
            lastProcessingError: "provider_outcome_unknown",
          }).where(eq(customerServiceTurns.id, turn.id));
          return null;
        }

        if (
          latestAttempt
          && ["pending", "provider_pending"].includes(latestAttempt.status)
          && !latestAttempt.providerCalled
        ) {
          if (latestAttempt.reservedCostMicrousd > 0) {
            const dailyScopeKey = localDateScopeKey(latestAttempt.startedAt);
            await releaseProviderBudget(
              transaction,
              dailyScopeKey,
              turn.channel,
              latestAttempt.reservedCostMicrousd,
            );
          }
          await transaction.update(customerServiceAiAttempts).set({
            status: "abandoned",
            reservedCostMicrousd: 0,
            providerErrorCode: "turn_recovery_pre_invocation_interrupted",
            completedAt: input.now,
          }).where(and(
            eq(customerServiceAiAttempts.id, latestAttempt.id),
            inArray(customerServiceAiAttempts.status, ["pending", "provider_pending"]),
            eq(customerServiceAiAttempts.providerCalled, false),
          ));
        }

        const leaseToken = randomUUID();
        const [claimed] = await transaction.update(customerServiceTurns).set({
          processingStatus: "running",
          processingLeaseToken: leaseToken,
          processingLeaseExpiresAt: input.leaseExpiresAt,
          processingAttempts: sql`${customerServiceTurns.processingAttempts} + 1`,
          lastProcessingError: null,
        }).where(and(
          eq(customerServiceTurns.id, turn.id),
          eq(customerServiceTurns.status, "sealed"),
          or(
            eq(customerServiceTurns.processingStatus, "pending"),
            and(
              eq(customerServiceTurns.processingStatus, "running"),
              lte(customerServiceTurns.processingLeaseExpiresAt, input.now),
            ),
          ),
        )).returning({
          id: customerServiceTurns.id,
          processingAttempt: customerServiceTurns.processingAttempts,
        });
        return claimed ? {
          turnId: turn.id,
          messageId: turn.messageId,
          channel: turn.channel,
          leaseToken,
          processingAttempt: claimed.processingAttempt,
          ...(settledWebsiteResult ? { settledResult: settledWebsiteResult } : {}),
        } : null;
      });
    },

    async completeCustomerTurnProcessing(input) {
      const completed = await database.update(customerServiceTurns).set({
        processingStatus: "completed",
        processingLeaseToken: null,
        processingLeaseExpiresAt: null,
        processingCompletedAt: input.now,
        lastProcessingError: null,
      }).where(and(
        eq(customerServiceTurns.id, input.turnId),
        eq(customerServiceTurns.status, "sealed"),
        eq(customerServiceTurns.processingStatus, "running"),
        eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
      )).returning({ id: customerServiceTurns.id });
      return completed.length === 1;
    },

    async openWebsiteHumanReview(input) {
      return database.transaction(async (transaction) => {
        const [identity] = await transaction.select({
          conversationId: customerServiceTurns.conversationId,
        }).from(customerServiceTurns).where(and(
          eq(customerServiceTurns.id, input.turnId),
          eq(customerServiceTurns.channel, "website"),
        )).limit(1);
        if (!identity) return { status: "cancelled" as const };
        await lockConversation(transaction, identity.conversationId);

        const [turn] = await transaction.select({
          id: customerServiceTurns.id,
          conversationId: customerServiceTurns.conversationId,
          messageId: customerServiceTurns.representativeMessageId,
          body: customerServiceTurns.body,
        }).from(customerServiceTurns).where(and(
          eq(customerServiceTurns.id, input.turnId),
          eq(customerServiceTurns.channel, "website"),
          eq(customerServiceTurns.status, "sealed"),
          eq(customerServiceTurns.processingStatus, "running"),
          eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
        )).limit(1).for("update");
        if (!turn?.messageId) return { status: "cancelled" as const };

        const [attempt] = input.attemptId
          ? await transaction.select({ gateResult: customerServiceAiAttempts.gateResult })
            .from(customerServiceAiAttempts)
            .where(and(
              eq(customerServiceAiAttempts.id, input.attemptId),
              eq(customerServiceAiAttempts.messageId, turn.messageId),
            )).limit(1)
          : [];
        const response = websiteHumanReviewResponse(
          websiteReviewReason(input.outcome, attempt?.gateResult ?? null),
          { message: turn.body },
        );

        const [existing] = await transaction.select({
          id: customerServiceHumanReviews.id,
          generation: customerServiceHumanReviews.generation,
        }).from(customerServiceHumanReviews).where(and(
          eq(customerServiceHumanReviews.conversationId, turn.conversationId),
          eq(customerServiceHumanReviews.status, "open"),
        )).limit(1).for("update");

        const review = existing ?? await (async () => {
          const [latest] = await transaction.select({ generation: max(customerServiceHumanReviews.generation) })
            .from(customerServiceHumanReviews)
            .where(eq(customerServiceHumanReviews.conversationId, turn.conversationId));
          const [created] = await transaction.insert(customerServiceHumanReviews).values({
            ...(input.reviewAlert ? { id: input.reviewAlert.reviewId } : {}),
            conversationId: turn.conversationId,
            channel: "website",
            triggerTurnId: turn.id,
            generation: (latest?.generation ?? 0) + 1,
            reason: response.reason,
            status: "open",
            redactedSummary: redactedWebsiteReviewSummary(turn.body),
            ...(input.reviewAlert ? {
              deepLinkTokenHash: input.reviewAlert.deepLinkTokenHash,
              deepLinkExpiresAt: input.reviewAlert.deepLinkExpiresAt,
            } : {}),
            openedAt: input.now,
          }).returning({
            id: customerServiceHumanReviews.id,
            generation: customerServiceHumanReviews.generation,
          });
          const notificationCount = await enqueueInternalNotifications(transaction, {
            topic: "website_ai_human_review_required",
            sourceEventId: created.id,
            resourceType: "customer_service_review",
            resourceId: created.id,
            resourceReference: `Website chat requires human review (${response.reason}) at ${input.now.toISOString()}`,
            payload: { version: 1, adminPath: "/reply-assistant" },
            createdAt: input.now,
          });
          if (notificationCount === 0 && input.reviewAlert) {
            await transaction.insert(customerServiceReviewAlertOutbox).values({
              humanReviewId: created.id,
              status: "pending",
              idempotencyKey: input.reviewAlert.idempotencyKey,
              attemptCount: 0,
              nextAttemptAt: input.now,
            });
          }
          return created;
        })();

        if (existing) {
          await transaction.update(customerServiceReviewAlertOutbox).set({
            deduplicatedCount: sql`${customerServiceReviewAlertOutbox.deduplicatedCount} + 1`,
            updatedAt: input.now,
          }).where(eq(customerServiceReviewAlertOutbox.humanReviewId, existing.id));
        }

        await transaction.insert(customerServiceWebsiteAssistantMessages).values({
          conversationId: turn.conversationId,
          channel: "website",
          messageId: turn.messageId,
          turnId: turn.id,
          kind: response.kind,
          body: response.body,
          policyResult: response.reason,
          gateReasons: [response.reason],
          knowledgeVersion: input.knowledgeVersion,
          publishedAt: input.now,
        }).onConflictDoNothing();

        return existing
          ? { status: "reused" as const, reviewId: review.id, generation: review.generation }
          : { status: "opened" as const, reviewId: review.id, generation: review.generation };
      });
    },

    async claimDueReviewAlert(input) {
      return database.transaction(async (transaction) => {
        const eligible = or(
          and(
            eq(customerServiceHumanReviews.status, "open"),
            gt(customerServiceHumanReviews.deepLinkExpiresAt, input.now),
            lte(customerServiceReviewAlertOutbox.nextAttemptAt, input.now),
            inArray(customerServiceReviewAlertOutbox.status, ["pending", "retry_wait"]),
          ),
          and(
            eq(customerServiceReviewAlertOutbox.status, "leased"),
            lte(customerServiceReviewAlertOutbox.leaseExpiresAt, input.now),
          ),
        );
        const [identity] = await transaction.select({
          id: customerServiceReviewAlertOutbox.id,
          conversationId: customerServiceHumanReviews.conversationId,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(customerServiceHumanReviews, eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId))
          .where(eligible)
          .orderBy(asc(customerServiceReviewAlertOutbox.createdAt), asc(customerServiceReviewAlertOutbox.id))
          .limit(1);
        if (!identity) return null;

        await lockConversation(transaction, identity.conversationId);
        const [row] = await transaction.select({
          outbox: customerServiceReviewAlertOutbox,
          reviewStatus: customerServiceHumanReviews.status,
          reason: customerServiceHumanReviews.reason,
          redactedSummary: customerServiceHumanReviews.redactedSummary,
          openedAt: customerServiceHumanReviews.openedAt,
          deepLinkExpiresAt: customerServiceHumanReviews.deepLinkExpiresAt,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(customerServiceHumanReviews, eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId))
          .where(and(
            eq(customerServiceReviewAlertOutbox.id, identity.id),
            eq(customerServiceHumanReviews.conversationId, identity.conversationId),
            eligible,
          ))
          .for("update", { skipLocked: true })
          .limit(1);
        if (!row) return null;
        const sendRecoveryCutoff = new Date(
          input.now.getTime() - REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS,
        );
        if (
          row.outbox.providerSendStartedAt
          && row.outbox.providerSendStartedAt <= sendRecoveryCutoff
        ) {
          await transaction.update(customerServiceReviewAlertOutbox).set({
            status: "failed",
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: "provider_idempotency_window_expired_unknown_result",
            updatedAt: input.now,
          }).where(and(
            eq(customerServiceReviewAlertOutbox.id, row.outbox.id),
            eq(customerServiceReviewAlertOutbox.status, row.outbox.status),
            eq(customerServiceReviewAlertOutbox.attemptCount, row.outbox.attemptCount),
            eq(customerServiceReviewAlertOutbox.providerSendStartedAt, row.outbox.providerSendStartedAt),
          ));
          return null;
        }
        const reviewReady = row.reviewStatus === "open"
          && Boolean(row.deepLinkExpiresAt && row.deepLinkExpiresAt > input.now);
        if (!reviewReady) {
          await transaction.update(customerServiceReviewAlertOutbox).set({
            status: "failed",
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: row.reviewStatus === "open"
              ? "deep_link_expired_after_send_started"
              : "review_resolved_after_send_started",
            updatedAt: input.now,
          }).where(and(
            eq(customerServiceReviewAlertOutbox.id, row.outbox.id),
            eq(customerServiceReviewAlertOutbox.status, "leased"),
            lte(customerServiceReviewAlertOutbox.leaseExpiresAt, input.now),
          ));
          return null;
        }
        if (!row.deepLinkExpiresAt) return null;
        const leaseToken = randomUUID();
        const [claimed] = await transaction.update(customerServiceReviewAlertOutbox).set({
          status: "leased",
          leaseToken,
          leaseExpiresAt: input.leaseExpiresAt,
          attemptCount: sql`${customerServiceReviewAlertOutbox.attemptCount} + 1`,
          lastErrorCode: null,
          updatedAt: input.now,
        }).where(and(
          eq(customerServiceReviewAlertOutbox.id, row.outbox.id),
          eq(customerServiceReviewAlertOutbox.attemptCount, row.outbox.attemptCount),
          inArray(customerServiceReviewAlertOutbox.status, ["pending", "retry_wait", "leased"]),
        )).returning({ attemptCount: customerServiceReviewAlertOutbox.attemptCount });
        if (!claimed) return null;
        return {
          id: row.outbox.id,
          humanReviewId: row.outbox.humanReviewId,
          idempotencyKey: row.outbox.idempotencyKey,
          attemptCount: claimed.attemptCount,
          leaseToken,
          reason: row.reason,
          redactedSummary: row.redactedSummary,
          openedAt: row.openedAt,
          deepLinkExpiresAt: row.deepLinkExpiresAt,
        };
      });
    },

    async confirmClaimedReviewAlert(input) {
      return database.transaction(async (transaction) => {
        const [identity] = await transaction.select({
          conversationId: customerServiceHumanReviews.conversationId,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId),
          )
          .where(eq(customerServiceReviewAlertOutbox.id, input.id))
          .limit(1);
        if (!identity) return false;

        await lockConversation(transaction, identity.conversationId);
        const [current] = await transaction.select({
          outboxStatus: customerServiceReviewAlertOutbox.status,
          leaseToken: customerServiceReviewAlertOutbox.leaseToken,
          leaseExpiresAt: customerServiceReviewAlertOutbox.leaseExpiresAt,
          reviewStatus: customerServiceHumanReviews.status,
          deepLinkExpiresAt: customerServiceHumanReviews.deepLinkExpiresAt,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId),
          )
          .where(and(
            eq(customerServiceReviewAlertOutbox.id, input.id),
            eq(customerServiceHumanReviews.conversationId, identity.conversationId),
          ))
          .limit(1)
          .for("update");
        const ready = current?.outboxStatus === "leased"
          && current.leaseToken === input.leaseToken
          && Boolean(current.leaseExpiresAt && current.leaseExpiresAt > input.now)
          && current.reviewStatus === "open"
          && Boolean(current.deepLinkExpiresAt && current.deepLinkExpiresAt > input.now);
        if (ready) return true;

        await transaction.update(customerServiceReviewAlertOutbox).set({
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: current?.reviewStatus === "open"
            ? "deep_link_expired_before_send"
            : "review_resolved_before_delivery",
          updatedAt: input.now,
        }).where(and(
          eq(customerServiceReviewAlertOutbox.id, input.id),
          eq(customerServiceReviewAlertOutbox.status, "leased"),
          eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
        ));
        return false;
      });
    },

    async beginClaimedReviewAlertSend(input) {
      return database.transaction(async (transaction) => {
        const [identity] = await transaction.select({
          conversationId: customerServiceHumanReviews.conversationId,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId),
          )
          .where(eq(customerServiceReviewAlertOutbox.id, input.id))
          .limit(1);
        if (!identity) return "resolved" as const;

        await lockConversation(transaction, identity.conversationId);
        const [current] = await transaction.select({
          outboxStatus: customerServiceReviewAlertOutbox.status,
          leaseToken: customerServiceReviewAlertOutbox.leaseToken,
          leaseExpiresAt: customerServiceReviewAlertOutbox.leaseExpiresAt,
          providerSendStartedAt: customerServiceReviewAlertOutbox.providerSendStartedAt,
          providerPayloadDigest: customerServiceReviewAlertOutbox.providerPayloadDigest,
          reviewStatus: customerServiceHumanReviews.status,
          deepLinkExpiresAt: customerServiceHumanReviews.deepLinkExpiresAt,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId),
          )
          .where(and(
            eq(customerServiceReviewAlertOutbox.id, input.id),
            eq(customerServiceHumanReviews.conversationId, identity.conversationId),
          ))
          .limit(1)
          .for("update");
        const ready = current?.outboxStatus === "leased"
          && current.leaseToken === input.leaseToken
          && Boolean(current.leaseExpiresAt && current.leaseExpiresAt > input.now)
          && current.reviewStatus === "open"
          && Boolean(current.deepLinkExpiresAt && current.deepLinkExpiresAt > input.now);
        if (ready) {
          if (
            (current.providerSendStartedAt && !current.providerPayloadDigest)
            || (current.providerPayloadDigest && current.providerPayloadDigest !== input.payloadDigest)
          ) {
            await transaction.update(customerServiceReviewAlertOutbox).set({
              status: "failed",
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: "provider_payload_config_drift_unknown_result",
              updatedAt: input.now,
            }).where(and(
              eq(customerServiceReviewAlertOutbox.id, input.id),
              eq(customerServiceReviewAlertOutbox.status, "leased"),
              eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
            ));
            return "payload_mismatch" as const;
          }
          const [linearized] = await transaction.update(customerServiceReviewAlertOutbox).set({
            providerSendStartedAt: sql`coalesce(${customerServiceReviewAlertOutbox.providerSendStartedAt}, ${input.now})`,
            providerPayloadDigest: sql`coalesce(${customerServiceReviewAlertOutbox.providerPayloadDigest}, ${input.payloadDigest})`,
            updatedAt: input.now,
          }).where(and(
            eq(customerServiceReviewAlertOutbox.id, input.id),
            eq(customerServiceReviewAlertOutbox.status, "leased"),
            eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
          )).returning({ id: customerServiceReviewAlertOutbox.id });
          return linearized ? "send" as const : "resolved" as const;
        }

        await transaction.update(customerServiceReviewAlertOutbox).set({
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: current?.reviewStatus === "open"
            ? "deep_link_expired_before_send"
            : "review_resolved_before_delivery",
          updatedAt: input.now,
        }).where(and(
          eq(customerServiceReviewAlertOutbox.id, input.id),
          eq(customerServiceReviewAlertOutbox.status, "leased"),
          eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
        ));
        return "resolved" as const;
      });
    },

    async markReviewAlertSent(input) {
      const [updated] = await database.update(customerServiceReviewAlertOutbox).set({
        status: "sent",
        leaseToken: null,
        leaseExpiresAt: null,
        sentAt: input.now,
        lastErrorCode: null,
        updatedAt: input.now,
      }).where(and(
        eq(customerServiceReviewAlertOutbox.id, input.id),
        eq(customerServiceReviewAlertOutbox.status, "leased"),
        eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
        isNotNull(customerServiceReviewAlertOutbox.providerSendStartedAt),
        isNotNull(customerServiceReviewAlertOutbox.providerPayloadDigest),
      )).returning({ id: customerServiceReviewAlertOutbox.id });
      void input.providerMessageId;
      return Boolean(updated);
    },

    async retryReviewAlert(input) {
      return database.transaction(async (transaction) => {
        const [identity] = await transaction.select({
          conversationId: customerServiceHumanReviews.conversationId,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId),
          )
          .where(eq(customerServiceReviewAlertOutbox.id, input.id))
          .limit(1);
        if (!identity) return "stale" as const;

        await lockConversation(transaction, identity.conversationId);
        const [current] = await transaction.select({
          outboxStatus: customerServiceReviewAlertOutbox.status,
          leaseToken: customerServiceReviewAlertOutbox.leaseToken,
          reviewStatus: customerServiceHumanReviews.status,
        }).from(customerServiceReviewAlertOutbox)
          .innerJoin(
            customerServiceHumanReviews,
            eq(customerServiceHumanReviews.id, customerServiceReviewAlertOutbox.humanReviewId),
          )
          .where(and(
            eq(customerServiceReviewAlertOutbox.id, input.id),
            eq(customerServiceHumanReviews.conversationId, identity.conversationId),
          ))
          .limit(1)
          .for("update");
        if (
          current?.outboxStatus !== "leased"
          || current.leaseToken !== input.leaseToken
        ) return "stale" as const;

        const reviewOpen = current.reviewStatus === "open";
        const [updated] = await transaction.update(customerServiceReviewAlertOutbox).set({
          status: reviewOpen ? "retry_wait" : "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: reviewOpen ? input.errorCode : "review_resolved_after_send_started",
          ...(reviewOpen ? {
            nextAttemptAt: input.nextAttemptAt,
          } : {}),
          updatedAt: input.now,
        }).where(and(
          eq(customerServiceReviewAlertOutbox.id, input.id),
          eq(customerServiceReviewAlertOutbox.status, "leased"),
          eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
          isNotNull(customerServiceReviewAlertOutbox.providerSendStartedAt),
        )).returning({ id: customerServiceReviewAlertOutbox.id });
        if (!updated) return "stale" as const;
        return reviewOpen ? "retry_wait" as const : "resolved" as const;
      });
    },

    async markReviewAlertUncertain(input) {
      const [updated] = await database.update(customerServiceReviewAlertOutbox).set({
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        updatedAt: input.now,
      }).where(and(
        eq(customerServiceReviewAlertOutbox.id, input.id),
        eq(customerServiceReviewAlertOutbox.status, "leased"),
        eq(customerServiceReviewAlertOutbox.leaseToken, input.leaseToken),
      )).returning({ id: customerServiceReviewAlertOutbox.id });
      return Boolean(updated);
    },

    async publishWebsiteValidatedAi(input) {
      return database.transaction(async (transaction) => {
        const [identity] = await transaction.select({
          conversationId: customerServiceTurns.conversationId,
        }).from(customerServiceTurns).where(and(
          eq(customerServiceTurns.id, input.turnId),
          eq(customerServiceTurns.channel, "website"),
        )).limit(1);
        if (!identity) return { status: "cancelled" as const };
        await lockConversation(transaction, identity.conversationId);

        const [turn] = await transaction.select({
          id: customerServiceTurns.id,
          conversationId: customerServiceTurns.conversationId,
          messageId: customerServiceTurns.representativeMessageId,
          lastEventAt: customerServiceTurns.lastEventAt,
          createdAt: customerServiceTurns.createdAt,
        }).from(customerServiceTurns).innerJoin(customerServiceWebSessions, and(
          eq(customerServiceWebSessions.conversationId, customerServiceTurns.conversationId),
          eq(customerServiceWebSessions.channel, "website"),
          eq(customerServiceWebSessions.status, "active"),
          sql`${customerServiceWebSessions.expiresAt} > ${input.now}`,
        )).where(and(
          eq(customerServiceTurns.id, input.turnId),
          eq(customerServiceTurns.channel, "website"),
          eq(customerServiceTurns.status, "sealed"),
          eq(customerServiceTurns.processingStatus, "running"),
          eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
        )).limit(1).for("update");
        if (!turn?.messageId) {
          await transaction.update(customerServiceTurns).set({
            processingStatus: "cancelled",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
            lastProcessingError: "website_session_inactive",
          }).where(and(
            eq(customerServiceTurns.id, input.turnId),
            eq(customerServiceTurns.channel, "website"),
            eq(customerServiceTurns.status, "sealed"),
            eq(customerServiceTurns.processingStatus, "running"),
            eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
          ));
          return { status: "cancelled" as const };
        }

        const [newerTurn] = await transaction.select({ id: customerServiceTurns.id })
          .from(customerServiceTurns).where(and(
            eq(customerServiceTurns.conversationId, turn.conversationId),
            sql`${customerServiceTurns.id} <> ${turn.id}`,
            or(
              sql`${customerServiceTurns.openedAt} > ${turn.lastEventAt}`,
              sql`${customerServiceTurns.createdAt} > ${turn.createdAt}`,
            ),
          )).limit(1);
        if (newerTurn) {
          await transaction.update(customerServiceTurns).set({
            processingStatus: "cancelled",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
            lastProcessingError: "newer_customer_turn_exists",
          }).where(and(
            eq(customerServiceTurns.id, turn.id),
            eq(customerServiceTurns.status, "sealed"),
            eq(customerServiceTurns.processingStatus, "running"),
            eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
          ));
          return { status: "cancelled" as const };
        }

        if (await hasHumanReplyAfterTurn(transaction, turn)) {
          await transaction.update(customerServiceTurns).set({
            processingStatus: "cancelled",
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            processingCompletedAt: input.now,
            lastProcessingError: "human_outbound_received",
          }).where(and(
            eq(customerServiceTurns.id, turn.id),
            eq(customerServiceTurns.status, "sealed"),
            eq(customerServiceTurns.processingStatus, "running"),
            eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
          ));
          return { status: "cancelled" as const };
        }

        const [attempt] = await transaction.select({
          id: customerServiceAiAttempts.id,
          draftText: customerServiceAiAttempts.draftText,
          validatorCodes: customerServiceAiAttempts.validatorCodes,
          knowledgeVersion: customerServiceAiAttempts.knowledgeVersion,
          provider: customerServiceAiAttempts.provider,
          model: customerServiceAiAttempts.model,
          completedAt: customerServiceAiAttempts.completedAt,
          intent: customerServiceAiAttempts.intent,
          websiteDecision: customerServiceAiAttempts.websiteDecision,
          websiteResponseTemplateVersion: customerServiceAiAttempts.websiteResponseTemplateVersion,
          productContext: customerServiceMessages.productContext,
          messageText: customerServiceMessages.body,
        }).from(customerServiceAiAttempts)
          .innerJoin(customerServiceMessages, eq(customerServiceMessages.id, customerServiceAiAttempts.messageId))
          .where(and(
          eq(customerServiceAiAttempts.id, input.attemptId),
          eq(customerServiceAiAttempts.messageId, turn.messageId),
          eq(customerServiceAiAttempts.trigger, "webhook_after"),
          eq(customerServiceAiAttempts.status, "draft_ready"),
          eq(customerServiceAiAttempts.gateResult, "allowed"),
          eq(customerServiceAiAttempts.providerCalled, true),
        )).limit(1).for("update");
        if (
          !attempt
          || !attempt.completedAt
          || !attempt.provider
          || !attempt.model?.trim()
          || !attempt.draftText?.trim()
          || attempt.validatorCodes.length !== 0
          || !verifyWebsiteRendererProof({
            intent: attempt.intent,
            text: attempt.draftText,
            decision: attempt.websiteDecision,
            templateVersion: attempt.websiteResponseTemplateVersion,
            productCategory: attempt.productContext?.category ?? null,
            messageText: attempt.messageText,
          })
        ) return { status: "not_publishable" as const };

        const [publication] = await transaction.insert(customerServiceWebsiteAssistantMessages).values({
          conversationId: turn.conversationId,
          channel: "website",
          messageId: turn.messageId,
          turnId: turn.id,
          aiAttemptId: attempt.id,
          kind: "validated_ai",
          body: attempt.draftText,
          policyResult: "allowed",
          gateReasons: [],
          knowledgeVersion: attempt.knowledgeVersion,
          publishedAt: input.now,
        }).onConflictDoNothing().returning({ id: customerServiceWebsiteAssistantMessages.id });
        if (!publication) return { status: "not_publishable" as const };

        const [completed] = await transaction.update(customerServiceTurns).set({
          processingStatus: "completed",
          processingLeaseToken: null,
          processingLeaseExpiresAt: null,
          processingCompletedAt: input.now,
          lastProcessingError: null,
        }).where(and(
          eq(customerServiceTurns.id, turn.id),
          eq(customerServiceTurns.status, "sealed"),
          eq(customerServiceTurns.processingStatus, "running"),
          eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
        )).returning({ id: customerServiceTurns.id });
        if (!completed) throw new Error("customer_service_website_publication_turn_lost");
        return { status: "published" as const };
      });
    },

    async retryCustomerTurnProcessing(input) {
      const retried = await database.update(customerServiceTurns).set({
        processingStatus: "pending",
        processingLeaseToken: null,
        processingLeaseExpiresAt: null,
        nextRunAt: input.nextRunAt,
        lastProcessingError: input.errorCode.slice(0, 120),
      }).where(and(
        eq(customerServiceTurns.id, input.turnId),
        eq(customerServiceTurns.status, "sealed"),
        eq(customerServiceTurns.processingStatus, "running"),
        eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
      )).returning({ id: customerServiceTurns.id });
      return retried.length === 1;
    },

    async exhaustCustomerTurnProcessing(input) {
      return database.transaction(async (transaction) => {
        const exhausted = await transaction.update(customerServiceTurns).set({
          processingStatus: "completed",
          processingLeaseToken: null,
          processingLeaseExpiresAt: null,
          processingCompletedAt: input.now,
          lastProcessingError: input.errorCode.slice(0, 120),
        }).where(and(
          eq(customerServiceTurns.id, input.turnId),
          eq(customerServiceTurns.status, "sealed"),
          eq(customerServiceTurns.processingStatus, "running"),
          eq(customerServiceTurns.processingLeaseToken, input.leaseToken),
        )).returning({ messageId: customerServiceTurns.representativeMessageId });
        if (!exhausted[0]) return false;
        if (exhausted[0].messageId) {
          await transaction.update(customerServiceMessages).set({
            ingestStatus: "provider_error",
          }).where(eq(customerServiceMessages.id, exhausted[0].messageId));
        }
        return true;
      });
    },

    async ingestFacebookMessage(input: HashedIncomingMessage) {
      return database.transaction(async (transaction) => {
        const insertedConversation = await transaction.insert(customerServiceConversations).values({
          channel: input.channel,
          externalKeyHash: input.externalConversationKeyHash,
        }).onConflictDoNothing().returning({ id: customerServiceConversations.id });
        const [conversation] = insertedConversation.length
          ? insertedConversation
          : await transaction.select({ id: customerServiceConversations.id })
            .from(customerServiceConversations)
            .where(and(
              eq(customerServiceConversations.channel, input.channel),
              eq(customerServiceConversations.externalKeyHash, input.externalConversationKeyHash),
            )).limit(1);

        const customerText = input.text?.trim() || null;
        const inserted = await transaction.insert(customerServiceMessages).values({
          conversationId: conversation.id,
          channel: input.channel,
          externalMessageKeyHash: input.externalMessageKeyHash,
          body: customerText ?? "[Image attachment]",
          customerText,
          receivedAt: input.receivedAt,
        }).onConflictDoNothing().returning({ id: customerServiceMessages.id });
        if (!inserted.length) {
          const [existing] = await transaction.select({ id: customerServiceMessages.id })
            .from(customerServiceMessages)
            .where(and(
              eq(customerServiceMessages.channel, input.channel),
              eq(customerServiceMessages.externalMessageKeyHash, input.externalMessageKeyHash),
            )).limit(1);
          return { status: "duplicate" as const, messageId: existing.id };
        }

        const messageId = inserted[0].id;
        if (input.attachments.length) {
          await transaction.insert(customerServiceAttachments).values(input.attachments.map((attachment) => ({
            messageId,
            conversationId: conversation.id,
            externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
            ordinal: attachment.ordinal,
            kind: "image" as const,
            normalizedKind: attachment.kind,
            mimeTypeHint: attachment.mimeTypeHint,
            status: attachment.kind === "unsupported" ? "rejected" as const : "metadata_received" as const,
            failureCode: attachment.failureCode ?? null,
          })));
        }
        const [pilot] = await transaction.select().from(customerServicePilotRuns)
          .where(and(
            eq(customerServicePilotRuns.channel, input.channel),
            eq(customerServicePilotRuns.status, "active"),
          )).limit(1).for("update");
        if (!pilot || pilot.nextSequence > pilot.messageLimit) {
          if (pilot) {
            await transaction.update(customerServicePilotRuns)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(customerServicePilotRuns.id, pilot.id));
          }
          return { status: "pilot_complete" as const, messageId };
        }

        await transaction.update(customerServiceMessages).set({
          pilotRunId: pilot.id,
          pilotSequence: pilot.nextSequence,
        }).where(eq(customerServiceMessages.id, messageId));
        await transaction.update(customerServicePilotRuns).set({
          nextSequence: pilot.nextSequence + 1,
        }).where(eq(customerServicePilotRuns.id, pilot.id));
        if (input.imageJob) {
          await transaction.insert(customerServiceImageJobs).values({
            id: input.imageJob.id,
            messageId,
            conversationId: conversation.id,
            status: input.imageJob.status,
            sourceCiphertext: input.imageJob.sourceCiphertext,
            sourceExpiresAt: input.imageJob.sourceExpiresAt,
            failureCode: input.imageJob.failureCode,
            nextRunAt: input.receivedAt,
            ...(input.imageJob.status === "human_review_required" ? { completedAt: input.receivedAt } : {}),
          });
        }
        return { status: "created" as const, messageId, pilotSequence: pilot.nextSequence };
      });
    },

    async loadDraftInput(messageId, contextLimit) {
      const [current] = await database.select({
        id: customerServiceMessages.id,
        text: customerServiceMessages.customerText,
        channel: customerServiceMessages.channel,
        productContext: customerServiceMessages.productContext,
        conversationId: customerServiceMessages.conversationId,
        receivedAt: customerServiceMessages.receivedAt,
        createdAt: customerServiceMessages.createdAt,
      }).from(customerServiceMessages).where(eq(customerServiceMessages.id, messageId)).limit(1);
      if (!current) return null;
      const [currentTurn] = await database.select({
        id: customerServiceTurns.id,
        lastEventAt: customerServiceTurns.lastEventAt,
      }).from(customerServiceTurns).where(eq(
        customerServiceTurns.representativeMessageId,
        current.id,
      )).limit(1);
      const boundary = currentTurn?.lastEventAt ?? current.receivedAt;
      const causalBoundary = current.createdAt;
      const boundedLimit = Math.max(1, Math.min(12, contextLimit));
      const events = await database.select({
        id: customerServiceConversationEvents.id,
        role: customerServiceConversationEvents.role,
        text: customerServiceConversationEvents.body,
        receivedAt: customerServiceConversationEvents.receivedAt,
        createdAt: customerServiceConversationEvents.createdAt,
        turnId: customerServiceConversationEvents.turnId,
        turnBody: customerServiceTurns.body,
        turnOpenedAt: customerServiceTurns.openedAt,
      }).from(customerServiceConversationEvents)
        .leftJoin(customerServiceTurns, eq(customerServiceTurns.id, customerServiceConversationEvents.turnId))
        .where(and(
          eq(customerServiceConversationEvents.conversationId, current.conversationId),
          eq(customerServiceConversationEvents.channel, current.channel),
          lte(customerServiceConversationEvents.receivedAt, boundary),
          or(
            eq(customerServiceConversationEvents.legacyMessageId, current.id),
            lte(customerServiceConversationEvents.createdAt, causalBoundary),
          ),
        ))
        .orderBy(
          desc(customerServiceConversationEvents.receivedAt),
          desc(customerServiceConversationEvents.createdAt),
          desc(customerServiceConversationEvents.id),
        )
        .limit(boundedLimit * 8);
      const legacyMessages = await database.select({
        id: customerServiceMessages.id,
        text: customerServiceMessages.customerText,
        receivedAt: customerServiceMessages.receivedAt,
        createdAt: customerServiceMessages.createdAt,
      }).from(customerServiceMessages).where(and(
        eq(customerServiceMessages.conversationId, current.conversationId),
        eq(customerServiceMessages.channel, current.channel),
        lte(customerServiceMessages.receivedAt, boundary),
        or(
          eq(customerServiceMessages.id, current.id),
          lte(customerServiceMessages.createdAt, causalBoundary),
        ),
        isNotNull(customerServiceMessages.customerText),
        sql`not exists (
          select 1 from ${customerServiceConversationEvents}
          where ${customerServiceConversationEvents.legacyMessageId} = ${customerServiceMessages.id}
        )`,
      )).orderBy(
        desc(customerServiceMessages.receivedAt),
        desc(customerServiceMessages.createdAt),
        desc(customerServiceMessages.id),
      ).limit(boundedLimit);
      const websiteAssistantMessages = current.channel === "website"
        ? await database.select({
          id: customerServiceWebsiteAssistantMessages.id,
          text: customerServiceWebsiteAssistantMessages.body,
          publishedAt: customerServiceWebsiteAssistantMessages.publishedAt,
          createdAt: customerServiceWebsiteAssistantMessages.createdAt,
        }).from(customerServiceWebsiteAssistantMessages).where(and(
          eq(customerServiceWebsiteAssistantMessages.conversationId, current.conversationId),
          lte(customerServiceWebsiteAssistantMessages.publishedAt, boundary),
          lte(customerServiceWebsiteAssistantMessages.createdAt, causalBoundary),
        )).orderBy(
          desc(customerServiceWebsiteAssistantMessages.publishedAt),
          desc(customerServiceWebsiteAssistantMessages.createdAt),
          desc(customerServiceWebsiteAssistantMessages.id),
        ).limit(boundedLimit * 8)
        : [];
      const seenTurns = new Set<string>();
      const context = [
        ...events.reverse().flatMap((event) => {
          if (event.role === "customer" && event.turnId) {
            if (seenTurns.has(event.turnId)) return [];
            seenTurns.add(event.turnId);
            return [{
              role: "customer" as const,
              text: event.turnBody ?? event.text,
              receivedAt: (event.turnOpenedAt ?? event.receivedAt).toISOString(),
              sortAt: event.turnOpenedAt ?? event.receivedAt,
              causalAt: event.createdAt,
              sourceRank: 0,
              sortId: event.turnId,
            }];
          }
          return [{
            role: event.role,
            text: event.text,
            receivedAt: event.receivedAt.toISOString(),
            sortAt: event.receivedAt,
            causalAt: event.createdAt,
            sourceRank: event.role === "customer" ? 0 : 2,
            sortId: event.id,
          }];
        }),
        ...legacyMessages.map((message) => ({
          role: "customer" as const,
          text: message.text ?? "",
          receivedAt: message.receivedAt.toISOString(),
          sortAt: message.receivedAt,
          causalAt: message.createdAt,
          sourceRank: 0,
          sortId: message.id,
        })),
        ...websiteAssistantMessages.reverse().map((message) => ({
          role: "staff" as const,
          text: message.text,
          receivedAt: message.publishedAt.toISOString(),
          sortAt: message.publishedAt,
          causalAt: message.createdAt,
          sourceRank: 1,
          sortId: message.id,
        })),
      ].sort((left, right) => (
        left.sortAt.getTime() - right.sortAt.getTime()
        || left.causalAt.getTime() - right.causalAt.getTime()
        || left.sourceRank - right.sourceRank
        || left.sortId.localeCompare(right.sortId)
      )).slice(-boundedLimit).map(({ role, text, receivedAt }) => ({ role, text, receivedAt }));
      return {
        current: {
          id: current.id,
          text: current.text,
          channel: current.channel,
          productContext: current.channel === "website" ? current.productContext : null,
        },
        context,
      };
    },

    async selectImageContext(messageId) {
      const [current] = await database.select({
        id: customerServiceMessages.id,
        conversationId: customerServiceMessages.conversationId,
      }).from(customerServiceMessages).where(eq(customerServiceMessages.id, messageId)).limit(1);
      if (!current) return null;

      const ownAttachments = await database.select({
        id: customerServiceAttachments.id,
        status: customerServiceAttachments.status,
        normalizedKind: customerServiceAttachments.normalizedKind,
      })
        .from(customerServiceAttachments)
        .where(and(
          eq(customerServiceAttachments.messageId, current.id),
          eq(customerServiceAttachments.conversationId, current.conversationId),
        ))
        .orderBy(asc(customerServiceAttachments.ordinal));
      if (ownAttachments.length) {
        const attachmentIds = ownAttachments.slice(0, 5).map((attachment) => attachment.id);
        const hasUnsupportedAttachments = ownAttachments.some((attachment) => (
          attachment.normalizedKind === "unsupported" || attachment.status === "rejected"
        ));
        return {
          messageId: current.id,
          attachmentIds,
          analysisSummary: hasUnsupportedAttachments
            ? null
            : await validatedAnalysisSummary(database, current.id, attachmentIds),
          hasUnsupportedAttachments,
        };
      }
      return null;
    },

    async reconcileStaleImageJobs(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
        throw new Error("customer_service_image_job_limit_invalid");
      }
      return database.transaction(async (transaction) => {
        const stale = await transaction.select().from(customerServiceImageJobs).where(and(
          eq(customerServiceImageJobs.status, "running"),
          lte(customerServiceImageJobs.leaseExpiresAt, input.now),
        )).orderBy(asc(customerServiceImageJobs.leaseExpiresAt))
          .limit(input.limit)
          .for("update", { skipLocked: true });
        let resumed = 0;
        let terminal = 0;
        let reservationsReleased = 0;
        for (const job of stale) {
          const providerAmbiguous = job.stage === "vision" || job.stage === "draft";
          if (job.stage === "vision" && job.imageAnalysisAttemptId) {
            const [attempt] = await transaction.select({
              status: customerServiceImageAnalysisAttempts.status,
              providerCalled: customerServiceImageAnalysisAttempts.providerCalled,
            }).from(customerServiceImageAnalysisAttempts).where(
              eq(customerServiceImageAnalysisAttempts.id, job.imageAnalysisAttemptId),
            ).limit(1).for("update");
            if (attempt && (attempt.status === "pending" || attempt.status === "provider_pending")) {
              await transaction.update(customerServiceImageAnalysisAttempts).set({
                status: "provider_error",
                providerErrorCode: attempt.providerCalled
                  ? "image_provider_state_ambiguous"
                  : "image_job_interrupted",
                reservedCostMicrousd: 0,
                completedAt: input.now,
              }).where(and(
                eq(customerServiceImageAnalysisAttempts.id, job.imageAnalysisAttemptId),
                inArray(customerServiceImageAnalysisAttempts.status, ["pending", "provider_pending"]),
              ));
            }
          }
          if (job.stage === "draft" && job.textAttemptId) {
            await transaction.update(customerServiceAiAttempts).set({
              status: "abandoned",
              providerErrorCode: "text_provider_state_ambiguous",
              reservedCostMicrousd: 0,
              completedAt: input.now,
            }).where(and(
              eq(customerServiceAiAttempts.id, job.textAttemptId),
              eq(customerServiceAiAttempts.status, "provider_pending"),
            ));
          }
          if (providerAmbiguous && !job.budgetSettledAt) {
            if (await settleImageJobBudget(transaction, job)) reservationsReleased += job.reservedCostMicrousd > 0 ? 1 : 0;
          }
          if (job.stage === "draft") {
            await transaction.update(customerServiceImageJobs).set({
              status: "human_review_required",
              failureCode: "text_provider_state_ambiguous",
              leaseToken: null,
              leaseExpiresAt: null,
              completedAt: input.now,
            }).where(eq(customerServiceImageJobs.id, job.id));
            terminal += 1;
          } else if (providerAmbiguous) {
            await transaction.update(customerServiceImageJobs).set({
              stage: "cleanup",
              status: "pending",
              terminalAfterCleanup: true,
              failureCode: providerAmbiguous ? "image_provider_state_ambiguous" : "image_download_interrupted",
              leaseToken: null,
              leaseExpiresAt: null,
              nextRunAt: input.now,
            }).where(eq(customerServiceImageJobs.id, job.id));
            terminal += 1;
          } else {
            await transaction.update(customerServiceImageJobs).set({
              status: "pending",
              leaseToken: null,
              leaseExpiresAt: null,
              nextRunAt: input.now,
            }).where(eq(customerServiceImageJobs.id, job.id));
            resumed += 1;
          }
        }
        return { examined: stale.length, resumed, terminal, reservationsReleased };
      });
    },

    async claimImageJob(input) {
      if (input.leaseExpiresAt.getTime() <= input.now.getTime()) {
        throw new Error("customer_service_image_job_lease_invalid");
      }
      return database.transaction(async (transaction) => {
        const [job] = await transaction.select().from(customerServiceImageJobs).where(and(
          eq(customerServiceImageJobs.status, "pending"),
          lte(customerServiceImageJobs.nextRunAt, input.now),
          sql`exists (
            select 1
            from ${customerServiceMessages}
            where ${customerServiceMessages.id} = ${customerServiceImageJobs.messageId}
              and ${customerServiceMessages.pilotRunId} is not null
          )`,
          input.jobId ? eq(customerServiceImageJobs.id, input.jobId) : undefined,
        )).orderBy(asc(customerServiceImageJobs.nextRunAt), asc(customerServiceImageJobs.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!job) return null;
        const leaseToken = randomUUID();
        const updated = await transaction.update(customerServiceImageJobs).set({
          status: "running",
          leaseToken,
          leaseExpiresAt: input.leaseExpiresAt,
        }).where(and(
          eq(customerServiceImageJobs.id, job.id),
          eq(customerServiceImageJobs.status, "pending"),
        )).returning({ id: customerServiceImageJobs.id });
        if (!updated.length) return null;
        const [unsupported] = await transaction.select({ count: sql<number>`count(*)::int` })
          .from(customerServiceAttachments)
          .where(and(
            eq(customerServiceAttachments.messageId, job.messageId),
            eq(customerServiceAttachments.status, "rejected"),
          ));
        return {
          id: job.id,
          messageId: job.messageId,
          stage: job.stage,
          leaseToken,
          sourceCiphertext: job.sourceCiphertext,
          sourceExpiresAt: job.sourceExpiresAt,
          imageAnalysisAttemptId: job.imageAnalysisAttemptId,
          hasUnsupportedAttachments: (unsupported?.count ?? 0) > 0,
          terminalAfterCleanup: job.terminalAfterCleanup,
          failureCode: job.failureCode,
        };
      });
    },

    async completeImageJobStage(input) {
      const clearSource = ["vision", "cleanup", "draft"].includes(input.nextStage);
      const updated = await database.update(customerServiceImageJobs).set({
        stage: input.nextStage,
        status: "pending",
        leaseToken: null,
        leaseExpiresAt: null,
        ...(input.terminalAfterCleanup === undefined ? {} : { terminalAfterCleanup: input.terminalAfterCleanup }),
        ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
        ...(clearSource ? { sourceCiphertext: null, sourceExpiresAt: null } : {}),
      }).where(and(
        eq(customerServiceImageJobs.id, input.jobId),
        eq(customerServiceImageJobs.status, "running"),
        eq(customerServiceImageJobs.leaseToken, input.leaseToken),
      )).returning({ id: customerServiceImageJobs.id });
      return updated.length === 1;
    },

    async finishImageJob(input) {
      return database.transaction(async (transaction) => {
        const [job] = await transaction.select().from(customerServiceImageJobs).where(and(
          eq(customerServiceImageJobs.id, input.jobId),
          eq(customerServiceImageJobs.status, "running"),
          eq(customerServiceImageJobs.leaseToken, input.leaseToken),
        )).limit(1).for("update");
        if (!job) return false;
        if (input.textAttemptId && job.textAttemptId && job.textAttemptId !== input.textAttemptId) {
          throw new Error("customer_service_image_job_text_attempt_mismatch");
        }
        await settleImageJobBudget(transaction, job, input.textAttemptId ?? job.textAttemptId);
        await transaction.update(customerServiceImageJobs).set({
          status: input.status,
          failureCode: input.failureCode,
          textAttemptId: input.textAttemptId ?? job.textAttemptId,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          sourceCiphertext: null,
          sourceExpiresAt: null,
        }).where(eq(customerServiceImageJobs.id, job.id));
        return true;
      });
    },

    async ensureImageAnalysisAttemptForJob(input) {
      return database.transaction(async (transaction) => {
        const [job] = await transaction.select().from(customerServiceImageJobs).where(and(
          eq(customerServiceImageJobs.id, input.jobId),
          eq(customerServiceImageJobs.status, "running"),
          eq(customerServiceImageJobs.leaseToken, input.leaseToken),
          eq(customerServiceImageJobs.stage, "download"),
        )).limit(1).for("update");
        if (!job) throw new Error("customer_service_image_job_lease_mismatch");
        let attemptId = job.imageAnalysisAttemptId;
        if (!attemptId) {
          const attachments = await transaction.select({
            id: customerServiceAttachments.id,
            ordinal: customerServiceAttachments.ordinal,
            externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
            status: customerServiceAttachments.status,
          }).from(customerServiceAttachments).where(and(
            eq(customerServiceAttachments.messageId, job.messageId),
            eq(customerServiceAttachments.conversationId, job.conversationId),
          )).orderBy(asc(customerServiceAttachments.ordinal));
          if (
            attachments.length !== input.sources.length
            || input.sources.some((source, index) => {
              const attachment = attachments[index];
              return !attachment
                || attachment.status === "rejected"
                || attachment.ordinal !== source.ordinal
                || attachment.externalAttachmentKeyHash !== source.externalAttachmentKeyHash;
            })
          ) throw new Error("customer_service_image_context_mismatch");
          const [attempt] = await transaction.insert(customerServiceImageAnalysisAttempts).values({
            messageId: job.messageId,
            conversationId: job.conversationId,
            attemptNumber: await nextImageAttemptNumber(transaction, job.messageId),
            status: "pending",
            schemaVersion: "1",
          }).returning({ id: customerServiceImageAnalysisAttempts.id });
          attemptId = attempt.id;
          await transaction.insert(customerServiceImageAnalysisInputs).values(attachments.map((attachment) => ({
            analysisAttemptId: attempt.id,
            attachmentId: attachment.id,
            conversationId: job.conversationId,
            ordinal: attachment.ordinal,
            externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
          })));
          await transaction.update(customerServiceImageJobs).set({ imageAnalysisAttemptId: attempt.id })
            .where(eq(customerServiceImageJobs.id, job.id));
        }
        const inputs = await transaction.select({
          attachmentId: customerServiceImageAnalysisInputs.attachmentId,
          ordinal: customerServiceImageAnalysisInputs.ordinal,
          externalAttachmentKeyHash: customerServiceImageAnalysisInputs.externalAttachmentKeyHash,
          cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
          privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
          verifiedMimeType: customerServiceImageAnalysisInputs.verifiedMimeType,
          byteSize: customerServiceImageAnalysisInputs.byteSize,
          sha256: customerServiceImageAnalysisInputs.sha256,
        }).from(customerServiceImageAnalysisInputs)
          .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attemptId))
          .orderBy(asc(customerServiceImageAnalysisInputs.ordinal));
        return { attemptId, inputs };
      });
    },

    async prepareImageAttachmentStorage(input) {
      await database.transaction(async (transaction) => {
        const [job] = await transaction.select({ id: customerServiceImageJobs.id })
          .from(customerServiceImageJobs).where(and(
            eq(customerServiceImageJobs.id, input.jobId),
            eq(customerServiceImageJobs.status, "running"),
            eq(customerServiceImageJobs.stage, "download"),
            eq(customerServiceImageJobs.leaseToken, input.leaseToken),
            eq(customerServiceImageJobs.imageAnalysisAttemptId, input.attemptId),
          )).limit(1).for("update");
        if (!job) throw new Error("customer_service_image_job_lease_mismatch");
        const [attemptInput] = await transaction.select({
          cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
          privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
        }).from(customerServiceImageAnalysisInputs).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, input.attachmentId),
        )).limit(1).for("update");
        if (!attemptInput || attemptInput.cleanupStatus !== "pending") {
          throw new Error("customer_service_image_storage_state_mismatch");
        }
        if (attemptInput.privateStorageKey && attemptInput.privateStorageKey !== input.privateStorageKey) {
          throw new Error("customer_service_image_storage_key_mismatch");
        }
        await transaction.update(customerServiceImageAnalysisInputs).set({
          privateStorageKey: input.privateStorageKey,
          privateStorageKeyHash: createHash("sha256").update(input.privateStorageKey).digest("hex"),
          deleteDueAt: input.deleteDueAt,
          failureCode: null,
        }).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, input.attachmentId),
        ));
      });
    },

    async loadImageAnalysisInputs(attemptId) {
      return database.select({
        attachmentId: customerServiceImageAnalysisInputs.attachmentId,
        ordinal: customerServiceImageAnalysisInputs.ordinal,
        cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
        privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
        verifiedMimeType: customerServiceImageAnalysisInputs.verifiedMimeType,
        byteSize: customerServiceImageAnalysisInputs.byteSize,
        sha256: customerServiceImageAnalysisInputs.sha256,
      }).from(customerServiceImageAnalysisInputs)
        .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attemptId))
        .orderBy(asc(customerServiceImageAnalysisInputs.ordinal));
    },

    async reserveImageJobBudget(input) {
      return database.transaction(async (transaction) => {
        const [job] = await transaction.select().from(customerServiceImageJobs).where(and(
          eq(customerServiceImageJobs.id, input.jobId),
          eq(customerServiceImageJobs.status, "running"),
          eq(customerServiceImageJobs.stage, "vision"),
          eq(customerServiceImageJobs.leaseToken, input.leaseToken),
        )).limit(1).for("update");
        if (!job) throw new Error("customer_service_image_job_lease_mismatch");
        if (job.reservedCostMicrousd > 0) {
          if (
            job.reservedCostMicrousd === input.reservationMicrousd
            && job.budgetDailyScopeKey === input.dailyScopeKey
          ) return { status: "reserved" as const };
          throw new Error("customer_service_image_job_reservation_mismatch");
        }
        const rows = await ensureBudgetRows(transaction, [input.dailyScopeKey, "total"].sort());
        const daily = rows.find((row) => row.scopeKey === input.dailyScopeKey);
        const total = rows.find((row) => row.scopeKey === "total");
        const blocked = !daily || !total
          || daily.spentMicrousd + daily.reservedMicrousd + input.reservationMicrousd > input.dailyHardStopMicrousd
          || total.spentMicrousd + total.reservedMicrousd + input.reservationMicrousd > input.totalHardStopMicrousd;
        if (blocked) return { status: "budget_blocked" as const };
        await transaction.update(customerServiceBudgetState).set({
          reservedMicrousd: sql`${customerServiceBudgetState.reservedMicrousd} + ${input.reservationMicrousd}`,
        }).where(sql`${customerServiceBudgetState.scopeKey} in (${input.dailyScopeKey}, 'total')`);
        await transaction.update(customerServiceImageJobs).set({
          reservedCostMicrousd: input.reservationMicrousd,
          budgetDailyScopeKey: input.dailyScopeKey,
        }).where(eq(customerServiceImageJobs.id, job.id));
        return { status: "reserved" as const };
      });
    },

    async markImageAnalysisProviderStarted(input) {
      return database.transaction(async (transaction) => {
        const [job] = await transaction.select({ imageAnalysisAttemptId: customerServiceImageJobs.imageAnalysisAttemptId })
          .from(customerServiceImageJobs).where(and(
            eq(customerServiceImageJobs.id, input.jobId),
            eq(customerServiceImageJobs.status, "running"),
            eq(customerServiceImageJobs.stage, "vision"),
            eq(customerServiceImageJobs.leaseToken, input.leaseToken),
          )).limit(1).for("update");
        if (!job || job.imageAnalysisAttemptId !== input.attemptId) return false;
        const updated = await transaction.update(customerServiceImageAnalysisAttempts).set({
          status: "provider_pending",
          providerCalled: true,
        }).where(and(
          eq(customerServiceImageAnalysisAttempts.id, input.attemptId),
          eq(customerServiceImageAnalysisAttempts.status, "pending"),
        )).returning({ id: customerServiceImageAnalysisAttempts.id });
        return updated.length === 1;
      });
    },

    async cleanupImageAttemptInputs(input) {
      return cleanupImageInputs({ ...input, attemptId: input.attemptId });
    },

    async loadImageJobAssessment(jobId) {
      const [job] = await database.select({
        messageId: customerServiceImageJobs.messageId,
        imageAnalysisAttemptId: customerServiceImageJobs.imageAnalysisAttemptId,
      }).from(customerServiceImageJobs).where(eq(customerServiceImageJobs.id, jobId)).limit(1);
      if (!job?.imageAnalysisAttemptId) return null;
      const inputs = await database.select({ attachmentId: customerServiceImageAnalysisInputs.attachmentId })
        .from(customerServiceImageAnalysisInputs)
        .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, job.imageAnalysisAttemptId))
        .orderBy(asc(customerServiceImageAnalysisInputs.ordinal));
      return validatedAnalysisSummary(database, job.messageId, inputs.map((item) => item.attachmentId));
    },

    async createImageAnalysisAttempt(input) {
      return database.transaction(async (transaction) => {
        if (
          input.attachments.length < 1
          || input.attachments.length > 5
          || new Set(input.attachments.map((attachment) => attachment.ordinal)).size !== input.attachments.length
        ) throw new Error("customer_service_image_context_mismatch");
        const [message] = await transaction.select({ conversationId: customerServiceMessages.conversationId })
          .from(customerServiceMessages)
          .where(eq(customerServiceMessages.id, input.messageId))
          .limit(1);
        if (!message) throw new Error("customer_service_message_not_found");
        const attachments = await transaction.select({
          id: customerServiceAttachments.id,
          conversationId: customerServiceAttachments.conversationId,
          ordinal: customerServiceAttachments.ordinal,
          externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
        }).from(customerServiceAttachments).where(sql`${customerServiceAttachments.id} in (${sql.join(
          input.attachments.map((attachment) => sql`${attachment.attachmentId}`),
          sql`, `,
        )})`);
        if (
          attachments.length !== input.attachments.length
          || input.attachments.some((expected) => {
            const attachment = attachments.find((candidate) => candidate.id === expected.attachmentId);
            return !attachment
              || attachment.conversationId !== message.conversationId
              || attachment.ordinal !== expected.ordinal
              || attachment.externalAttachmentKeyHash !== expected.externalAttachmentKeyHash;
          })
        ) throw new Error("customer_service_image_context_mismatch");

        const [attempt] = await transaction.insert(customerServiceImageAnalysisAttempts).values({
          messageId: input.messageId,
          conversationId: message.conversationId,
          attemptNumber: await nextImageAttemptNumber(transaction, input.messageId),
          status: "pending",
          schemaVersion: input.schemaVersion,
        }).returning({ id: customerServiceImageAnalysisAttempts.id });
        await transaction.insert(customerServiceImageAnalysisInputs).values(input.attachments.map((attachment) => ({
          analysisAttemptId: attempt.id,
          attachmentId: attachment.attachmentId,
          conversationId: message.conversationId,
          ordinal: attachment.ordinal,
          externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
        })));
        return attempt.id;
      });
    },

    async markImageAttachmentStored(input) {
      await database.transaction(async (transaction) => {
        const [attemptInput] = await transaction.select({
          cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
          privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
        }).from(customerServiceImageAnalysisInputs).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, input.attachmentId),
        )).limit(1).for("update");
        if (!attemptInput) throw new Error("customer_service_image_context_mismatch");
        if (attemptInput.cleanupStatus === "stored" && attemptInput.privateStorageKey === input.privateStorageKey) {
          return;
        }
        if (attemptInput.cleanupStatus !== "pending") {
          throw new Error("customer_service_image_storage_state_mismatch");
        }
        if (attemptInput.privateStorageKey && attemptInput.privateStorageKey !== input.privateStorageKey) {
          throw new Error("customer_service_image_storage_key_mismatch");
        }
        await transaction.update(customerServiceImageAnalysisInputs).set({
          cleanupStatus: "stored",
          verifiedMimeType: input.verifiedMimeType,
          width: input.width,
          height: input.height,
          byteSize: input.byteSize,
          sha256: input.sha256,
          privateStorageKey: input.privateStorageKey,
          privateStorageKeyHash: createHash("sha256").update(input.privateStorageKey).digest("hex"),
          deleteDueAt: input.deleteDueAt,
          deletedAt: null,
          failureCode: null,
        }).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, input.attachmentId),
        ));
      });
    },

    async reserveImageAnalysisAttempt(input) {
      return database.transaction(async (transaction) => {
        const [attempt] = await transaction.select({
          status: customerServiceImageAnalysisAttempts.status,
          reservedCostMicrousd: customerServiceImageAnalysisAttempts.reservedCostMicrousd,
          budgetDailyScopeKey: customerServiceImageAnalysisAttempts.budgetDailyScopeKey,
        })
          .from(customerServiceImageAnalysisAttempts)
          .where(eq(customerServiceImageAnalysisAttempts.id, input.attemptId))
          .limit(1)
          .for("update");
        if (!attempt) {
          throw new Error("customer_service_image_attempt_not_pending");
        }
        if (attempt.status === "provider_pending") {
          if (
            attempt.reservedCostMicrousd === input.reservationMicrousd
            && attempt.budgetDailyScopeKey === input.dailyScopeKey
          ) return { status: "reserved" as const };
          throw new Error("customer_service_image_reservation_mismatch");
        }
        if (attempt.status !== "pending") throw new Error("customer_service_image_attempt_not_pending");
        const rows = await ensureBudgetRows(transaction, [input.dailyScopeKey, "total"].sort());
        const daily = rows.find((row) => row.scopeKey === input.dailyScopeKey);
        const total = rows.find((row) => row.scopeKey === "total");
        const blocked = !daily || !total
          || daily.spentMicrousd + daily.reservedMicrousd + input.reservationMicrousd > input.dailyHardStopMicrousd
          || total.spentMicrousd + total.reservedMicrousd + input.reservationMicrousd > input.totalHardStopMicrousd;
        if (blocked) return { status: "budget_blocked" as const };
        await transaction.update(customerServiceBudgetState).set({
          reservedMicrousd: sql`${customerServiceBudgetState.reservedMicrousd} + ${input.reservationMicrousd}`,
        }).where(sql`${customerServiceBudgetState.scopeKey} in (${input.dailyScopeKey}, 'total')`);
        await transaction.update(customerServiceImageAnalysisAttempts).set({
          status: "provider_pending",
          providerCalled: true,
          reservedCostMicrousd: input.reservationMicrousd,
          budgetDailyScopeKey: input.dailyScopeKey,
        }).where(eq(customerServiceImageAnalysisAttempts.id, input.attemptId));
        return { status: "reserved" as const };
      });
    },

    async completeImageAnalysisAttempt(input) {
      await database.transaction(async (transaction) => {
        const [attempt] = await transaction.select({
          status: customerServiceImageAnalysisAttempts.status,
          providerCalled: customerServiceImageAnalysisAttempts.providerCalled,
          reservedCostMicrousd: customerServiceImageAnalysisAttempts.reservedCostMicrousd,
          budgetDailyScopeKey: customerServiceImageAnalysisAttempts.budgetDailyScopeKey,
        })
          .from(customerServiceImageAnalysisAttempts)
          .where(eq(customerServiceImageAnalysisAttempts.id, input.attemptId))
          .limit(1)
          .for("update");
        if (!attempt) throw new Error("customer_service_image_attempt_not_found");
        if (!["pending", "provider_pending"].includes(attempt.status)) return;
        const providerCalled = attempt.providerCalled || input.providerCalled;
        if (attempt.reservedCostMicrousd > 0) {
          if (!attempt.budgetDailyScopeKey) throw new Error("customer_service_image_reservation_invalid");
          await ensureBudgetRows(transaction, [attempt.budgetDailyScopeKey, "total"].sort());
          const settledCost = input.estimatedCostMicrousd ?? (
            providerCalled ? attempt.reservedCostMicrousd : 0
          );
          await transaction.update(customerServiceBudgetState).set({
            reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${attempt.reservedCostMicrousd})`,
            spentMicrousd: sql`${customerServiceBudgetState.spentMicrousd} + ${settledCost}`,
          }).where(sql`${customerServiceBudgetState.scopeKey} in (${attempt.budgetDailyScopeKey}, 'total')`);
        }
        await transaction.update(customerServiceImageAnalysisAttempts).set({
          status: input.status,
          providerCalled: sql`${customerServiceImageAnalysisAttempts.providerCalled} OR ${input.providerCalled}`,
          provider: input.provider ?? null,
          model: input.model ?? null,
          analysisResult: input.analysisResult ?? null,
          validatorCodes: input.validatorCodes,
          inputTokens: input.inputTokens,
          cachedInputTokens: input.cachedInputTokens,
          outputTokens: input.outputTokens,
          estimatedCostMicrousd: input.estimatedCostMicrousd,
          reservedCostMicrousd: 0,
          latencyMs: input.latencyMs,
          providerErrorCode: input.providerErrorCode ?? null,
          completedAt: new Date(),
        }).where(eq(customerServiceImageAnalysisAttempts.id, input.attemptId));
      });
    },

    async markImageAttachmentDeleted(input) {
      await database.transaction(async (transaction) => {
        const [attemptInput] = await transaction.select({
          cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
          privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
          privateStorageKeyHash: customerServiceImageAnalysisInputs.privateStorageKeyHash,
        }).from(customerServiceImageAnalysisInputs).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, input.attachmentId),
        )).limit(1).for("update");
        if (!attemptInput) throw new Error("customer_service_image_context_mismatch");
        const expectedKeyHash = createHash("sha256").update(input.privateStorageKey).digest("hex");
        if (attemptInput.cleanupStatus === "deleted") {
          if (attemptInput.privateStorageKeyHash !== expectedKeyHash) {
            throw new Error("customer_service_image_storage_key_mismatch");
          }
          return;
        }
        if (
          attemptInput.privateStorageKey !== null
          && attemptInput.privateStorageKey !== input.privateStorageKey
        ) throw new Error("customer_service_image_storage_key_mismatch");
        if (
          attemptInput.privateStorageKey === null
          && attemptInput.privateStorageKeyHash !== null
          && attemptInput.privateStorageKeyHash !== expectedKeyHash
        ) throw new Error("customer_service_image_storage_key_mismatch");
        await transaction.update(customerServiceImageAnalysisInputs).set(input.deleted ? {
          cleanupStatus: "deleted",
          privateStorageKey: null,
          privateStorageKeyHash: expectedKeyHash,
          deleteDueAt: null,
          deletedAt: new Date(),
          failureCode: null,
        } : {
          cleanupStatus: "failed",
          privateStorageKey: input.privateStorageKey,
          privateStorageKeyHash: expectedKeyHash,
          deleteDueAt: input.deleteDueAt,
          deletedAt: null,
          failureCode: input.failureCode,
        }).where(and(
          eq(customerServiceImageAnalysisInputs.analysisAttemptId, input.attemptId),
          eq(customerServiceImageAnalysisInputs.attachmentId, input.attachmentId),
        ));
      });
    },

    async cleanupExpiredImageAttachments(input) {
      return cleanupImageInputs({ ...input, dueAt: input.now });
    },

    async createGateBlockedAttempt(input) {
      return database.transaction((transaction) => insertGateAttempt(transaction, input));
    },

    async reserveProviderAttempt(input: ProviderAttemptReservation) {
      return database.transaction(async (transaction) => {
        let turn = await turnForMessage(transaction, input.messageId);
        if (turn) {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'turn:' + turn.conversationId}))`);
          turn = await turnForMessage(transaction, input.messageId);
        }
        if (turn && (
          (turn.status === "suppressed" && turn.suppressionReason === "human_outbound_received")
          || await hasHumanReplyAfterTurn(transaction, turn)
        )) {
          const [attempt] = await transaction.insert(customerServiceAiAttempts).values({
            messageId: input.messageId,
            attemptNumber: await nextAttemptNumber(transaction, input.messageId),
            trigger: input.trigger,
            intent: input.intent,
            riskLevel: input.riskLevel,
            gateResult: "allowed",
            gateReasons: [...input.gateReasons, "human_outbound_received"],
            knowledgeSources: input.knowledgeSources,
            knowledgeVersion: input.knowledgeVersion,
            status: "abandoned",
            providerCalled: false,
            reservedCostMicrousd: 0,
            completedAt: new Date(),
          }).returning({ id: customerServiceAiAttempts.id });
          return { status: "human_reply_received" as const, attemptId: attempt.id };
        }

        const [persistedMessage] = await transaction.select({ channel: customerServiceMessages.channel })
          .from(customerServiceMessages)
          .where(eq(customerServiceMessages.id, input.messageId))
          .limit(1);
        if (!persistedMessage) throw new Error("customer_service_message_not_found");
        const website = persistedMessage.channel === "website";
        if (website && (!input.websiteDailyWarningMicrousd
          || !input.websiteDailyHardStopMicrousd
          || !input.websiteTotalHardStopMicrousd)) {
          throw new Error("customer_service_website_budget_config_missing");
        }
        const rows = await ensureBudgetRows(transaction, [input.dailyScopeKey, "total"].sort());
        const daily = rows.find((row) => row.scopeKey === input.dailyScopeKey);
        const total = rows.find((row) => row.scopeKey === "total");
        const websiteScopeKeys = websiteBudgetScopeKeys(input.dailyScopeKey, website);
        const websiteRows = website
          ? await ensureWebsiteBudgetRows(transaction, [...websiteScopeKeys].sort())
          : [];
        const websiteDailyScopeKey = website ? websiteScopeKeys[0] : null;
        const websiteDaily = websiteDailyScopeKey
          ? websiteRows.find((row) => row.scopeKey === websiteDailyScopeKey)
          : null;
        const websiteTotal = website ? websiteRows.find((row) => row.scopeKey === "total:website") : null;
        const blocked = !daily || !total
          || daily.spentMicrousd + daily.reservedMicrousd + input.reservationMicrousd > input.dailyHardStopMicrousd
          || total.spentMicrousd + total.reservedMicrousd + input.reservationMicrousd > input.totalHardStopMicrousd
          || (website && (!websiteDaily || !websiteTotal
            || websiteDaily.spentMicrousd + websiteDaily.reservedMicrousd + input.reservationMicrousd > input.websiteDailyHardStopMicrousd!
            || websiteTotal.spentMicrousd + websiteTotal.reservedMicrousd + input.reservationMicrousd > input.websiteTotalHardStopMicrousd!));
        if (blocked) {
          const attemptId = await insertGateAttempt(transaction, {
            messageId: input.messageId,
            trigger: input.trigger,
            intent: input.intent,
            riskLevel: "high",
            gateResult: "pilot_limit",
            gateReasons: ["budget_hard_stop"],
            knowledgeVersion: input.knowledgeVersion,
          });
          await transaction.update(customerServiceAiAttempts).set({
            status: "budget_blocked",
            gateResult: "budget_blocked",
          }).where(eq(customerServiceAiAttempts.id, attemptId));
          return { status: "budget_blocked" as const, attemptId };
        }

        await transaction.update(customerServiceBudgetState).set({
          reservedMicrousd: sql`${customerServiceBudgetState.reservedMicrousd} + ${input.reservationMicrousd}`,
        }).where(sql`${customerServiceBudgetState.scopeKey} in (${input.dailyScopeKey}, 'total')`);
        if (website && websiteDailyScopeKey) {
          await transaction.update(customerServiceWebsiteBudgetState).set({
            reservedMicrousd: sql`${customerServiceWebsiteBudgetState.reservedMicrousd} + ${input.reservationMicrousd}`,
          }).where(sql`${customerServiceWebsiteBudgetState.scopeKey} in (${sql.join(websiteScopeKeys.map((key) => sql`${key}`), sql`, `)})`);
          await transaction.update(customerServiceWebsiteBudgetState).set({
            warningReachedAt: sql`coalesce(${customerServiceWebsiteBudgetState.warningReachedAt}, now())`,
            warningThresholdMicrousd: input.websiteDailyWarningMicrousd,
          }).where(and(
            eq(customerServiceWebsiteBudgetState.scopeKey, websiteDailyScopeKey),
            sql`${customerServiceWebsiteBudgetState.spentMicrousd} + ${customerServiceWebsiteBudgetState.reservedMicrousd} >= ${input.websiteDailyWarningMicrousd!}`,
          ));
        }
        const [attempt] = await transaction.insert(customerServiceAiAttempts).values({
          messageId: input.messageId,
          attemptNumber: await nextAttemptNumber(transaction, input.messageId),
          trigger: input.trigger,
          intent: input.intent,
          riskLevel: input.riskLevel,
          gateResult: "allowed",
          gateReasons: input.gateReasons,
          knowledgeSources: input.knowledgeSources,
          knowledgeVersion: input.knowledgeVersion,
          status: "provider_pending",
          providerCalled: false,
          reservedCostMicrousd: input.reservationMicrousd,
        }).returning({ id: customerServiceAiAttempts.id });
        return { status: "reserved" as const, attemptId: attempt.id };
      });
    },

    async confirmProviderInvocation(input) {
      return database.transaction(async (transaction) => {
        const [initial] = await transaction.select({
          messageId: customerServiceAiAttempts.messageId,
          channel: customerServiceMessages.channel,
        }).from(customerServiceAiAttempts)
          .innerJoin(customerServiceMessages, eq(customerServiceMessages.id, customerServiceAiAttempts.messageId))
          .where(eq(customerServiceAiAttempts.id, input.attemptId)).limit(1);
        if (!initial) throw new Error("customer_service_attempt_not_found");
        let turn = await turnForMessage(transaction, initial.messageId);
        if (turn) {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'turn:' + turn.conversationId}))`);
          turn = await turnForMessage(transaction, initial.messageId);
        }
        const [attempt] = await transaction.select({
          status: customerServiceAiAttempts.status,
          providerCalled: customerServiceAiAttempts.providerCalled,
          reserved: customerServiceAiAttempts.reservedCostMicrousd,
        }).from(customerServiceAiAttempts)
          .where(eq(customerServiceAiAttempts.id, input.attemptId)).limit(1).for("update");
        if (!attempt) throw new Error("customer_service_attempt_not_found");
        if (attempt.status === "abandoned") return { status: "human_reply_received" as const };
        if (attempt.status !== "provider_pending" || attempt.providerCalled) {
          throw new Error("customer_service_provider_invocation_state_invalid");
        }
        const humanReplyReceived = Boolean(turn) && (
          (turn?.status === "suppressed" && turn.suppressionReason === "human_outbound_received")
          || await hasHumanReplyAfterTurn(transaction, turn)
        );
        if (humanReplyReceived) {
          await releaseProviderBudget(transaction, input.dailyScopeKey, initial.channel, attempt.reserved);
          await transaction.update(customerServiceAiAttempts).set({
            status: "abandoned",
            providerCalled: false,
            reservedCostMicrousd: 0,
            completedAt: new Date(),
          }).where(and(
            eq(customerServiceAiAttempts.id, input.attemptId),
            eq(customerServiceAiAttempts.status, "provider_pending"),
            eq(customerServiceAiAttempts.providerCalled, false),
          ));
          return { status: "human_reply_received" as const };
        }
        const started = await transaction.update(customerServiceAiAttempts).set({
          providerCalled: true,
        }).where(and(
          eq(customerServiceAiAttempts.id, input.attemptId),
          eq(customerServiceAiAttempts.status, "provider_pending"),
          eq(customerServiceAiAttempts.providerCalled, false),
        )).returning({ id: customerServiceAiAttempts.id });
        if (!started.length) throw new Error("customer_service_provider_invocation_state_invalid");
        return { status: "allowed" as const };
      });
    },

    async matchHumanReply(input) {
      return database.transaction(async (transaction) => {
        const [group] = await transaction.select().from(customerServiceHumanReplyMatches)
          .where(eq(customerServiceHumanReplyMatches.id, input.matchId)).limit(1).for("update");
        if (!group) throw new Error("customer_service_human_reply_match_not_found");
        if (group.status !== "pending") return { status: "already_terminal" as const };
        const [interruption] = await transaction.select({ id: customerServiceConversationEvents.id })
          .from(customerServiceConversationEvents).where(and(
            eq(customerServiceConversationEvents.conversationId, group.conversationId),
            eq(customerServiceConversationEvents.eventType, "customer_message"),
            sql`${customerServiceConversationEvents.receivedAt} > ${group.lastOutboundAt}`,
            lte(customerServiceConversationEvents.receivedAt, input.now),
          )).limit(1);
        const groupWindowMs = input.groupWindowMs ?? 90_000;
        if (!Number.isSafeInteger(groupWindowMs) || groupWindowMs < 10_000 || groupWindowMs > 120_000) {
          throw new Error("customer_service_human_reply_group_window_invalid");
        }
        if (input.now.getTime() < group.lastOutboundAt.getTime() + groupWindowMs && !interruption) {
          return { status: "not_due" as const };
        }
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'turn:' + group.conversationId}))`);
        const windowStart = new Date(group.firstOutboundAt.getTime() - 2 * 60 * 60 * 1_000);
        const eligibleTurns = await transaction.select({ id: customerServiceTurns.id })
          .from(customerServiceTurns).where(and(
            eq(customerServiceTurns.conversationId, group.conversationId),
            sql`${customerServiceTurns.lastEventAt} >= ${windowStart}`,
            lte(customerServiceTurns.lastEventAt, group.firstOutboundAt),
            sql`not exists (
              select 1 from ${customerServiceHumanReplyMatches} prior_match
              where prior_match.turn_id = ${customerServiceTurns.id}
                and prior_match.id <> ${group.id}
                and prior_match.status = 'matched'
            )`,
          )).orderBy(asc(customerServiceTurns.lastEventAt));
        const [replyReference] = await transaction.select({
          replyHash: customerServiceConversationEvents.replyToExternalMessageKeyHash,
        }).from(customerServiceHumanReplyMatchEvents)
          .innerJoin(customerServiceConversationEvents, eq(
            customerServiceConversationEvents.id,
            customerServiceHumanReplyMatchEvents.eventId,
          )).where(and(
            eq(customerServiceHumanReplyMatchEvents.matchId, group.id),
            isNotNull(customerServiceConversationEvents.replyToExternalMessageKeyHash),
          )).orderBy(asc(customerServiceHumanReplyMatchEvents.ordinal)).limit(1);
        const [explicitEvent] = replyReference?.replyHash
          ? await transaction.select({ turnId: customerServiceConversationEvents.turnId })
            .from(customerServiceConversationEvents).where(and(
              eq(customerServiceConversationEvents.conversationId, group.conversationId),
              eq(customerServiceConversationEvents.externalMessageKeyHash, replyReference.replyHash),
              eq(customerServiceConversationEvents.eventType, "customer_message"),
            )).limit(1)
          : [];
        const decision = chooseHumanReplyTurn({
          explicitTurnId: explicitEvent?.turnId ?? null,
          hasExplicitReference: Boolean(replyReference?.replyHash),
          eligibleTurnIds: eligibleTurns.map((turn) => turn.id),
        });
        if (decision.status === "unmatched") {
          await transaction.update(customerServiceHumanReplyMatches).set({
            status: "unmatched",
            matchMethod: "none",
            confidence: "low",
            matchScore: 0,
            editClassification: "unmatched",
            contextSummary: "[No reliable customer turn match]",
          }).where(and(
            eq(customerServiceHumanReplyMatches.id, group.id),
            eq(customerServiceHumanReplyMatches.status, "pending"),
          ));
          return { status: "unmatched" as const };
        }
        const [turn] = await transaction.select({
          id: customerServiceTurns.id,
          representativeMessageId: customerServiceTurns.representativeMessageId,
        }).from(customerServiceTurns).where(eq(customerServiceTurns.id, decision.turnId)).limit(1);
        if (!turn?.representativeMessageId) throw new Error("customer_service_turn_message_missing");
        const attempts = await transaction.select({
          id: customerServiceAiAttempts.id,
          draftText: customerServiceAiAttempts.draftText,
          intent: customerServiceAiAttempts.intent,
          riskLevel: customerServiceAiAttempts.riskLevel,
          knowledgeSources: customerServiceAiAttempts.knowledgeSources,
          completedAt: customerServiceAiAttempts.completedAt,
        }).from(customerServiceAiAttempts).where(and(
          eq(customerServiceAiAttempts.messageId, turn.representativeMessageId),
          eq(customerServiceAiAttempts.status, "draft_ready"),
          lte(customerServiceAiAttempts.completedAt, group.firstOutboundAt),
        )).orderBy(desc(customerServiceAiAttempts.completedAt));
        const classified = attempts.map((attempt) => ({
          attempt,
          edit: classifyHumanEdit(attempt.draftText, group.humanFinalText),
        })).sort((left, right) => (
          (right.edit.similarityScore ?? -1) - (left.edit.similarityScore ?? -1)
          || (right.attempt.completedAt?.getTime() ?? 0) - (left.attempt.completedAt?.getTime() ?? 0)
        ));
        const best = classified[0];
        const independent = classifyHumanEdit(null, group.humanFinalText);
        const edit = best?.edit ?? independent;
        const history = await transaction.select({
          role: customerServiceConversationEvents.role,
          body: customerServiceConversationEvents.body,
        }).from(customerServiceConversationEvents).where(and(
          eq(customerServiceConversationEvents.conversationId, group.conversationId),
          lte(customerServiceConversationEvents.receivedAt, group.firstOutboundAt),
        )).orderBy(desc(customerServiceConversationEvents.receivedAt)).limit(6);
        const contextSummary = history.reverse().map((event) => `${event.role}: ${event.body}`).join("\n")
          || "[No prior context]";
        await transaction.update(customerServiceHumanReplyMatches).set({
          status: "matched",
          turnId: turn.id,
          aiAttemptId: best?.attempt.id ?? null,
          matchMethod: decision.method,
          confidence: decision.confidence,
          matchScore: 100,
          editClassification: edit.classification,
          similarityScore: edit.similarityScore,
          editReasonCodes: edit.reasonCodes,
          intent: best?.attempt.intent ?? null,
          riskClass: best?.attempt.riskLevel ?? null,
          policyReferences: best?.attempt.knowledgeSources ?? [],
          contextSummary,
        }).where(and(
          eq(customerServiceHumanReplyMatches.id, group.id),
          eq(customerServiceHumanReplyMatches.status, "pending"),
        ));
        return { status: "matched" as const, classification: edit.classification };
      });
    },

    async recoverDueHumanReplies(input) {
      const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
      if (!Number.isSafeInteger(input.groupWindowMs) || input.groupWindowMs < 10_000 || input.groupWindowMs > 120_000) {
        throw new Error("customer_service_human_reply_group_window_invalid");
      }
      const cutoff = new Date(input.now.getTime() - input.groupWindowMs);
      const due = await database.select({
        id: customerServiceHumanReplyMatches.id,
        channel: customerServiceConversations.channel,
      }).from(customerServiceHumanReplyMatches)
        .innerJoin(customerServiceConversations, eq(
          customerServiceConversations.id,
          customerServiceHumanReplyMatches.conversationId,
        )).where(and(
          eq(customerServiceHumanReplyMatches.status, "pending"),
          or(
            lte(customerServiceHumanReplyMatches.lastOutboundAt, cutoff),
            sql`exists (
              select 1 from ${customerServiceConversationEvents} interruption
              where interruption.conversation_id = ${customerServiceHumanReplyMatches.conversationId}
                and interruption.event_type = 'customer_message'
                and interruption.received_at > ${customerServiceHumanReplyMatches.lastOutboundAt}
                and interruption.received_at <= ${input.now}
            )`,
          ),
        )).orderBy(asc(customerServiceHumanReplyMatches.lastOutboundAt)).limit(limit);
      let matched = 0;
      let unmatched = 0;
      for (const item of due) {
        const result = await repository.matchHumanReply({
          matchId: item.id,
          now: input.now,
          groupWindowMs: input.groupWindowMs,
        });
        if (result.status === "matched") matched += 1;
        if (result.status === "unmatched") unmatched += 1;
        if (result.status === "matched" && item.channel === "facebook") {
          const [source] = await database.select({ body: customerServiceMessages.body })
            .from(customerServiceHumanReplyMatches)
            .innerJoin(customerServiceTurns, eq(customerServiceTurns.id, customerServiceHumanReplyMatches.turnId))
            .innerJoin(customerServiceMessages, eq(customerServiceMessages.id, customerServiceTurns.representativeMessageId))
            .where(eq(customerServiceHumanReplyMatches.id, item.id)).limit(1);
          if (source) {
            await repository.createCaseMemoryCandidate({
              matchId: item.id,
              customerSituation: source.body,
              customerTurnSummary: source.body,
              productCategory: null,
              market: "unknown",
              deadlineContext: null,
              knowledgeVersion: input.knowledgeVersion,
            });
          }
        }
      }
      return { selected: due.length, matched, unmatched };
    },

    async createCaseMemoryCandidate(input) {
      return database.transaction(async (transaction) => {
        const [existing] = await transaction.select({ id: customerServiceCaseMemories.id })
          .from(customerServiceCaseMemories)
          .innerJoin(customerServiceHumanReplyMatches, eq(
            customerServiceHumanReplyMatches.id,
            customerServiceCaseMemories.humanReplyMatchId,
          ))
          .where(eq(customerServiceCaseMemories.humanReplyMatchId, input.matchId)).limit(1);
        if (existing) return { status: "already_exists" as const, caseMemoryId: existing.id };
        const [match] = await transaction.select().from(customerServiceHumanReplyMatches)
          .where(eq(customerServiceHumanReplyMatches.id, input.matchId)).limit(1).for("update");
        if (!match || match.status !== "matched" || !match.turnId) {
          throw new Error("customer_service_case_memory_match_not_eligible");
        }
        const [sourceConversation] = await transaction.select({
          channel: customerServiceConversations.channel,
        }).from(customerServiceTurns).innerJoin(customerServiceConversations, and(
          eq(customerServiceConversations.id, customerServiceTurns.conversationId),
          eq(customerServiceConversations.channel, customerServiceTurns.channel),
        )).where(and(
          eq(customerServiceTurns.id, match.turnId),
          eq(customerServiceTurns.conversationId, match.conversationId),
        )).limit(1);
        if (sourceConversation?.channel !== "facebook") {
          throw new Error("customer_service_case_memory_channel_not_eligible");
        }
        const sourceEvents = await transaction.select({
          redactionCodes: customerServiceConversationEvents.redactionCodes,
        }).from(customerServiceHumanReplyMatchEvents)
          .innerJoin(customerServiceConversationEvents, eq(
            customerServiceConversationEvents.id,
            customerServiceHumanReplyMatchEvents.eventId,
          )).where(eq(customerServiceHumanReplyMatchEvents.matchId, match.id));
        const [attempt] = match.aiAttemptId
          ? await transaction.select({
            draftText: customerServiceAiAttempts.draftText,
            gateReasons: customerServiceAiAttempts.gateReasons,
          }).from(customerServiceAiAttempts).where(eq(customerServiceAiAttempts.id, match.aiAttemptId)).limit(1)
          : [];
        const situation = sanitizeCaseMemoryText(input.customerSituation);
        const turnSummary = sanitizeCaseMemoryText(input.customerTurnSummary);
        const context = sanitizeCaseMemoryText(match.contextSummary);
        const finalReply = sanitizeCaseMemoryText(match.humanFinalText);
        const draft = attempt?.draftText ? sanitizeCaseMemoryText(attempt.draftText) : null;
        const sourceRedactions = sourceEvents.flatMap((event) => event.redactionCodes);
        const sanitationCodes = [situation, turnSummary, context, finalReply, ...(draft ? [draft] : [])]
          .flatMap((item) => item.codes);
        const eligibility = assessCaseMemoryEligibility({
          riskClass: match.riskClass ?? "high",
          gateReasons: attempt?.gateReasons ?? [],
          customerSituation: situation.text,
          humanReply: finalReply.text,
          redactionCodes: [...sourceRedactions, ...sanitationCodes],
        });
        const status = eligibility.eligible ? "pending_review" as const : "excluded" as const;
        const [memory] = await transaction.insert(customerServiceCaseMemories).values({
          humanReplyMatchId: match.id,
          intent: match.intent ?? "unknown",
          normalizedSituation: situation.text,
          customerTurnSummary: turnSummary.text,
          contextSummary: context.text,
          aiDraft: draft?.text ?? null,
          humanFinalReply: finalReply.text,
          editClassification: match.editClassification,
          editReasonCodes: match.editReasonCodes,
          productCategory: input.productCategory,
          market: input.market,
          deadlineContext: input.deadlineContext,
          policyReferences: match.policyReferences,
          knowledgeVersion: input.knowledgeVersion,
          riskClass: match.riskClass === "low" ? "low" : "medium",
          eligibilityStatus: status,
          sourceConfidence: match.confidence === "high" ? "high" : "medium",
          exclusionCodes: eligibility.exclusionCodes,
          ...(status === "excluded" ? { decidedAt: new Date() } : {}),
        }).returning({ id: customerServiceCaseMemories.id });
        return status === "pending_review"
          ? { status, caseMemoryId: memory.id }
          : { status, caseMemoryId: memory.id, exclusionCodes: eligibility.exclusionCodes };
      });
    },

    async retrieveApprovedCaseMemories(input) {
      const limit = Math.max(1, Math.min(3, input.limit));
      const startedAt = Date.now();
      const fullTextRank = sql<number>`ts_rank_cd(
        to_tsvector('simple', ${customerServiceCaseMemories.normalizedSituation}),
        plainto_tsquery('simple', ${input.query})
      )::float`;
      const candidates = await database.select({
        id: customerServiceCaseMemories.id,
        intent: customerServiceCaseMemories.intent,
        riskClass: customerServiceCaseMemories.riskClass,
        productCategory: customerServiceCaseMemories.productCategory,
        market: customerServiceCaseMemories.market,
        policyReferences: customerServiceCaseMemories.policyReferences,
        normalizedSituation: customerServiceCaseMemories.normalizedSituation,
        humanFinalReply: customerServiceCaseMemories.humanFinalReply,
        knowledgeVersion: customerServiceCaseMemories.knowledgeVersion,
        exclusionCodes: customerServiceCaseMemories.exclusionCodes,
        createdAt: customerServiceCaseMemories.createdAt,
        fullTextRank,
      }).from(customerServiceCaseMemories).where(and(
        eq(customerServiceCaseMemories.eligibilityStatus, "approved_reusable"),
        eq(customerServiceCaseMemories.intent, input.intent),
      )).orderBy(desc(fullTextRank), desc(customerServiceCaseMemories.createdAt)).limit(50);
      const scored = candidates.map((memory) => {
        let exclusionReason: string | null = null;
        if (memory.knowledgeVersion !== input.knowledgeVersion) exclusionReason = "knowledge_version_conflict";
        else if (memory.exclusionCodes.length) exclusionReason = "excluded_source";
        const score = exclusionReason ? null : scoreCaseMemory({
          current: {
            intent: input.intent,
            riskClass: input.riskClass,
            productCategory: input.productCategory,
            market: input.market,
            policyReferences: input.policyReferences,
            query: input.query,
            now: input.now,
          },
          memory: {
            intent: memory.intent,
            riskClass: memory.riskClass,
            productCategory: memory.productCategory,
            market: memory.market,
            policyReferences: memory.policyReferences,
            normalizedSituation: memory.normalizedSituation,
            createdAt: memory.createdAt,
            fullTextRank: memory.fullTextRank,
          },
        });
        if (!exclusionReason && !score?.eligible) exclusionReason = "structured_incompatible";
        if (!exclusionReason && (score?.totalScore ?? 0) < 70) exclusionReason = "below_threshold";
        return { memory, score, exclusionReason };
      }).sort((left, right) => (
        (right.score?.totalScore ?? 0) - (left.score?.totalScore ?? 0)
        || right.memory.createdAt.getTime() - left.memory.createdAt.getTime()
        || left.memory.id.localeCompare(right.memory.id)
      ));
      const selected = scored.filter((item) => !item.exclusionReason).slice(0, limit);
      const selectedIds = new Set(selected.map((item) => item.memory.id));
      const latencyMs = Math.max(0, Date.now() - startedAt);
      if (scored.length) {
        await database.insert(customerServiceCaseRetrievals).values(scored.map((item) => {
          const selectedIndex = selected.findIndex((candidate) => candidate.memory.id === item.memory.id);
          const injected = selectedIds.has(item.memory.id);
          return {
            attemptId: input.attemptId,
            caseMemoryId: item.memory.id,
            rank: injected ? selectedIndex + 1 : null,
            totalScore: item.score?.totalScore ?? 0,
            scoreComponents: item.score?.eligible ? item.score.components : {},
            thresholdPassed: !item.exclusionReason,
            injected,
            exclusionReason: item.exclusionReason,
            latencyMs,
          };
        })).onConflictDoNothing();
      }
      return selected.map((item) => Object.freeze({
        id: item.memory.id,
        normalizedSituation: item.memory.normalizedSituation,
        humanFinalReply: item.memory.humanFinalReply,
        score: item.score?.totalScore ?? 0,
      }));
    },

    async listCaseMemoryCandidates(limit) {
      const rows = await database.select({
        id: customerServiceCaseMemories.id,
        intent: customerServiceCaseMemories.intent,
        normalizedSituation: customerServiceCaseMemories.normalizedSituation,
        humanFinalReply: customerServiceCaseMemories.humanFinalReply,
        status: customerServiceCaseMemories.eligibilityStatus,
      }).from(customerServiceCaseMemories)
        .where(eq(customerServiceCaseMemories.eligibilityStatus, "pending_review"))
        .orderBy(asc(customerServiceCaseMemories.createdAt))
        .limit(Math.max(1, Math.min(100, limit)));
      return Object.freeze({ items: Object.freeze(rows.map((row) => Object.freeze(row))) });
    },

    async decideCaseMemory(input) {
      const nextStatus = input.action === "approve" ? "approved_reusable" as const : "excluded" as const;
      return database.transaction(async (transaction) => {
        const [memory] = await transaction.select({
          status: customerServiceCaseMemories.eligibilityStatus,
          exclusionCodes: customerServiceCaseMemories.exclusionCodes,
        }).from(customerServiceCaseMemories)
          .where(eq(customerServiceCaseMemories.id, input.caseMemoryId)).limit(1).for("update");
        if (!memory || memory.status !== "pending_review") {
          throw new Error("customer_service_case_memory_transition_invalid");
        }
        await transaction.update(customerServiceCaseMemories).set({
          eligibilityStatus: nextStatus,
          approvedByUserId: input.reviewerUserId,
          decidedAt: input.now,
          exclusionCodes: input.action === "reject"
            ? [...new Set([...memory.exclusionCodes, "rejected_by_reviewer"])]
            : memory.exclusionCodes,
        }).where(and(
          eq(customerServiceCaseMemories.id, input.caseMemoryId),
          eq(customerServiceCaseMemories.eligibilityStatus, "pending_review"),
        ));
        return { status: nextStatus };
      });
    },

    async listLearningCandidates(limit) {
      const rows = await database.select({
        id: customerServiceLearningCandidates.id,
        intent: customerServiceLearningCandidates.intent,
        proposedChange: customerServiceLearningCandidates.proposedChange,
        reasonCodes: customerServiceLearningCandidates.reasonCodes,
        evidenceCount: customerServiceLearningCandidates.evidenceCount,
        status: customerServiceLearningCandidates.status,
      }).from(customerServiceLearningCandidates)
        .orderBy(desc(customerServiceLearningCandidates.createdAt))
        .limit(Math.max(1, Math.min(100, limit)));
      return Object.freeze({ items: Object.freeze(rows.map((row) => Object.freeze(row))) });
    },

    async refreshLearningCandidates(input = {}) {
      const minimumMatchedReplies = input.minimumMatchedReplies ?? 50;
      if (!Number.isSafeInteger(minimumMatchedReplies) || minimumMatchedReplies < 3 || minimumMatchedReplies > 1_000) {
        throw new Error("learning_summary_threshold_invalid");
      }
      const [countRow] = await database.select({ value: sql<number>`count(*)::int` })
        .from(customerServiceHumanReplyMatches)
        .where(eq(customerServiceHumanReplyMatches.status, "matched"));
      const checkpoint = Math.floor((countRow?.value ?? 0) / minimumMatchedReplies) * minimumMatchedReplies;
      if (!checkpoint) return { checkpoint: 0, created: 0 };
      const cases = await database.select({
        caseId: customerServiceCaseMemories.id,
        conversationKeyHash: customerServiceHumanReplyMatches.conversationId,
        intent: customerServiceCaseMemories.intent,
        editReasonCodes: customerServiceCaseMemories.editReasonCodes,
      }).from(customerServiceCaseMemories)
        .innerJoin(customerServiceHumanReplyMatches, eq(
          customerServiceHumanReplyMatches.id,
          customerServiceCaseMemories.humanReplyMatchId,
        ))
        .where(eq(customerServiceCaseMemories.eligibilityStatus, "approved_reusable"))
        .orderBy(asc(customerServiceCaseMemories.createdAt))
        .limit(checkpoint);
      const summary = buildLearningSummary(cases.map((item) => ({
        ...item,
        approvedLowRisk: true,
      })), minimumMatchedReplies, checkpoint);
      if (!summary?.candidates.length) return { checkpoint, created: 0 };
      const created = await database.insert(customerServiceLearningCandidates).values(
        summary.candidates.map((candidate) => ({
          candidateKind: candidate.candidateKind,
          intent: candidate.intent,
          proposedChange: candidate.proposedChange,
          evidenceCount: candidate.evidenceCount,
          distinctCaseCount: candidate.distinctCaseCount,
          reasonCodes: candidate.reasonCodes,
          sourceCaseMemoryIds: candidate.sourceCaseMemoryIds,
          evidenceSignature: candidate.evidenceSignature,
          status: "pending" as const,
        })),
      ).onConflictDoNothing().returning({ id: customerServiceLearningCandidates.id });
      return { checkpoint, created: created.length };
    },

    async decideLearningCandidate(input) {
      const nextStatus = input.action === "reject" ? "rejected" as const : "approved" as const;
      return database.transaction(async (transaction) => {
        const [candidate] = await transaction.select().from(customerServiceLearningCandidates)
          .where(eq(customerServiceLearningCandidates.id, input.candidateId)).limit(1).for("update");
        if (!candidate || candidate.status !== "pending") {
          throw new Error("customer_service_learning_candidate_transition_invalid");
        }
        await transaction.update(customerServiceLearningCandidates).set({
          status: nextStatus,
          approvedText: input.action === "edit_and_approve" ? input.approvedText : null,
          reviewerUserId: input.reviewerUserId,
          decisionReason: input.reason,
          decidedAt: input.now,
        }).where(and(
          eq(customerServiceLearningCandidates.id, input.candidateId),
          eq(customerServiceLearningCandidates.status, "pending"),
        ));
        return { status: nextStatus };
      });
    },

    async createImageJobProviderAttempt(input) {
      return database.transaction(async (transaction) => {
        const [job] = await transaction.select({
          messageId: customerServiceImageJobs.messageId,
          textAttemptId: customerServiceImageJobs.textAttemptId,
        }).from(customerServiceImageJobs).where(and(
          eq(customerServiceImageJobs.id, input.jobId),
          eq(customerServiceImageJobs.status, "running"),
          eq(customerServiceImageJobs.stage, "draft"),
          eq(customerServiceImageJobs.leaseToken, input.leaseToken),
        )).limit(1).for("update");
        if (!job || job.messageId !== input.messageId) {
          throw new Error("customer_service_image_job_lease_mismatch");
        }
        if (job.textAttemptId) return { status: "ambiguous" as const, attemptId: job.textAttemptId };
        const [attempt] = await transaction.insert(customerServiceAiAttempts).values({
          messageId: input.messageId,
          attemptNumber: await nextAttemptNumber(transaction, input.messageId),
          trigger: input.trigger,
          intent: input.intent,
          riskLevel: input.riskLevel,
          gateResult: "allowed",
          gateReasons: input.gateReasons,
          knowledgeSources: input.knowledgeSources,
          knowledgeVersion: input.knowledgeVersion,
          status: "provider_pending",
          providerCalled: true,
          reservedCostMicrousd: 0,
        }).returning({ id: customerServiceAiAttempts.id });
        await transaction.update(customerServiceImageJobs).set({ textAttemptId: attempt.id })
          .where(eq(customerServiceImageJobs.id, input.jobId));
        return { status: "reserved" as const, attemptId: attempt.id };
      });
    },

    async completeProviderAttempt(input: ProviderAttemptCompletion) {
      await database.transaction(async (transaction) => {
        const [initial] = await transaction.select({
          messageId: customerServiceAiAttempts.messageId,
          channel: customerServiceMessages.channel,
        }).from(customerServiceAiAttempts)
          .innerJoin(customerServiceMessages, eq(customerServiceMessages.id, customerServiceAiAttempts.messageId))
          .where(eq(customerServiceAiAttempts.id, input.attemptId)).limit(1);
        if (!initial) throw new Error("customer_service_attempt_not_found");
        let turn = await turnForMessage(transaction, initial.messageId);
        if (turn) {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'turn:' + turn.conversationId}))`);
          turn = await turnForMessage(transaction, initial.messageId);
        }
        const [attempt] = await transaction.select({
          status: customerServiceAiAttempts.status,
          reserved: customerServiceAiAttempts.reservedCostMicrousd,
        })
          .from(customerServiceAiAttempts)
          .where(eq(customerServiceAiAttempts.id, input.attemptId)).limit(1).for("update");
        if (!attempt) throw new Error("customer_service_attempt_not_found");
        if (attempt.status !== "provider_pending") return;
        const [imageJob] = await transaction.select({ id: customerServiceImageJobs.id })
          .from(customerServiceImageJobs)
          .where(eq(customerServiceImageJobs.textAttemptId, input.attemptId)).limit(1);
        if (!imageJob) {
          const settledCost = input.estimatedCostMicrousd ?? attempt.reserved;
          await settleProviderBudget(
            transaction,
            input.dailyScopeKey,
            initial.channel,
            attempt.reserved,
            settledCost,
          );
        }
        const humanReplyReceived = Boolean(turn) && (
          (turn?.status === "suppressed" && turn.suppressionReason === "human_outbound_received")
          || await hasHumanReplyAfterTurn(transaction, turn)
        );
        const keepWebsiteRendererProof = !humanReplyReceived
          && initial.channel === "website"
          && input.status === "draft_ready";
        await transaction.update(customerServiceAiAttempts).set({
          status: humanReplyReceived ? "abandoned" : input.status,
          providerCalled: true,
          provider: input.provider,
          model: input.model,
          draftText: !humanReplyReceived && input.status === "draft_ready" ? input.draftText : null,
          websiteDecision: keepWebsiteRendererProof ? input.websiteDecision ?? null : null,
          websiteResponseTemplateVersion: keepWebsiteRendererProof
            ? input.websiteResponseTemplateVersion ?? null
            : null,
          rejectedOutputHash: humanReplyReceived ? null : input.rejectedOutputHash ?? null,
          validatorCodes: input.validatorCodes,
          inputTokens: input.inputTokens,
          cachedInputTokens: input.cachedInputTokens,
          outputTokens: input.outputTokens,
          estimatedCostMicrousd: input.estimatedCostMicrousd,
          reservedCostMicrousd: 0,
          latencyMs: input.latencyMs,
          providerErrorCode: input.providerErrorCode ?? null,
          completedAt: new Date(),
        }).where(eq(customerServiceAiAttempts.id, input.attemptId));
      });
    },

    async messageIdForAttempt(attemptId) {
      const [row] = await database.select({ messageId: customerServiceAiAttempts.messageId })
        .from(customerServiceAiAttempts)
        .where(eq(customerServiceAiAttempts.id, attemptId)).limit(1);
      return row?.messageId ?? null;
    },

    async appendFeedback(input: FeedbackEventInput) {
      await database.insert(customerServiceFeedbackEvents).values(input).onConflictDoNothing();
    },

    async listQueue(limit) {
      return loadQueuePage(Math.max(1, Math.min(100, limit)));
    },

    async getReplyAssistantUiCursor() {
      const [state] = await database.select({ revision: customerServiceUiRevision.revision })
        .from(customerServiceUiRevision)
        .where(eq(customerServiceUiRevision.singleton, 1))
        .limit(1);
      return encodeReplyAssistantCursor(state?.revision ?? 0);
    },

    async listReplyAssistantUpdates(cursor, limit) {
      const reader = createReplyAssistantUpdateReader({
        readChanges: async (afterRevision, requestedLimit) => {
          const safeLimit = Math.max(1, Math.min(500, requestedLimit));
          const state = await database.select({ revision: customerServiceUiRevision.revision })
            .from(customerServiceUiRevision)
            .where(eq(customerServiceUiRevision.singleton, 1))
            .limit(1);
          const rows = await database.select({
              scope: customerServiceUiChanges.scope,
              entityKey: customerServiceUiChanges.entityKey,
              revision: customerServiceUiChanges.revision,
            }).from(customerServiceUiChanges)
              .where(sql`${customerServiceUiChanges.revision} > ${afterRevision}`)
              .orderBy(asc(customerServiceUiChanges.revision))
              .limit(safeLimit + 1);
          return {
            currentRevision: state[0]?.revision ?? 0,
            changes: rows.slice(0, safeLimit),
            hasMore: rows.length > safeLimit,
          };
        },
        loadQueueByMessageIds: async (messageIds) => {
          return (await loadQueuePage(messageIds.length, messageIds)).items;
        },
        loadQueueByConversationIds: async (conversationIds) => {
          const messageRows = conversationIds.length
            ? await database.select({ id: customerServiceMessages.id })
              .from(customerServiceMessages)
              .where(inArray(customerServiceMessages.conversationId, [...conversationIds]))
            : [];
          const messageIds = messageRows.map((row) => row.id);
          return messageIds.length ? (await loadQueuePage(messageIds.length, messageIds)).items : [];
        },
        loadMetrics: () => repository.metricCounts(),
        loadLearningCandidates: () => repository.listLearningCandidates(20),
        loadCaseMemories: () => repository.listCaseMemoryCandidates(20),
      });
      return reader(cursor, limit);
    },

    async runWebsiteRetention(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
        throw new Error("website_retention_limit_invalid");
      }
      const expiredSessions = await database.execute(sql`
        with selected as (
          select ${customerServiceWebSessions.id} as id from ${customerServiceWebSessions}
          where ${customerServiceWebSessions.expiresAt} <= ${input.now}
          order by ${customerServiceWebSessions.expiresAt}, ${customerServiceWebSessions.id}
          limit ${input.limit}
          for update skip locked
        )
        delete from ${customerServiceWebSessions} sessions
        using selected
        where sessions.id = selected.id
        returning sessions.id
      `);
      const expiredBuckets = await database.execute(sql`
        with selected as (
          select ${customerServiceRateLimitBuckets.id} as id from ${customerServiceRateLimitBuckets}
          where ${customerServiceRateLimitBuckets.expiresAt} <= ${input.now}
          order by ${customerServiceRateLimitBuckets.expiresAt}, ${customerServiceRateLimitBuckets.id}
          limit ${input.limit}
          for update skip locked
        )
        delete from ${customerServiceRateLimitBuckets} buckets
        using selected
        where buckets.id = selected.id
        returning buckets.id
      `);
      const expiredRateBlocks = await database.execute(sql`
        with selected as (
          select ${customerServiceWebsiteMetricEvents.id} as id from ${customerServiceWebsiteMetricEvents}
          where ${customerServiceWebsiteMetricEvents.expiresAt} <= ${input.now}
          order by ${customerServiceWebsiteMetricEvents.expiresAt}, ${customerServiceWebsiteMetricEvents.id}
          limit ${input.limit}
          for update skip locked
        )
        delete from ${customerServiceWebsiteMetricEvents} events
        using selected
        where events.id = selected.id
        returning events.id
      `);
      const sessionsExpired = expiredSessions.rows.length;
      const rateBucketsDeleted = expiredBuckets.rows.length;
      const rateBlockEventsDeleted = expiredRateBlocks.rows.length;
      const reviewLinksExpired = await database.transaction(async (transaction) => {
        await transaction.execute(sql`
          with selected as (
            select id from ${customerServiceReviewSelectors}
            where ${customerServiceReviewSelectors.expiresAt} <= ${input.now}
            order by ${customerServiceReviewSelectors.expiresAt}, ${customerServiceReviewSelectors.id}
            limit ${input.limit}
            for update skip locked
          )
          delete from ${customerServiceReviewSelectors} selectors
          using selected
          where selectors.id = selected.id
        `);
        const expired = await transaction.select({ id: customerServiceHumanReviews.id })
          .from(customerServiceHumanReviews)
          .where(and(
            lte(customerServiceHumanReviews.deepLinkExpiresAt, input.now),
            sql`not exists (
              select 1 from ${customerServiceReviewAlertOutbox} alerts
              where alerts.human_review_id = ${customerServiceHumanReviews.id}
                and alerts.status = 'leased'
            )`,
          ))
          .orderBy(asc(customerServiceHumanReviews.deepLinkExpiresAt), asc(customerServiceHumanReviews.id))
          .limit(input.limit)
          .for("update", { skipLocked: true });
        if (!expired.length) return 0;
        const ids = expired.map((item) => item.id);
        await transaction.update(customerServiceReviewAlertOutbox).set({
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: "deep_link_expired",
        }).where(and(
          inArray(customerServiceReviewAlertOutbox.humanReviewId, ids),
          inArray(customerServiceReviewAlertOutbox.status, ["pending", "retry_wait"]),
        ));
        const cleared = await transaction.update(customerServiceHumanReviews).set({
          deepLinkTokenHash: null,
          deepLinkExpiresAt: null,
        }).where(inArray(customerServiceHumanReviews.id, ids)).returning({ id: customerServiceHumanReviews.id });
        return cleared.length;
      });

      const cutoff = new Date(input.now.getTime() - WEBSITE_CHAT_RETENTION_MS);
      const candidates = await database.select({ id: customerServiceConversations.id })
        .from(customerServiceConversations)
        .where(and(
          eq(customerServiceConversations.channel, "website"),
          isNull(customerServiceConversations.anonymizedAt),
          lte(customerServiceConversations.createdAt, cutoff),
          sql`not exists (
            select 1 from ${customerServiceHumanReviews} reviews
            where reviews.conversation_id = ${customerServiceConversations.id}
              and (reviews.status = 'open' or reviews.updated_at > ${cutoff})
          )`,
          sql`not exists (
            select 1 from ${customerServiceRetentionHolds} holds
            where holds.conversation_id = ${customerServiceConversations.id}
              and holds.released_at is null
              and (holds.expires_at is null or holds.expires_at > ${input.now})
          )`,
          sql`not exists (
            select 1 from ${customerServiceMessages} messages
            where messages.conversation_id = ${customerServiceConversations.id}
              and messages.received_at > ${cutoff}
          )`,
          sql`not exists (
            select 1 from ${customerServiceConversationEvents} events
            where events.conversation_id = ${customerServiceConversations.id}
              and events.received_at > ${cutoff}
          )`,
          sql`not exists (
            select 1 from ${customerServiceWebsiteAssistantMessages} replies
            where replies.conversation_id = ${customerServiceConversations.id}
              and replies.published_at > ${cutoff}
          )`,
          sql`not exists (
            select 1 from ${customerServiceTurns} turns
            where turns.conversation_id = ${customerServiceConversations.id}
              and turns.processing_status in ('pending', 'running')
          )`,
        ))
        .orderBy(asc(customerServiceConversations.createdAt), asc(customerServiceConversations.id))
        .limit(input.limit);
      let conversationsAnonymized = 0;
      for (const candidate of candidates) {
        const anonymized = await database.transaction(async (transaction) => {
          await lockConversation(transaction, candidate.id);
          const [eligible] = await transaction.select({ id: customerServiceConversations.id })
            .from(customerServiceConversations)
            .where(and(
              eq(customerServiceConversations.id, candidate.id),
              eq(customerServiceConversations.channel, "website"),
              isNull(customerServiceConversations.anonymizedAt),
              lte(customerServiceConversations.createdAt, cutoff),
              sql`not exists (
                select 1 from ${customerServiceHumanReviews} reviews
                where reviews.conversation_id = ${customerServiceConversations.id}
                  and (reviews.status = 'open' or reviews.updated_at > ${cutoff})
              )`,
              sql`not exists (
                select 1 from ${customerServiceRetentionHolds} holds
                where holds.conversation_id = ${customerServiceConversations.id}
                  and holds.released_at is null
                  and (holds.expires_at is null or holds.expires_at > ${input.now})
              )`,
              sql`not exists (
                select 1 from ${customerServiceMessages} messages
                where messages.conversation_id = ${customerServiceConversations.id}
                  and messages.received_at > ${cutoff}
              )`,
              sql`not exists (
                select 1 from ${customerServiceConversationEvents} events
                where events.conversation_id = ${customerServiceConversations.id}
                  and events.received_at > ${cutoff}
              )`,
              sql`not exists (
                select 1 from ${customerServiceWebsiteAssistantMessages} replies
                where replies.conversation_id = ${customerServiceConversations.id}
                  and replies.published_at > ${cutoff}
              )`,
              sql`not exists (
                select 1 from ${customerServiceTurns} turns
                where turns.conversation_id = ${customerServiceConversations.id}
                  and turns.processing_status in ('pending', 'running')
              )`,
            )).limit(1).for("update");
          if (!eligible) return false;

          await transaction.update(customerServiceHumanReplyMatches).set({
            humanFinalText: RETENTION_REDACTION,
            contextSummary: RETENTION_REDACTION,
          }).where(eq(customerServiceHumanReplyMatches.conversationId, candidate.id));
          await transaction.update(customerServiceFeedbackEvents).set({
            humanFinalText: RETENTION_REDACTION,
          }).where(and(
            isNotNull(customerServiceFeedbackEvents.humanFinalText),
            sql`exists (
              select 1 from ${customerServiceAiAttempts} attempts
              join ${customerServiceMessages} messages on messages.id = attempts.message_id
              where attempts.id = ${customerServiceFeedbackEvents.attemptId}
                and messages.conversation_id = ${candidate.id}
            )`,
          ));
          await transaction.update(customerServiceAiAttempts).set({
            draftText: RETENTION_REDACTION,
          }).where(and(
            isNotNull(customerServiceAiAttempts.draftText),
            sql`exists (
              select 1 from ${customerServiceMessages} messages
              where messages.id = ${customerServiceAiAttempts.messageId}
                and messages.conversation_id = ${candidate.id}
            )`,
          ));
          await transaction.update(customerServiceHumanReviews).set({
            redactedSummary: RETENTION_REDACTION,
            deepLinkTokenHash: null,
            deepLinkExpiresAt: null,
          }).where(eq(customerServiceHumanReviews.conversationId, candidate.id));
          await transaction.update(customerServiceWebsiteAssistantMessages).set({
            body: RETENTION_REDACTION,
          }).where(eq(customerServiceWebsiteAssistantMessages.conversationId, candidate.id));
          await transaction.update(customerServiceConversationEvents).set({
            externalMessageKeyHash: sql`md5('retention-event:' || ${customerServiceConversationEvents.id}::text)
              || md5('retention-event-2:' || ${customerServiceConversationEvents.id}::text)`,
            body: RETENTION_REDACTION,
            bodyHash: null,
            redactionCodes: ["retention_anonymized"],
            replyToExternalMessageKeyHash: null,
            learningEligible: false,
          }).where(eq(customerServiceConversationEvents.conversationId, candidate.id));
          await transaction.update(customerServiceTurns).set({
            body: RETENTION_REDACTION,
          }).where(eq(customerServiceTurns.conversationId, candidate.id));
          await transaction.update(customerServiceMessages).set({
            externalMessageKeyHash: sql`md5('retention-message:' || ${customerServiceMessages.id}::text)
              || md5('retention-message-2:' || ${customerServiceMessages.id}::text)`,
            body: RETENTION_REDACTION,
            customerText: null,
            productContext: null,
          }).where(eq(customerServiceMessages.conversationId, candidate.id));
          const updated = await transaction.update(customerServiceConversations).set({
            externalKeyHash: sql`md5('retention-conversation:' || ${customerServiceConversations.id}::text)
              || md5('retention-conversation-2:' || ${customerServiceConversations.id}::text)`,
            anonymizedAt: input.now,
            updatedAt: input.now,
          }).where(and(
            eq(customerServiceConversations.id, candidate.id),
            isNull(customerServiceConversations.anonymizedAt),
          )).returning({ id: customerServiceConversations.id });
          return updated.length === 1;
        });
        if (anonymized) conversationsAnonymized += 1;
      }

      return {
        sessionsExpired,
        rateBucketsDeleted,
        rateBlockEventsDeleted,
        reviewLinksExpired,
        conversationsAnonymized,
      };
    },

    async metricCounts() {
      const result = await database.execute(sql`
        select
          (select count(*) from customer_service_messages where pilot_run_id is not null) as total_incoming_eligible,
          (select count(*) from customer_service_conversation_events where role = 'customer') as raw_customer_events,
          (select count(*) from customer_service_conversation_events where role = 'staff') as staff_context_events,
          (select count(*) from customer_service_turns where status in ('sealed', 'pilot_complete')) as meaningful_turns,
          (select coalesce(sum(greatest(fragment_count - 1, 0)), 0) from customer_service_turns) as aggregated_fragments,
          (select count(*) from customer_service_turns
            where status = 'suppressed' and suppression_reason = 'completed_acknowledgement') as acknowledgements_suppressed,
          (select count(*) from customer_service_ai_attempts where status = 'draft_ready') as drafts_generated,
          (select count(*) from customer_service_feedback_events where action = 'accepted_unchanged') as accepted_unchanged,
          (select count(*) from customer_service_feedback_events where action = 'edited') as edited_accepted,
          (select count(*) from customer_service_feedback_events where action = 'rejected') as rejected,
          (select count(*) from customer_service_ai_attempts where status = 'gate_blocked') as gate_blocked,
          (select count(*) from customer_service_ai_attempts where status = 'output_blocked') as output_validator_blocked,
          (select count(*) from customer_service_ai_attempts where provider_called) as provider_calls,
          (select count(*) from customer_service_ai_attempts
            where validator_codes ?| array['forbidden_commitment', 'monetary_claim', 'unconfirmed_policy_claim']) as policy_violation_attempts,
          (select coalesce(sum(estimated_cost_microusd), 0) from customer_service_ai_attempts) as total_cost_microusd,
          (select coalesce(sum(latency_ms), 0) from customer_service_ai_attempts) as total_latency_ms,
          (select count(*) from customer_service_image_analysis_attempts where provider_called) as image_provider_calls,
          (select coalesce(sum(input_tokens), 0) from customer_service_image_analysis_attempts) as image_input_tokens,
          (select coalesce(sum(cached_input_tokens), 0) from customer_service_image_analysis_attempts) as image_cached_input_tokens,
          (select coalesce(sum(output_tokens), 0) from customer_service_image_analysis_attempts) as image_output_tokens,
          (select coalesce(sum(estimated_cost_microusd), 0) from customer_service_image_analysis_attempts) as image_total_cost_microusd,
          (select coalesce(sum(latency_ms), 0) from customer_service_image_analysis_attempts) as image_total_latency_ms,
          (select count(*) from customer_service_image_analysis_attempts
            where status in ('input_rejected', 'provider_error', 'schema_blocked')) as image_failures,
          (select count(*) from customer_service_image_analysis_inputs where cleanup_status = 'deleted') as image_cleanup_deleted,
          (select count(*) from customer_service_image_analysis_inputs where cleanup_status = 'failed') as image_cleanup_failures,
          (select count(*) from customer_service_image_jobs) as image_contexts,
          (select count(*) from customer_service_image_analysis_attempts where status = 'analyzed') as image_analyses_succeeded,
          (select count(*) from customer_service_image_jobs where status = 'human_review_required') as image_analyses_blocked,
          (select count(*) from customer_service_image_jobs jobs
            join customer_service_ai_attempts attempts on attempts.id = jobs.text_attempt_id
            where attempts.status = 'draft_ready') as image_aware_drafts_generated,
          (select count(*) from customer_service_feedback_events feedback
            join customer_service_image_jobs jobs on jobs.text_attempt_id = feedback.attempt_id
            where feedback.action = 'accepted_unchanged') as image_aware_accepted_unchanged,
          (select count(*) from customer_service_feedback_events feedback
            join customer_service_image_jobs jobs on jobs.text_attempt_id = feedback.attempt_id
            where feedback.action = 'edited') as image_aware_edited_accepted,
          (select count(*) from customer_service_feedback_events feedback
            join customer_service_image_jobs jobs on jobs.text_attempt_id = feedback.attempt_id
            where feedback.action = 'rejected') as image_aware_rejected,
          (select count(*) from customer_service_image_analysis_attempts
            where status = 'analyzed' and analysis_result->'recommendationCodes' ? 'send_original_file') as image_request_original_recommendations,
          (select coalesce(sum(
              coalesce(image_attempts.estimated_cost_microusd, 0)
              + coalesce(text_attempts.estimated_cost_microusd, 0)
            ), 0)
            from customer_service_image_jobs jobs
            left join customer_service_image_analysis_attempts image_attempts on image_attempts.id = jobs.image_analysis_attempt_id
            left join customer_service_ai_attempts text_attempts on text_attempts.id = jobs.text_attempt_id) as image_aware_total_cost_microusd,
          (select count(*) from customer_service_conversation_events where role = 'staff') as total_actual_human_replies,
          (select count(*) from customer_service_human_reply_matches where status = 'matched') as matched_human_replies,
          (select count(*) from customer_service_human_reply_matches where status = 'unmatched') as unmatched_human_replies,
          (select count(*) from customer_service_human_reply_matches where edit_classification = 'accepted_unchanged') as accepted_unchanged_human_replies,
          (select count(*) from customer_service_human_reply_matches
            where edit_classification in ('edited_light', 'edited_significant')) as edited_human_replies,
          (select count(*) from customer_service_human_reply_matches
            where edit_classification in ('ai_ignored', 'independent_reply')) as independently_written_human_replies,
          (select count(*) from customer_service_case_memories where eligibility_status = 'approved_reusable') as reusable_case_memories,
          (select count(*) from customer_service_case_memories
            where eligibility_status = 'excluded' and exclusion_codes <> '[]'::jsonb) as excluded_high_risk_cases,
          (select count(*) from customer_service_case_retrievals where injected) as cases_retrieved_in_drafts,
          (select count(*) from customer_service_learning_candidates where status = 'pending') as learning_candidates_pending,
          (select count(*) from customer_service_learning_candidates where status = 'approved') as learning_candidates_approved,
          (select count(*) from customer_service_learning_candidates where status = 'rejected') as learning_candidates_rejected,
          jsonb_build_object(
            'facebook', ${channelMetricCountsSql("facebook")},
            'website', ${channelMetricCountsSql("website")}
          ) as channel_metrics,
          (select coalesce(jsonb_agg(jsonb_build_object('code', reasons.code, 'count', reasons.reason_count)
            order by reasons.reason_count desc, reasons.code), '[]'::jsonb)
            from (
              select reason.value as code, count(*)::integer as reason_count
              from customer_service_human_reply_matches matches
              cross join lateral jsonb_array_elements_text(matches.edit_reason_codes) reason(value)
              group by reason.value
              order by reason_count desc, reason.value
              limit 5
            ) reasons) as common_edit_reasons
      `);
      const row = result.rows[0] as Record<string, unknown>;
      const count = (name: string) => Number(row[name] ?? 0);
      const commonEditReasons = Array.isArray(row.common_edit_reasons)
        ? row.common_edit_reasons.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const value = item as Record<string, unknown>;
          return typeof value.code === "string"
            ? [{ code: value.code, count: Number(value.count ?? 0) }]
            : [];
        })
        : [];
      return {
        totalIncomingEligible: count("total_incoming_eligible"),
        rawCustomerEvents: count("raw_customer_events"),
        staffContextEvents: count("staff_context_events"),
        meaningfulTurns: count("meaningful_turns"),
        aggregatedFragments: count("aggregated_fragments"),
        acknowledgementsSuppressed: count("acknowledgements_suppressed"),
        draftsGenerated: count("drafts_generated"),
        acceptedUnchanged: count("accepted_unchanged"),
        editedAccepted: count("edited_accepted"),
        rejected: count("rejected"),
        gateBlocked: count("gate_blocked"),
        outputValidatorBlocked: count("output_validator_blocked"),
        providerCalls: count("provider_calls"),
        policyViolationAttempts: count("policy_violation_attempts"),
        totalCostMicrousd: count("total_cost_microusd"),
        totalLatencyMs: count("total_latency_ms"),
        imageProviderCalls: count("image_provider_calls"),
        imageInputTokens: count("image_input_tokens"),
        imageCachedInputTokens: count("image_cached_input_tokens"),
        imageOutputTokens: count("image_output_tokens"),
        imageTotalCostMicrousd: count("image_total_cost_microusd"),
        imageTotalLatencyMs: count("image_total_latency_ms"),
        imageFailures: count("image_failures"),
        imageCleanupDeleted: count("image_cleanup_deleted"),
        imageCleanupFailures: count("image_cleanup_failures"),
        imageContexts: count("image_contexts"),
        imageAnalysesSucceeded: count("image_analyses_succeeded"),
        imageAnalysesBlocked: count("image_analyses_blocked"),
        imageAwareDraftsGenerated: count("image_aware_drafts_generated"),
        imageAwareAcceptedUnchanged: count("image_aware_accepted_unchanged"),
        imageAwareEditedAccepted: count("image_aware_edited_accepted"),
        imageAwareRejected: count("image_aware_rejected"),
        imageRequestOriginalRecommendations: count("image_request_original_recommendations"),
        imageAwareTotalCostMicrousd: count("image_aware_total_cost_microusd"),
        totalActualHumanReplies: count("total_actual_human_replies"),
        matchedHumanReplies: count("matched_human_replies"),
        unmatchedHumanReplies: count("unmatched_human_replies"),
        acceptedUnchangedHumanReplies: count("accepted_unchanged_human_replies"),
        editedHumanReplies: count("edited_human_replies"),
        independentlyWrittenHumanReplies: count("independently_written_human_replies"),
        reusableCaseMemories: count("reusable_case_memories"),
        excludedHighRiskCases: count("excluded_high_risk_cases"),
        casesRetrievedInDrafts: count("cases_retrieved_in_drafts"),
        learningCandidatesPending: count("learning_candidates_pending"),
        learningCandidatesApproved: count("learning_candidates_approved"),
        learningCandidatesRejected: count("learning_candidates_rejected"),
        commonEditReasons,
        channelMetrics: {
          facebook: parseChannelMetricCounts(
            (row.channel_metrics as Record<string, unknown> | undefined)?.facebook,
          ),
          website: parseChannelMetricCounts(
            (row.channel_metrics as Record<string, unknown> | undefined)?.website,
          ),
        },
      };
    },
  };
  return repository;
}
