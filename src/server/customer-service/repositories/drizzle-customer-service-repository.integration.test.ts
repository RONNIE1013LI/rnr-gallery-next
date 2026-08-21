import { createHash, createHmac, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversationEvents,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceCaseMemories,
  customerServiceCaseRetrievals,
  customerServiceHumanReplyMatches,
  customerServiceHumanReplyMatchEvents,
  customerServiceHumanReviews,
  customerServiceReviewAlertOutbox,
  customerServiceReviewSelectors,
  customerServiceLearningCandidates,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
  customerServiceMessages,
  customerServicePilotRuns,
  customerServiceRateLimitBuckets,
  customerServiceTurns,
  customerServiceUiChanges,
  customerServiceUiRevision,
  customerServiceWebSessions,
  customerServiceWebsiteAssistantMessages,
  customerServiceWebsiteBudgetState,
  user,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { EmailDeliveryError } from "@/server/notifications/customer-notification-service";
import { createCustomerTurnRecoveryRunner } from "../turn-recovery-runner";
import {
  createReviewAlertService,
  createReviewAlertToken,
  hashReviewAlertToken,
} from "../website/review-alert-service";
import { REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS } from "../website/review-alert-policy";
import {
  WEBSITE_RESPONSE_TEMPLATE_VERSION,
  type WebsiteDecision,
} from "../website/structured-decision";
import { createDrizzleCustomerServiceRepository } from "./drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const reviewSelectorSecret = "task-13-review-selector-secret-at-least-32-bytes";
const reviewAlertProviderScopeFingerprint = "a1".repeat(32);
const approvedWebsiteDesignResponse = "We’ll collect your photos, wording, theme and colour preferences.\nWe’ll then prepare a design draft for you to review before printing.";
const approvedWebsiteDesignDecision: WebsiteDecision = Object.freeze({
  response_type: "ANSWER_SAFE",
  intent: "design_process",
  product_type: "UNSPECIFIED",
  missing_fields: [],
  follow_up_fields: [],
  allowed_facts: ["DESIGN_INPUTS", "DESIGN_DRAFT_REVIEW_BEFORE_PRINTING"] as const,
  human_review_reason: "NONE",
});
const approvedWebsiteDesignProof = Object.freeze({
  websiteDecision: approvedWebsiteDesignDecision,
  websiteResponseTemplateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
});
const selectorTestNow = () => new Date("2026-08-22T00:00:00.000Z");
const repository = createDrizzleCustomerServiceRepository(database, { reviewSelectorSecret, now: selectorTestNow });
const competingPool = new Pool({ connectionString: testDatabaseUrl ?? "postgres://disabled.invalid/test" });
const competingRepository = createDrizzleCustomerServiceRepository(drizzle(competingPool), {
  reviewSelectorSecret,
  now: selectorTestNow,
});
const publicationRacePool = new Pool({
  connectionString: testDatabaseUrl ?? "postgres://disabled.invalid/test",
  application_name: "task8_publication_race",
});
const publicationRaceRepository = createDrizzleCustomerServiceRepository(drizzle(publicationRacePool), {
  reviewSelectorSecret,
  now: selectorTestNow,
});
const sourceIdentitySecret = "integration-source-identity-secret";
const selectorBase64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function sourceHash(value: string) {
  return createHmac("sha256", sourceIdentitySecret).update(value).digest("hex");
}

function nonCanonicalSelectorAliases(selector: string) {
  const [version, expiry, mac] = selector.split(".");
  const canonicalIndex = selectorBase64urlAlphabet.indexOf(mac.at(-1) ?? "");
  if (!version || !expiry || !mac || canonicalIndex < 0 || canonicalIndex % 4 !== 0) {
    throw new Error("expected canonical website review selector");
  }
  return [
    `${version}.0${expiry}.${mac}`,
    `${selector.slice(0, -1)}${selectorBase64urlAlphabet[canonicalIndex + 1]}`,
    `${selector.slice(0, -1)}${selectorBase64urlAlphabet[canonicalIndex + 2]}`,
    `${selector.slice(0, -1)}${selectorBase64urlAlphabet[canonicalIndex + 3]}`,
  ] as const;
}

function reviewTokenFromAlertText(text: string) {
  const token = new URL(text.trim().split("\n").at(-1) ?? "").searchParams.get("review");
  if (!token) throw new Error("expected review token in alert link");
  return token;
}

function assessedAnalysis(safeSummary = "Image 0 is the likely main candidate.") {
  return {
    schemaVersion: "1" as const,
    overallStatus: "assessed" as const,
    images: [{
      ordinal: 0,
      classification: "customer_photo" as const,
      blur: "mild" as const,
      sourceResolutionSignal: "normal" as const,
      subjectScale: "usable" as const,
      crop: "none_visible" as const,
      obstruction: "none_visible" as const,
      screenshotSignal: "none_visible" as const,
      recommendedRole: "main_candidate" as const,
      issueCodes: [],
    }],
    comparison: null,
    recommendationCodes: ["use_as_main_candidate" as const],
    safeSummary,
  };
}

function imageCompletion(attemptId: string, status: "analyzed" | "provider_error") {
  return {
    attemptId,
    status,
    providerCalled: true,
    provider: "mock" as const,
    model: "mock-image",
    ...(status === "analyzed" ? { analysisResult: assessedAnalysis() } : {}),
    validatorCodes: [],
    inputTokens: 10,
    cachedInputTokens: 2,
    outputTokens: 4,
    estimatedCostMicrousd: 25,
    latencyMs: 5,
    ...(status === "provider_error" ? { providerErrorCode: "image_provider_error" } : {}),
  };
}

async function clearTables() {
  await database.delete(customerServiceWebsiteAssistantMessages);
  await database.delete(customerServiceReviewAlertOutbox);
  await database.delete(customerServiceReviewSelectors);
  await database.delete(customerServiceHumanReviews);
  await database.delete(customerServiceCaseRetrievals);
  await database.delete(customerServiceLearningCandidates);
  await database.delete(customerServiceCaseMemories);
  await database.delete(customerServiceHumanReplyMatchEvents);
  await database.delete(customerServiceHumanReplyMatches);
  await database.delete(customerServiceFeedbackEvents);
  await database.delete(customerServiceImageJobs);
  await database.delete(customerServiceAiAttempts);
  await database.delete(customerServiceImageAnalysisInputs);
  await database.delete(customerServiceImageAnalysisAttempts);
  await database.delete(customerServiceAttachments);
  await database.delete(customerServiceConversationEvents);
  await database.delete(customerServiceTurns);
  await database.delete(customerServiceMessages);
  await database.delete(customerServiceRateLimitBuckets);
  await database.delete(customerServiceWebSessions);
  await database.delete(customerServiceConversations);
  await database.delete(customerServiceWebsiteBudgetState);
  await database.delete(customerServiceBudgetState);
  await database.delete(customerServicePilotRuns);
  await database.delete(customerServiceUiChanges);
  await database.update(customerServiceUiRevision).set({ revision: 0, changedAt: new Date("2026-08-20T00:00:00.000Z") });
}

async function activateFacebookPilot(name: string) {
  await database.insert(customerServicePilotRuns).values({
    name,
    channel: "facebook",
    messageLimit: 100,
    status: "active",
    startedAt: new Date("2026-08-17T00:00:00.000Z"),
  });
}

async function activateWebsitePilot(name: string) {
  await database.insert(customerServicePilotRuns).values({
    name,
    channel: "website",
    messageLimit: 100,
    status: "active",
    startedAt: new Date("2026-08-17T00:00:00.000Z"),
  });
}

async function createRecoveryTurn(input: Readonly<{
  conversationHash: string;
  messageHash: string;
  receivedAt?: Date;
}>) {
  return repository.ingestConversationEvent({
    channel: "facebook",
    role: "customer",
    externalConversationKeyHash: input.conversationHash,
    externalMessageKeyHash: input.messageHash,
    text: "How do I prepare my photos?",
    attachments: [],
    imageJob: null,
    debounceMs: 2_000,
    receivedAt: input.receivedAt ?? new Date("2026-08-19T00:00:00.000Z"),
  });
}

const websiteSessionExpiresAt = new Date("2026-08-26T00:00:00.000Z");
const websiteRateNow = new Date("2026-08-19T00:00:00.000Z");

function websiteRateEvent(input: Readonly<{
  messageHash: string;
  sessionHash: string;
  networkHash: string;
  text?: string;
  receivedAt?: Date;
  isNewSession?: boolean;
}>) {
  return {
    channel: "website" as const,
    role: "customer" as const,
    externalConversationKeyHash: input.sessionHash,
    externalMessageKeyHash: input.messageHash,
    text: input.text ?? "Can you help with a custom banner?",
    attachments: [],
    imageJob: null,
    debounceMs: 2_000,
    receivedAt: input.receivedAt ?? websiteRateNow,
    websiteRateLimit: {
      sessionKeyHash: input.sessionHash,
      networkKeyHash: input.networkHash,
      sessionExpiresAt: websiteSessionExpiresAt,
      isNewSession: input.isNewSession,
    },
  } as Parameters<typeof repository.ingestConversationEvent>[0];
}

async function claimWebsiteTurn(input: Readonly<{
  sessionHash: string;
  networkHash: string;
  messageHash: string;
  receivedAt?: Date;
}>) {
  await activateWebsitePilot(`website-review-${input.messageHash.slice(0, 8)}`);
  return ingestAndClaimWebsiteTurn(input);
}

async function ingestAndClaimWebsiteTurn(input: Readonly<{
  sessionHash: string;
  networkHash: string;
  messageHash: string;
  receivedAt?: Date;
}>) {
  const incoming = await repository.ingestConversationEvent(websiteRateEvent(input));
  if (incoming.status !== "turn_pending") throw new Error("expected website turn");
  const claimed = await repository.claimDueCustomerTurn({
    turnId: incoming.turnId,
    now: new Date((input.receivedAt ?? websiteRateNow).getTime() + 2_000),
    leaseExpiresAt: new Date((input.receivedAt ?? websiteRateNow).getTime() + 302_000),
  });
  if (!claimed || claimed.channel !== "website") throw new Error("expected claimed website turn");
  return claimed;
}

async function waitForAdvisoryLockWaiter(minimum = 1) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await database.execute(sql`
      select count(*)::int as waiting
      from pg_stat_activity
      where pid <> pg_backend_pid() and wait_event_type = 'Lock'
    `);
    const row = result.rows[0] as { waiting?: number } | undefined;
    if ((row?.waiting ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("database advisory lock waiter not observed");
}

async function openTask13Review(input: Readonly<{
  sessionHash: string;
  networkHash: string;
  messageHash: string;
  reviewId: string;
}>) {
  const claimed = await claimWebsiteTurn(input);
  const attemptId = await repository.createGateBlockedAttempt({
    messageId: claimed.messageId,
    trigger: "webhook_after",
    intent: "refund",
    riskLevel: "high",
    gateResult: "high_risk",
    gateReasons: ["high_risk_topic"],
    knowledgeVersion: "knowledge-v1",
  });
  await repository.openWebsiteHumanReview({
    turnId: claimed.turnId,
    leaseToken: claimed.leaseToken,
    attemptId,
    outcome: "gate_blocked",
    now: new Date("2026-08-21T00:00:02.000Z"),
    knowledgeVersion: "knowledge-v1",
    reviewAlert: {
      reviewId: input.reviewId,
      deepLinkTokenHash: createHash("sha256").update(input.reviewId).digest("hex"),
      deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
      idempotencyKey: `review-alert:${input.reviewId}`,
    },
  });
  const [turn] = await database.select({ conversationId: customerServiceTurns.conversationId })
    .from(customerServiceTurns).where(eq(customerServiceTurns.id, claimed.turnId));
  const selector = (await repository.listQueue(100)).items
    .find((item) => item.messageId === claimed.messageId)?.websiteReview?.selector;
  if (!selector) throw new Error("expected website review selector");
  return { ...claimed, conversationId: turn.conversationId, selector };
}

async function createTask13RunningTurn(input: Readonly<{
  conversationId: string;
  messageHash: string;
  text: string;
  receivedAt: Date;
}>) {
  const [message] = await database.insert(customerServiceMessages).values({
    conversationId: input.conversationId,
    channel: "website",
    externalMessageKeyHash: input.messageHash,
    body: input.text,
    customerText: input.text,
    receivedAt: input.receivedAt,
    ingestStatus: "processing",
  }).returning({ id: customerServiceMessages.id });
  const leaseToken = randomUUID();
  const [turn] = await database.insert(customerServiceTurns).values({
    conversationId: input.conversationId,
    channel: "website",
    representativeMessageId: message.id,
    body: input.text,
    status: "sealed",
    debounceUntil: input.receivedAt,
    openedAt: input.receivedAt,
    lastEventAt: input.receivedAt,
    sealedAt: input.receivedAt,
    processingStatus: "running",
    processingLeaseToken: leaseToken,
    processingLeaseExpiresAt: new Date(input.receivedAt.getTime() + 300_000),
    processingAttempts: 1,
    nextRunAt: input.receivedAt,
  }).returning({ id: customerServiceTurns.id });
  return { turnId: turn.id, messageId: message.id, leaseToken };
}

describe.runIf(enabled)("DrizzleCustomerServiceRepository", () => {
  beforeEach(clearTables);
  afterAll(async () => {
    await clearTables();
    await competingPool.end();
    await publicationRacePool.end();
  });

  it("has additive continuous-learning tables with fail-closed defaults", async () => {
    const tables = await database.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'customer_service_human_reply_matches',
          'customer_service_human_reply_match_events',
          'customer_service_case_memories',
          'customer_service_case_retrievals',
          'customer_service_learning_candidates'
        )
      order by table_name
    `);

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "customer_service_case_memories",
      "customer_service_case_retrievals",
      "customer_service_human_reply_match_events",
      "customer_service_human_reply_matches",
      "customer_service_learning_candidates",
    ]);

    const eventColumns = await database.execute(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customer_service_conversation_events'
        and column_name in (
          'event_type',
          'body_hash',
          'redaction_codes',
          'reply_to_external_message_key_hash',
          'learning_eligible'
        )
      order by column_name
    `);
    expect(eventColumns.rows).toHaveLength(5);
  });

  it("opens one website review generation for repeated blocked turns, then creates a new one after resolution", async () => {
    const first = await claimWebsiteTurn({
      sessionHash: "61".repeat(32),
      networkHash: "62".repeat(32),
      messageHash: "63".repeat(32),
    });
    const firstAttemptId = await repository.createGateBlockedAttempt({
      messageId: first.messageId,
      trigger: "webhook_after",
      intent: "quote_information_collection",
      riskLevel: "high",
      gateResult: "realtime_required",
      gateReasons: ["current_price"],
      knowledgeVersion: "website-knowledge-v2",
    });
    const firstReview = await repository.openWebsiteHumanReview({
      turnId: first.turnId,
      leaseToken: first.leaseToken,
      attemptId: firstAttemptId,
      outcome: "realtime_required",
      now: new Date("2026-08-19T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
    });
    expect(firstReview).toMatchObject({ status: "opened", generation: 1 });
    await repository.completeCustomerTurnProcessing({
      turnId: first.turnId,
      leaseToken: first.leaseToken,
      now: new Date("2026-08-19T00:00:02.000Z"),
      outcome: "realtime_required",
    });

    const secondIncoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "61".repeat(32),
      networkHash: "62".repeat(32),
      messageHash: "64".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:04.000Z"),
    }));
    if (secondIncoming.status !== "turn_pending") throw new Error("expected second website turn");
    const second = await repository.claimDueCustomerTurn({
      turnId: secondIncoming.turnId,
      now: new Date("2026-08-19T00:00:06.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:06.000Z"),
    });
    if (!second || second.channel !== "website") throw new Error("expected second claimed website turn");
    const secondAttemptId = await repository.createGateBlockedAttempt({
      messageId: second.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const secondReview = await repository.openWebsiteHumanReview({
      turnId: second.turnId,
      leaseToken: second.leaseToken,
      attemptId: secondAttemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-19T00:00:06.000Z"),
      knowledgeVersion: "knowledge-v1",
    });
    expect(secondReview).toMatchObject({ status: "reused", generation: 1 });
    expect(secondReview).toMatchObject({ reviewId: (firstReview as { reviewId: string }).reviewId });
    await repository.completeCustomerTurnProcessing({
      turnId: second.turnId,
      leaseToken: second.leaseToken,
      now: new Date("2026-08-19T00:00:06.000Z"),
      outcome: "gate_blocked",
    });

    const [storedReview] = await database.select().from(customerServiceHumanReviews);
    const [resolutionEvent] = await database.insert(customerServiceConversationEvents).values({
      conversationId: storedReview.conversationId,
      channel: "website",
      externalMessageKeyHash: "65".repeat(32),
      role: "staff",
      eventType: "system_event",
      body: "Review resolved",
      redactionCodes: [],
      learningEligible: false,
      receivedAt: new Date("2026-08-19T00:00:07.000Z"),
    }).returning({ id: customerServiceConversationEvents.id });
    await database.update(customerServiceHumanReviews).set({
      status: "resolved",
      resolvedAt: new Date("2026-08-19T00:00:07.000Z"),
      resolutionEventId: resolutionEvent.id,
    }).where(eq(customerServiceHumanReviews.id, storedReview.id));

    const thirdIncoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "61".repeat(32),
      networkHash: "62".repeat(32),
      messageHash: "66".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:08.000Z"),
    }));
    if (thirdIncoming.status !== "turn_pending") throw new Error("expected third website turn");
    const third = await repository.claimDueCustomerTurn({
      turnId: thirdIncoming.turnId,
      now: new Date("2026-08-19T00:00:10.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:10.000Z"),
    });
    if (!third || third.channel !== "website") throw new Error("expected third claimed website turn");
    const thirdReview = await repository.openWebsiteHumanReview({
      turnId: third.turnId,
      leaseToken: third.leaseToken,
      attemptId: null,
      outcome: "provider_error",
      now: new Date("2026-08-19T00:00:10.000Z"),
      knowledgeVersion: "knowledge-v1",
    });
    expect(thirdReview).toMatchObject({ status: "opened", generation: 2 });

    const reviews = await database.select({
      generation: customerServiceHumanReviews.generation,
      status: customerServiceHumanReviews.status,
    }).from(customerServiceHumanReviews).orderBy(asc(customerServiceHumanReviews.generation));
    const acknowledgements = await database.select({
      policyResult: customerServiceWebsiteAssistantMessages.policyResult,
      body: customerServiceWebsiteAssistantMessages.body,
    }).from(customerServiceWebsiteAssistantMessages)
      .orderBy(asc(customerServiceWebsiteAssistantMessages.publishedAt));
    expect(reviews).toEqual([{ generation: 1, status: "resolved" }, { generation: 2, status: "open" }]);
    expect(acknowledgements).toHaveLength(3);
    expect(acknowledgements[0]).toMatchObject({
      policyResult: "realtime_required",
      body: "I can help collect the details for our team. Please send the product, size, number of people/photos, required date, and your suburb or postcode if delivery is needed. We’ll review the current details and get back to you.",
    });
  });

  it("uses the review and acknowledgement uniqueness constraints when two workers race", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "71".repeat(32),
      networkHash: "72".repeat(32),
      messageHash: "73".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const input = {
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked" as const,
      now: new Date("2026-08-19T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
    };

    const results = await Promise.all([
      repository.openWebsiteHumanReview(input),
      repository.openWebsiteHumanReview(input),
    ]);
    const reviews = await database.select().from(customerServiceHumanReviews);
    const acknowledgements = await database.select().from(customerServiceWebsiteAssistantMessages);

    expect(results.filter((result) => result.status === "opened")).toHaveLength(1);
    expect(results.filter((result) => result.status === "reused")).toHaveLength(1);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ generation: 1, reason: "high_risk", status: "open" });
    expect(acknowledgements).toHaveLength(1);
  });

  it("atomically creates one durable alert outbox row with a new human-review incident", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "a1".repeat(32),
      networkHash: "a2".repeat(32),
      messageHash: "a3".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });

    const result = await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId: "00000000-0000-4000-8000-000000000111",
        deepLinkTokenHash: "ab".repeat(32),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000111",
      },
    });

    expect(result).toMatchObject({ status: "opened", reviewId: "00000000-0000-4000-8000-000000000111" });
    const reviews = await database.select().from(customerServiceHumanReviews);
    const outbox = await database.select().from(customerServiceReviewAlertOutbox);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      deepLinkTokenHash: "ab".repeat(32),
      deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      humanReviewId: reviews[0].id,
      idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000111",
      status: "pending",
      attemptCount: 0,
    });
  });

  it("exposes only a queue-scoped website review selector and resolves a valid unexpired deep link", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "81".repeat(32),
      networkHash: "82".repeat(32),
      messageHash: "83".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const reviewId = "00000000-0000-4000-8000-000000000131";
    const deepLinkSecret = "task-13-review-link-secret-at-least-32-bytes";
    const rawToken = createReviewAlertToken({ reviewId, secret: deepLinkSecret });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId,
        deepLinkTokenHash: hashReviewAlertToken(rawToken),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: `review-alert:${reviewId}`,
      },
    });

    const queue = await repository.listQueue(100);

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      channel: "website",
      latestAttemptId: null,
      draftText: null,
      websiteReview: {
        selector: expect.stringMatching(/^wrs1\.[a-z0-9]+\.[A-Za-z0-9_-]{43}$/),
        reason: "high_risk",
        alertStatus: "pending",
      },
      timeline: [
        { role: "customer", text: "Can you help with a custom banner?" },
        { role: "assistant", text: "Thanks for letting us know. Our team needs to review this before replying, and we’ll get back to you as soon as we can." },
      ],
    });
    const reviewSelector = queue.items[0].websiteReview?.selector;
    if (!reviewSelector) throw new Error("expected opaque website review selector");
    expect(reviewSelector).not.toContain(reviewId);
    expect(JSON.stringify(queue)).not.toContain(reviewId);
    expect(JSON.stringify(queue)).not.toContain(rawToken);
    const newerConversations = await database.insert(customerServiceConversations).values(
      Array.from({ length: 100 }, (_, index) => ({
        channel: "facebook" as const,
        externalKeyHash: createHash("sha256").update(`task-13-newer-conversation-${index}`).digest("hex"),
      })),
    ).returning({ id: customerServiceConversations.id });
    await database.insert(customerServiceMessages).values(newerConversations.map((conversation, index) => ({
      conversationId: conversation.id,
      channel: "facebook" as const,
      externalMessageKeyHash: createHash("sha256").update(`task-13-newer-message-${index}`).digest("hex"),
      body: `Newer queue item ${index}`,
      receivedAt: new Date(Date.UTC(2026, 7, 22, 1, 0, 0, index)),
    })));
    const newestQueue = await repository.listQueue(100);
    expect(newestQueue.items.map((item) => item.messageId)).not.toContain(claimed.messageId);

    const resolvedDeepLink = await repository.resolveWebsiteReviewDeepLink({
      tokenHash: hashReviewAlertToken(rawToken),
      now: new Date("2026-08-22T00:00:00.000Z"),
    });
    expect(resolvedDeepLink).toMatchObject({
      selector: reviewSelector,
      item: {
        messageId: claimed.messageId,
        channel: "website",
        websiteReview: { selector: reviewSelector },
      },
    });
    expect(JSON.stringify(resolvedDeepLink)).not.toContain(reviewId);
    await expect(repository.resolveWebsiteReviewDeepLink({
      tokenHash: "ff".repeat(32),
      now: new Date("2026-08-22T00:00:00.000Z"),
    })).resolves.toBeNull();
    await expect(repository.resolveWebsiteReviewDeepLink({
      tokenHash: hashReviewAlertToken(rawToken),
      now: new Date("2026-08-28T00:00:02.000Z"),
    })).resolves.toBeNull();

    const cursor = await repository.getReplyAssistantUiCursor();
    const alert = await repository.claimDueReviewAlert({
      now: new Date("2026-08-22T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-22T00:05:00.000Z"),
    });
    if (!alert) throw new Error("expected alert claim");
    await expect(repository.confirmClaimedReviewAlert({
      id: alert.id,
      leaseToken: alert.leaseToken,
      now: new Date("2026-08-22T00:00:01.000Z"),
    })).resolves.toBe(true);
    await expect(repository.beginClaimedReviewAlertSend({
      id: alert.id,
      leaseToken: alert.leaseToken,
      payloadDigest: "a1".repeat(32),
      now: new Date("2026-08-22T00:00:01.000Z"),
    })).resolves.toBe("send");
    await expect(repository.markReviewAlertSent({
      id: alert.id,
      leaseToken: alert.leaseToken,
      providerMessageId: "resend-task-13",
      now: new Date("2026-08-22T00:00:01.000Z"),
    })).resolves.toBe(true);
    const update = await repository.listReplyAssistantUpdates(cursor, 250);
    expect(update.queueItems[0]).toMatchObject({
      websiteReview: { selector: reviewSelector, alertStatus: "sent" },
    });
  });

  it("renews a bounded selector for an open day-31 review and rejects textual aliases generically", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "84".repeat(32),
      networkHash: "85".repeat(32),
      messageHash: "86".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
    });
    await database.insert(user).values({
      id: "task-13-renewed-selector-staff",
      name: "Renewed Selector Staff",
      email: "task-13-renewed-selector@example.test",
      role: "staff",
    }).onConflictDoNothing();
    let selectorNow = new Date("2026-08-21T12:00:00.000Z");
    const timedRepository = createDrizzleCustomerServiceRepository(database, {
      reviewSelectorSecret,
      now: () => selectorNow,
    });
    const original = (await timedRepository.listQueue(100)).items[0].websiteReview?.selector;
    if (!original) throw new Error("expected original website review selector");
    await expect(timedRepository.listQueue(100)).resolves.toMatchObject({
      items: [{ websiteReview: { selector: original } }],
    });

    selectorNow = new Date("2026-09-21T12:00:00.000Z");
    const renewed = (await timedRepository.listQueue(100)).items[0].websiteReview?.selector;
    if (!renewed) throw new Error("expected renewed website review selector");
    expect(renewed).not.toBe(original);
    for (const alias of nonCanonicalSelectorAliases(renewed)) {
      await expect(timedRepository.answerWebsiteReview({
        reviewSelector: alias,
        text: "Alias must not send.",
        actorUserId: "task-13-renewed-selector-staff",
        now: selectorNow,
      })).resolves.toEqual({ status: "unavailable" });
    }
    await expect(timedRepository.answerWebsiteReview({
      reviewSelector: original,
      text: "Expired selector must not send.",
      actorUserId: "task-13-renewed-selector-staff",
      now: selectorNow,
    })).resolves.toEqual({ status: "unavailable" });
    await expect(timedRepository.answerWebsiteReview({
      reviewSelector: renewed,
      text: "Fresh day-31 selector sends.",
      actorUserId: "task-13-renewed-selector-staff",
      now: selectorNow,
    })).resolves.toEqual({ status: "sent" });
  });

  it("atomically replaces a same-window old-secret selector and emits only the persisted current selector", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "8a".repeat(32),
      networkHash: "8b".repeat(32),
      messageHash: "8c".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
    });
    await database.insert(user).values({
      id: "task-13-selector-rotation-staff",
      name: "Selector Rotation Staff",
      email: "task-13-selector-rotation@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const issuanceTime = new Date("2026-08-22T12:00:00.000Z");
    const oldRepository = createDrizzleCustomerServiceRepository(database, {
      reviewSelectorSecret: "task-13-old-review-selector-secret-at-least-32-bytes",
      now: () => issuanceTime,
    });
    const currentRepository = createDrizzleCustomerServiceRepository(database, {
      reviewSelectorSecret: "task-13-current-review-selector-secret-at-least-32-bytes",
      now: () => issuanceTime,
    });
    const competingCurrentRepository = createDrizzleCustomerServiceRepository(drizzle(competingPool), {
      reviewSelectorSecret: "task-13-current-review-selector-secret-at-least-32-bytes",
      now: () => issuanceTime,
    });
    const oldSelector = (await oldRepository.listQueue(100)).items[0].websiteReview?.selector;
    if (!oldSelector) throw new Error("expected old-secret selector");

    const [firstQueue, secondQueue] = await Promise.all([
      currentRepository.listQueue(100),
      competingCurrentRepository.listQueue(100),
    ]);
    const firstCurrentSelector = firstQueue.items[0].websiteReview?.selector;
    const secondCurrentSelector = secondQueue.items[0].websiteReview?.selector;
    if (!firstCurrentSelector || !secondCurrentSelector) throw new Error("expected current-secret selectors");

    expect(firstCurrentSelector).toBe(secondCurrentSelector);
    expect(firstCurrentSelector).not.toBe(oldSelector);
    const selectors = await database.select().from(customerServiceReviewSelectors);
    expect(selectors).toHaveLength(1);
    expect(selectors[0]).toMatchObject({
      selectorHash: createHash("sha256").update(firstCurrentSelector).digest("hex"),
    });
    expect(JSON.stringify(firstQueue)).not.toContain(selectors[0].humanReviewId);
    expect(JSON.stringify(selectors[0])).not.toContain(firstCurrentSelector);
    await expect(oldRepository.answerWebsiteReview({
      reviewSelector: oldSelector,
      text: "An old deployment selector must fail closed.",
      actorUserId: "task-13-selector-rotation-staff",
      now: issuanceTime,
    })).resolves.toEqual({ status: "unavailable" });
    await expect(currentRepository.answerWebsiteReview({
      reviewSelector: firstCurrentSelector,
      text: "The coordinated current-secret selector remains usable.",
      actorUserId: "task-13-selector-rotation-staff",
      now: issuanceTime,
    })).resolves.toEqual({ status: "sent" });
  });

  it("resolves a selector with one indexed candidate lookup instead of scanning review history", async () => {
    const target = await openTask13Review({
      sessionHash: "87".repeat(32),
      networkHash: "88".repeat(32),
      messageHash: "89".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000161",
    });
    await database.insert(user).values({
      id: "task-13-indexed-selector-staff",
      name: "Indexed Selector Staff",
      email: "task-13-indexed-selector@example.test",
      role: "staff",
    }).onConflictDoNothing();

    const conversations = await database.insert(customerServiceConversations).values(
      Array.from({ length: 250 }, (_, index) => ({
        channel: "website" as const,
        externalKeyHash: createHash("sha256").update(`task-13-selector-history-${index}`).digest("hex"),
      })),
    ).returning({ id: customerServiceConversations.id });
    const messages = await database.insert(customerServiceMessages).values(
      conversations.map((conversation, index) => ({
        conversationId: conversation.id,
        channel: "website" as const,
        externalMessageKeyHash: createHash("sha256").update(`task-13-selector-message-${index}`).digest("hex"),
        body: `Historical review ${index}`,
        customerText: `Historical review ${index}`,
        receivedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)),
      })),
    ).returning({ id: customerServiceMessages.id, conversationId: customerServiceMessages.conversationId });
    const turns = await database.insert(customerServiceTurns).values(messages.map((message, index) => ({
      conversationId: message.conversationId,
      channel: "website" as const,
      representativeMessageId: message.id,
      body: `Historical review ${index}`,
      status: "sealed" as const,
      debounceUntil: new Date("2026-07-01T00:00:00.000Z"),
      openedAt: new Date("2026-07-01T00:00:00.000Z"),
      lastEventAt: new Date("2026-07-01T00:00:00.000Z"),
      sealedAt: new Date("2026-07-01T00:00:00.000Z"),
      processingStatus: "completed" as const,
      processingCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
      nextRunAt: new Date("2026-07-01T00:00:00.000Z"),
    }))).returning({ id: customerServiceTurns.id, conversationId: customerServiceTurns.conversationId });
    await database.insert(customerServiceHumanReviews).values(turns.map((turn) => ({
      conversationId: turn.conversationId,
      channel: "website" as const,
      triggerTurnId: turn.id,
      generation: 1,
      reason: "unresolved" as const,
      status: "open" as const,
      redactedSummary: "Historical Website review.",
      openedAt: new Date("2026-07-01T00:00:00.000Z"),
    })));

    const selectorQueries: string[] = [];
    const selectorPool = new Pool({ connectionString: testDatabaseUrl });
    const boundedRepository = createDrizzleCustomerServiceRepository(drizzle(selectorPool, {
      logger: { logQuery: (query) => { selectorQueries.push(query); } },
    }), { reviewSelectorSecret, now: selectorTestNow });
    try {
      await expect(boundedRepository.answerWebsiteReview({
        reviewSelector: target.selector,
        text: "Indexed selector lookup found only the authorized review.",
        actorUserId: "task-13-indexed-selector-staff",
        now: selectorTestNow(),
      })).resolves.toEqual({ status: "sent" });
    } finally {
      await selectorPool.end();
    }

    expect(selectorQueries.filter((query) => query.includes("customer_service_review_selectors"))).toHaveLength(1);
    expect(selectorQueries.some((query) => (
      query.includes('from "customer_service_human_reviews"')
      && query.includes('"customer_service_human_reviews"."channel" = $1')
    ))).toBe(false);
  });

  it("atomically answers one website review, seals stale work, publishes once, and is idempotent", async () => {
    const sessionHash = "91".repeat(32);
    const claimed = await claimWebsiteTurn({
      sessionHash,
      networkHash: "92".repeat(32),
      messageHash: "93".repeat(32),
    });
    const reviewId = "00000000-0000-4000-8000-000000000132";
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId,
        deepLinkTokenHash: "ab".repeat(32),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: `review-alert:${reviewId}`,
      },
    });
    const reviewSelector = (await repository.listQueue(100)).items
      .find((item) => item.channel === "website")?.websiteReview?.selector;
    if (!reviewSelector) throw new Error("expected website review selector");
    await repository.completeCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      now: new Date("2026-08-21T00:00:02.000Z"),
      outcome: "gate_blocked",
    });
    const later = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash: "92".repeat(32),
      messageHash: "94".repeat(32),
      text: "One more detail before you reply",
      receivedAt: new Date("2026-08-21T00:00:03.000Z"),
    }));
    if (later.status !== "turn_pending") throw new Error("expected pending website turn");
    await database.insert(customerServiceAiAttempts).values({
      messageId: later.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "allowed",
      gateReasons: [],
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock",
      draftText: "Stale internal draft",
      completedAt: new Date("2026-08-21T00:00:03.500Z"),
    });
    await database.insert(user).values({
      id: "task-13-staff",
      name: "Task 13 Staff",
      email: "task-13-staff@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const beforeMetrics = await repository.metricCounts();
    const cursor = await repository.getReplyAssistantUiCursor();
    const input = {
      reviewSelector,
      text: "We have reviewed this for you.",
      actorUserId: "task-13-staff",
      now: new Date("2026-08-21T00:00:04.000Z"),
    };

    const results = await Promise.all([
      repository.answerWebsiteReview(input),
      competingRepository.answerWebsiteReview(input),
    ]);

    expect(results).toEqual(expect.arrayContaining([{ status: "sent" }, { status: "duplicate" }]));
    const outbound = await database.select().from(customerServiceConversationEvents).where(and(
      eq(customerServiceConversationEvents.channel, "website"),
      eq(customerServiceConversationEvents.eventType, "human_outbound"),
    ));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({
      role: "staff",
      body: "We have reviewed this for you.",
      learningEligible: false,
    });
    const [review] = await database.select().from(customerServiceHumanReviews)
      .where(eq(customerServiceHumanReviews.id, reviewId));
    expect(review).toMatchObject({
      status: "resolved",
      resolvedByUserId: "task-13-staff",
      resolutionEventId: outbound[0].id,
    });
    const turns = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.conversationId, review.conversationId));
    expect(turns).toHaveLength(2);
    expect(turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: claimed.turnId, status: "suppressed", processingStatus: "cancelled", suppressionReason: "human_outbound_received" }),
      expect.objectContaining({ id: later.turnId, status: "suppressed", processingStatus: "cancelled", suppressionReason: "human_outbound_received" }),
    ]));
    const [staleAttempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.messageId, later.messageId));
    expect(staleAttempt).toMatchObject({ status: "abandoned", draftText: null });
    await expect(repository.claimDueCustomerTurn({
      turnId: later.turnId,
      now: new Date("2026-08-21T00:10:00.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:15:00.000Z"),
    })).resolves.toBeNull();
    const publicUpdates = await repository.listWebsitePublicUpdates({
      conversationId: review.conversationId,
      after: null,
      limit: 100,
    });
    expect(publicUpdates.filter((update) => update.state === "human_outbound")).toEqual([
      expect.objectContaining({ role: "staff", text: "We have reviewed this for you." }),
    ]);
    const liveUpdate = await repository.listReplyAssistantUpdates(cursor, 250);
    expect(liveUpdate.queueItems[0]).toMatchObject({
      channel: "website",
      humanReplyReceived: true,
      websiteReview: null,
      timeline: expect.arrayContaining([
        expect.objectContaining({ role: "staff", text: "We have reviewed this for you." }),
      ]),
    });
    const afterMetrics = await repository.metricCounts();
    expect(afterMetrics.providerCalls).toBe(beforeMetrics.providerCalls);
    await expect(repository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:00:05.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:05:05.000Z"),
    })).resolves.toBeNull();

    await expect(repository.answerWebsiteReview({ ...input, text: "A different late reply" }))
      .resolves.toEqual({ status: "unavailable" });
    await expect(repository.answerWebsiteReview({ ...input, reviewSelector: "00000000-0000-4000-8000-000000000199" }))
      .resolves.toEqual({ status: "unavailable" });
    await expect(repository.resolveWebsiteReviewDeepLink({
      tokenHash: "ab".repeat(32),
      now: new Date("2026-08-22T00:00:00.000Z"),
    })).resolves.toBeNull();
  });

  it("allows only one of two different staff replies to resolve the same review", async () => {
    const review = await openTask13Review({
      sessionHash: "c4".repeat(32),
      networkHash: "c5".repeat(32),
      messageHash: "c6".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000141",
    });
    await database.insert(user).values([
      { id: "task-13-staff-a", name: "Staff A", email: "task-13-staff-a@example.test", role: "staff" },
      { id: "task-13-staff-b", name: "Staff B", email: "task-13-staff-b@example.test", role: "staff" },
    ]).onConflictDoNothing();

    const results = await Promise.all([
      repository.answerWebsiteReview({
        reviewSelector: review.selector,
        text: "Reply from staff A.",
        actorUserId: "task-13-staff-a",
        now: new Date("2026-08-21T00:00:04.000Z"),
      }),
      competingRepository.answerWebsiteReview({
        reviewSelector: review.selector,
        text: "Different reply from staff B.",
        actorUserId: "task-13-staff-b",
        now: new Date("2026-08-21T00:00:04.000Z"),
      }),
    ]);

    expect(results).toEqual(expect.arrayContaining([{ status: "sent" }, { status: "unavailable" }]));
    const outbound = await database.select().from(customerServiceConversationEvents).where(and(
      eq(customerServiceConversationEvents.conversationId, review.conversationId),
      eq(customerServiceConversationEvents.eventType, "human_outbound"),
    ));
    expect(outbound).toHaveLength(1);
    expect(["Reply from staff A.", "Different reply from staff B."]).toContain(outbound[0].body);
  });

  it("serializes manual resolution ahead of concurrent review reuse without deadlock", async () => {
    const review = await openTask13Review({
      sessionHash: "c7".repeat(32),
      networkHash: "c8".repeat(32),
      messageHash: "c9".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000142",
    });
    const second = await createTask13RunningTurn({
      conversationId: review.conversationId,
      messageHash: "ca".repeat(32),
      text: "A second blocked turn.",
      receivedAt: new Date("2026-08-21T00:00:03.000Z"),
    });
    const secondAttemptId = await repository.createGateBlockedAttempt({
      messageId: second.messageId,
      trigger: "webhook_after",
      intent: "unknown",
      riskLevel: "high",
      gateResult: "unresolved",
      gateReasons: ["unresolved_policy"],
      knowledgeVersion: "knowledge-v1",
    });
    await database.insert(user).values({
      id: "task-13-race-staff",
      name: "Race Staff",
      email: "task-13-race-staff@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const barrierKey = `turn:${review.conversationId}`;
    const barrier = await competingPool.connect();
    await barrier.query("begin");
    await barrier.query("select pg_advisory_xact_lock(hashtext($1))", [barrierKey]);
    let manual: ReturnType<typeof repository.answerWebsiteReview> | null = null;
    let opening: ReturnType<typeof repository.openWebsiteHumanReview> | null = null;
    try {
      manual = repository.answerWebsiteReview({
        reviewSelector: review.selector,
        text: "Manual reply wins the conversation.",
        actorUserId: "task-13-race-staff",
        now: new Date("2026-08-21T00:00:04.000Z"),
      });
      await Promise.race([
        waitForAdvisoryLockWaiter(),
        manual.then((result) => { throw new Error(`manual review bypassed conversation lock: ${result.status}`); }),
      ]);
      opening = publicationRaceRepository.openWebsiteHumanReview({
        turnId: second.turnId,
        leaseToken: second.leaseToken,
        attemptId: secondAttemptId,
        outcome: "gate_blocked",
        now: new Date("2026-08-21T00:00:04.000Z"),
        knowledgeVersion: "knowledge-v1",
      });
      await waitForAdvisoryLockWaiter(2);
      await barrier.query("commit");

      await expect(Promise.all([manual, opening])).resolves.toEqual([
        { status: "sent" },
        { status: "cancelled" },
      ]);
    } finally {
      await barrier.query("rollback").catch(() => undefined);
      await Promise.allSettled([manual, opening].filter(Boolean));
      barrier.release();
    }
  });

  it("prevents stale validated publication when manual resolution enters first", async () => {
    const review = await openTask13Review({
      sessionHash: "cb".repeat(32),
      networkHash: "cc".repeat(32),
      messageHash: "cd".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000143",
    });
    const stale = await createTask13RunningTurn({
      conversationId: review.conversationId,
      messageHash: "ce".repeat(32),
      text: "A stale AI turn.",
      receivedAt: new Date("2026-08-21T00:00:03.000Z"),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: stale.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      gateReasons: [],
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "This stale answer must remain private.",
      validatorCodes: [],
      completedAt: new Date("2026-08-21T00:00:03.500Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await database.insert(user).values({
      id: "task-13-publication-staff",
      name: "Publication Staff",
      email: "task-13-publication-staff@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const barrierKey = `turn:${review.conversationId}`;
    const barrier = await competingPool.connect();
    await barrier.query("begin");
    await barrier.query("select pg_advisory_xact_lock(hashtext($1))", [barrierKey]);
    let manual: ReturnType<typeof repository.answerWebsiteReview> | null = null;
    let publication: ReturnType<typeof repository.publishWebsiteValidatedAi> | null = null;
    try {
      manual = repository.answerWebsiteReview({
        reviewSelector: review.selector,
        text: "A human has answered this conversation.",
        actorUserId: "task-13-publication-staff",
        now: new Date("2026-08-21T00:00:04.000Z"),
      });
      await Promise.race([
        waitForAdvisoryLockWaiter(),
        manual.then((result) => { throw new Error(`manual publication race bypassed conversation lock: ${result.status}`); }),
      ]);
      publication = publicationRaceRepository.publishWebsiteValidatedAi({
        turnId: stale.turnId,
        leaseToken: stale.leaseToken,
        attemptId: attempt.id,
        now: new Date("2026-08-21T00:00:05.000Z"),
      });
      await Promise.race([
        publication.then(() => undefined),
        waitForAdvisoryLockWaiter(2),
      ]);
      await barrier.query("commit");

      await expect(manual).resolves.toEqual({ status: "sent" });
      await expect(publication).resolves.toEqual({ status: "cancelled" });
      const [storedTurn] = await database.select().from(customerServiceTurns)
        .where(eq(customerServiceTurns.id, stale.turnId));
      expect(storedTurn).toMatchObject({
        status: "suppressed",
        processingStatus: "cancelled",
        suppressionReason: "human_outbound_received",
      });
      const published = await database.select().from(customerServiceWebsiteAssistantMessages)
        .where(eq(customerServiceWebsiteAssistantMessages.kind, "validated_ai"));
      expect(published).toHaveLength(0);
    } finally {
      await barrier.query("rollback").catch(() => undefined);
      await Promise.allSettled([manual, publication].filter(Boolean));
      barrier.release();
    }
  });

  it("does not leave a causally stale customer turn runnable when ingest races manual resolution", async () => {
    const review = await openTask13Review({
      sessionHash: "d4".repeat(32),
      networkHash: "d5".repeat(32),
      messageHash: "d6".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000144",
    });
    await repository.completeCustomerTurnProcessing({
      turnId: review.turnId,
      leaseToken: review.leaseToken,
      now: new Date("2026-08-21T00:00:02.500Z"),
      outcome: "gate_blocked",
    });
    await database.insert(user).values({
      id: "task-13-ingest-staff",
      name: "Ingest Staff",
      email: "task-13-ingest-staff@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const barrierKey = `turn:${review.conversationId}`;
    const barrier = await competingPool.connect();
    await barrier.query("begin");
    await barrier.query("select pg_advisory_xact_lock(hashtext($1))", [barrierKey]);
    let manual: ReturnType<typeof repository.answerWebsiteReview> | null = null;
    let incoming: ReturnType<typeof repository.ingestConversationEvent> | null = null;
    try {
      manual = repository.answerWebsiteReview({
        reviewSelector: review.selector,
        text: "A human reply covers the earlier customer message.",
        actorUserId: "task-13-ingest-staff",
        now: new Date("2026-08-21T00:00:04.000Z"),
      });
      await Promise.race([
        waitForAdvisoryLockWaiter(),
        manual.then((result) => { throw new Error(`manual ingest race bypassed conversation lock: ${result.status}`); }),
      ]);
      incoming = competingRepository.ingestConversationEvent(websiteRateEvent({
        sessionHash: "d4".repeat(32),
        networkHash: "d5".repeat(32),
        messageHash: "d7".repeat(32),
        text: "A delayed detail sent before the staff reply.",
        receivedAt: new Date("2026-08-21T00:00:03.500Z"),
      }));
      await Promise.race([
        incoming.then(() => undefined),
        waitForAdvisoryLockWaiter(2),
      ]);
      await barrier.query("commit");

      await expect(manual).resolves.toEqual({ status: "sent" });
      await expect(incoming).resolves.toEqual({ status: "context_only" });
      const [delayedEvent] = await database.select({ turnId: customerServiceConversationEvents.turnId })
        .from(customerServiceConversationEvents)
        .where(eq(customerServiceConversationEvents.externalMessageKeyHash, "d7".repeat(32)));
      const [delayedTurn] = await database.select().from(customerServiceTurns)
        .where(eq(customerServiceTurns.id, delayedEvent.turnId!));
      expect(delayedTurn).toMatchObject({
        status: "suppressed",
        processingStatus: "cancelled",
        suppressionReason: "human_outbound_received",
      });
    } finally {
      await barrier.query("rollback").catch(() => undefined);
      await Promise.allSettled([manual, incoming].filter(Boolean));
      barrier.release();
    }
  });

  it("terminalizes a claimed alert when manual resolution wins before provider send", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "a6".repeat(32),
      networkHash: "a7".repeat(32),
      messageHash: "a8".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const reviewId = "00000000-0000-4000-8000-000000000139";
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId,
        deepLinkTokenHash: "fa".repeat(32),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: `review-alert:${reviewId}`,
      },
    });
    const selector = (await repository.listQueue(100)).items[0].websiteReview?.selector;
    if (!selector) throw new Error("expected website review selector");
    await database.insert(user).values({
      id: "task-13-alert-staff",
      name: "Task 13 Alert Staff",
      email: "task-13-alert-staff@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const alert = await repository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:05:03.000Z"),
    });
    if (!alert) throw new Error("expected claimed alert");

    await expect(competingRepository.answerWebsiteReview({
      reviewSelector: selector,
      text: "We have handled this request.",
      actorUserId: "task-13-alert-staff",
      now: new Date("2026-08-21T00:00:04.000Z"),
    })).resolves.toEqual({ status: "sent" });
    await expect(repository.confirmClaimedReviewAlert({
      id: alert.id,
      leaseToken: alert.leaseToken,
      now: new Date("2026-08-21T00:00:05.000Z"),
    })).resolves.toBe(false);

    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "failed",
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: "review_resolved_before_delivery",
    });
  });

  it("does not call the provider when manual resolution commits after confirmation but before send linearization", async () => {
    const review = await openTask13Review({
      sessionHash: "aa".repeat(32),
      networkHash: "ab".repeat(32),
      messageHash: "ac".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000151",
    });
    await database.insert(user).values({
      id: "task-13-post-confirm-staff",
      name: "Post Confirm Staff",
      email: "task-13-post-confirm@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const provider = {
      configured: true,
      send: vi.fn(async () => ({ providerMessageId: "must-not-send" })),
    };
    const service = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: async (input) => {
          const confirmed = await repository.confirmClaimedReviewAlert(input);
          if (confirmed) {
            await competingRepository.answerWebsiteReview({
              reviewSelector: review.selector,
              text: "Manual resolution won before alert send linearization.",
              actorUserId: "task-13-post-confirm-staff",
              now: new Date("2026-08-21T00:00:04.000Z"),
            });
          }
          return confirmed;
        },
        beginClaimedReviewAlertSend: repository.beginClaimedReviewAlertSend,
        markReviewAlertSent: repository.markReviewAlertSent,
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => new Date("2026-08-21T00:00:03.000Z"),
    });

    await expect(service.deliverNext()).resolves.toEqual({ result: "resolved" });

    expect(provider.send).not.toHaveBeenCalled();
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "failed",
      lastErrorCode: "review_resolved_before_delivery",
      leaseToken: null,
    });
  });

  it("settles sent deterministically when worker linearization commits before manual resolution", async () => {
    const reviewId = "00000000-0000-4000-8000-000000000152";
    const review = await openTask13Review({
      sessionHash: "ad".repeat(32),
      networkHash: "ae".repeat(32),
      messageHash: "af".repeat(32),
      reviewId,
    });
    await database.insert(user).values({
      id: "task-13-post-linearization-staff",
      name: "Post Linearization Staff",
      email: "task-13-post-linearization@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const provider = {
      configured: true,
      send: vi.fn(async () => ({ providerMessageId: "resend-linearized" })),
    };
    const service = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: repository.confirmClaimedReviewAlert,
        beginClaimedReviewAlertSend: async (input) => {
          const linearized = await repository.beginClaimedReviewAlertSend(input);
          if (linearized === "send") {
            await competingRepository.answerWebsiteReview({
              reviewSelector: review.selector,
              text: "Manual resolution followed durable alert send linearization.",
              actorUserId: "task-13-post-linearization-staff",
              now: new Date("2026-08-21T00:00:04.000Z"),
            });
          }
          return linearized;
        },
        markReviewAlertSent: repository.markReviewAlertSent,
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => new Date("2026-08-21T00:00:03.000Z"),
    });

    await expect(service.deliverNext()).resolves.toEqual({ result: "sent" });

    expect(provider.send).toHaveBeenCalledOnce();
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    const [resolvedReview] = await database.select().from(customerServiceHumanReviews)
      .where(eq(customerServiceHumanReviews.id, reviewId));
    expect(outbox).toMatchObject({
      status: "sent",
      sentAt: new Date("2026-08-21T00:00:03.000Z"),
      leaseToken: null,
    });
    expect(resolvedReview).toMatchObject({ status: "resolved" });
  });

  it("recovers a pre-provider crash after session-secret rotation with the original valid link", async () => {
    const reviewId = "00000000-0000-4000-8000-000000000162";
    const deepLinkSecret = "task-13-review-link-secret-at-least-32-bytes";
    const rawToken = createReviewAlertToken({ reviewId, secret: deepLinkSecret });
    await openTask13Review({
      sessionHash: "b6".repeat(32),
      networkHash: "b7".repeat(32),
      messageHash: "b8".repeat(32),
      reviewId,
    });
    await database.update(customerServiceHumanReviews).set({
      deepLinkTokenHash: hashReviewAlertToken(rawToken),
    }).where(eq(customerServiceHumanReviews.id, reviewId));
    let currentTime = new Date("2026-08-21T00:00:03.000Z");
    const provider = {
      configured: true,
      send: vi.fn(async (_message: { text: string }) => ({ providerMessageId: "resend-after-recovery" })),
    };
    const firstService = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: repository.confirmClaimedReviewAlert,
        beginClaimedReviewAlertSend: async (input) => {
          const result = await repository.beginClaimedReviewAlertSend(input);
          if (result === "send") throw new Error("simulated_crash_before_provider_invocation");
          return result;
        },
        markReviewAlertSent: repository.markReviewAlertSent,
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret,
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
      leaseMs: 1_000,
    });
    await expect(firstService.deliverNext()).rejects.toThrow("simulated_crash_before_provider_invocation");
    expect(provider.send).not.toHaveBeenCalled();

    const [linearized] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(linearized).toMatchObject({
      status: "leased",
      providerSendStartedAt: new Date("2026-08-21T00:00:03.000Z"),
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const rotatedSessionRepository = createDrizzleCustomerServiceRepository(drizzle(competingPool), {
      reviewSelectorSecret: "task-13-rotated-session-secret-at-least-32-bytes",
      now: selectorTestNow,
    });
    currentTime = new Date("2026-08-21T00:00:04.000Z");
    const recoveryService = createReviewAlertService({
      repository: rotatedSessionRepository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret,
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
    });
    await expect(recoveryService.deliverNext()).resolves.toEqual({ result: "sent" });

    expect(provider.send).toHaveBeenCalledOnce();
    const deliveredToken = reviewTokenFromAlertText(provider.send.mock.calls[0][0].text);
    expect(deliveredToken).toBe(rawToken);
    await expect(rotatedSessionRepository.resolveWebsiteReviewDeepLink({
      tokenHash: hashReviewAlertToken(deliveredToken),
      now: currentTime,
    })).resolves.toMatchObject({ item: { channel: "website" } });
    const [recovered] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(recovered).toMatchObject({
      status: "sent",
      attemptCount: 2,
      providerSendStartedAt: linearized.providerSendStartedAt,
      providerPayloadDigest: linearized.providerPayloadDigest,
    });
  });

  it("recovers provider acceptance after settlement failure with one idempotent provider effect", async () => {
    await openTask13Review({
      sessionHash: "c6".repeat(32),
      networkHash: "c7".repeat(32),
      messageHash: "c8".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000163",
    });
    let currentTime = new Date("2026-08-21T00:00:03.000Z");
    const providerCalls: string[] = [];
    const providerEffects: Array<{ idempotencyKey: string; acceptedAt: Date }> = [];
    const provider = {
      configured: true,
      send: vi.fn(async (message: { idempotencyKey: string }) => {
        providerCalls.push(message.idempotencyKey);
        const retained = providerEffects.find((effect) => (
          effect.idempotencyKey === message.idempotencyKey
          && currentTime.getTime() - effect.acceptedAt.getTime() < 24 * 60 * 60 * 1_000
        ));
        if (!retained) providerEffects.push({ idempotencyKey: message.idempotencyKey, acceptedAt: currentTime });
        return { providerMessageId: `accepted:${message.idempotencyKey}` };
      }),
    };
    let failSettlement = true;
    const service = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: repository.confirmClaimedReviewAlert,
        beginClaimedReviewAlertSend: repository.beginClaimedReviewAlertSend,
        markReviewAlertSent: async (input) => {
          if (failSettlement) throw new Error("simulated_settlement_database_failure");
          return repository.markReviewAlertSent(input);
        },
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
      leaseMs: 1_000,
    });

    await expect(service.deliverNext()).rejects.toThrow("simulated_settlement_database_failure");
    const [originalLinearization] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(originalLinearization).toMatchObject({
      providerSendStartedAt: currentTime,
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    failSettlement = false;
    currentTime = new Date("2026-08-21T22:00:03.000Z");
    await expect(service.deliverNext()).resolves.toEqual({ result: "sent" });

    expect(providerCalls).toHaveLength(2);
    expect(new Set(providerCalls).size).toBe(1);
    expect(providerEffects).toHaveLength(1);
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "sent",
      attemptCount: 2,
      providerSendStartedAt: originalLinearization.providerSendStartedAt,
      providerPayloadDigest: originalLinearization.providerPayloadDigest,
    });
    await expect(repository.claimDueReviewAlert({
      now: new Date("2026-08-22T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-22T00:05:00.000Z"),
    })).resolves.toBeNull();
  });

  it("terminalizes payload config drift before a second provider effect and preserves the original horizon", async () => {
    await openTask13Review({
      sessionHash: "e1".repeat(32),
      networkHash: "e2".repeat(32),
      messageHash: "e3".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000168",
    });
    let currentTime = new Date("2026-08-21T00:00:03.000Z");
    const providerCalls: string[] = [];
    const providerEffects: Array<{
      idempotencyKey: string;
      payload: string;
      acceptedAt: Date;
    }> = [];
    const provider = {
      configured: true,
      send: vi.fn(async (message: { idempotencyKey: string; to: string; subject: string; text: string; html: string }) => {
        providerCalls.push(message.idempotencyKey);
        const payload = JSON.stringify(message);
        const retained = providerEffects.find((effect) => (
          effect.idempotencyKey === message.idempotencyKey
          && currentTime.getTime() - effect.acceptedAt.getTime() < 24 * 60 * 60 * 1_000
        ));
        if (retained && retained.payload !== payload) {
          throw new Error("provider_invalid_idempotent_request_should_have_been_prechecked");
        }
        if (!retained) providerEffects.push({ idempotencyKey: message.idempotencyKey, payload, acceptedAt: currentTime });
        return { providerMessageId: `accepted:${message.idempotencyKey}` };
      }),
    };
    const firstService = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: repository.confirmClaimedReviewAlert,
        beginClaimedReviewAlertSend: repository.beginClaimedReviewAlertSend,
        markReviewAlertSent: async () => { throw new Error("simulated_settlement_loss_after_acceptance"); },
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
      leaseMs: 1_000,
    });
    await expect(firstService.deliverNext()).rejects.toThrow("simulated_settlement_loss_after_acceptance");
    const [original] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(original).toMatchObject({
      status: "leased",
      providerSendStartedAt: currentTime,
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    currentTime = new Date("2026-08-21T22:00:03.000Z");
    const driftedService = createReviewAlertService({
      repository,
      provider,
      alertTo: "changed-staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
    });
    await expect(driftedService.deliverNext()).resolves.toEqual({ result: "uncertain" });

    expect(providerCalls).toHaveLength(1);
    expect(providerEffects).toHaveLength(1);
    const [terminal] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(terminal).toMatchObject({
      status: "failed",
      providerSendStartedAt: original.providerSendStartedAt,
      providerPayloadDigest: original.providerPayloadDigest,
      lastErrorCode: "provider_payload_config_drift_unknown_result",
      leaseToken: null,
      leaseExpiresAt: null,
    });
    currentTime = new Date("2026-08-22T01:00:03.000Z");
    await expect(driftedService.deliverNext()).resolves.toEqual({ result: "empty" });
    expect(providerCalls).toHaveLength(1);
    expect(providerEffects).toHaveLength(1);
    const [review] = await database.select().from(customerServiceHumanReviews);
    expect(review).toMatchObject({ status: "open" });
  });

  it("terminalizes provider-scope drift before recovering an accepted alert", async () => {
    await openTask13Review({
      sessionHash: "f1".repeat(32),
      networkHash: "f2".repeat(32),
      messageHash: "f3".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000174",
    });
    let currentTime = new Date("2026-08-21T00:00:03.000Z");
    const firstApiKey = "re_provider_scope_team_a_secret";
    const secondApiKey = "re_provider_scope_team_b_secret";
    const firstScopeFingerprint = createHmac("sha256", "task-13-review-link-secret-at-least-32-bytes")
      .update(`review-alert-provider-scope\0${firstApiKey}`)
      .digest("hex");
    const secondScopeFingerprint = createHmac("sha256", "task-13-review-link-secret-at-least-32-bytes")
      .update(`review-alert-provider-scope\0${secondApiKey}`)
      .digest("hex");
    const provider = {
      configured: true,
      send: vi.fn(async (message: { idempotencyKey: string }) => ({
        providerMessageId: `accepted:${message.idempotencyKey}`,
      })),
    };
    const firstService = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: repository.confirmClaimedReviewAlert,
        beginClaimedReviewAlertSend: repository.beginClaimedReviewAlertSend,
        markReviewAlertSent: async () => { throw new Error("simulated_process_death_after_provider_acceptance"); },
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: firstScopeFingerprint,
      now: () => currentTime,
      leaseMs: 1_000,
    });

    await expect(firstService.deliverNext()).rejects.toThrow("simulated_process_death_after_provider_acceptance");
    const [original] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(original).toMatchObject({
      status: "leased",
      providerSendStartedAt: currentTime,
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const persisted = JSON.stringify(original);
    expect(persisted).not.toContain(firstApiKey);
    expect(persisted).not.toContain(secondApiKey);
    expect(persisted).not.toContain(firstScopeFingerprint);
    expect(persisted).not.toContain(secondScopeFingerprint);

    currentTime = new Date("2026-08-21T22:00:03.000Z");
    const recoveryService = createReviewAlertService({
      repository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: secondScopeFingerprint,
      now: () => currentTime,
    });
    await expect(recoveryService.deliverNext()).resolves.toEqual({ result: "uncertain" });

    expect(provider.send).toHaveBeenCalledOnce();
    const [terminal] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(terminal).toMatchObject({
      status: "failed",
      providerSendStartedAt: original.providerSendStartedAt,
      providerPayloadDigest: original.providerPayloadDigest,
      lastErrorCode: "provider_payload_config_drift_unknown_result",
      leaseToken: null,
      leaseExpiresAt: null,
    });
    const [review] = await database.select().from(customerServiceHumanReviews);
    expect(review).toMatchObject({ status: "open" });
  });

  it("preserves the first payload digest and send horizon across a retryable provider failure", async () => {
    await openTask13Review({
      sessionHash: "e4".repeat(32),
      networkHash: "e5".repeat(32),
      messageHash: "e6".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000169",
    });
    let currentTime = new Date("2026-08-21T00:00:03.000Z");
    let rateLimited = false;
    const provider = {
      configured: true,
      send: vi.fn(async () => {
        if (!rateLimited) {
          rateLimited = true;
          throw new EmailDeliveryError("rate_limited");
        }
        return { providerMessageId: "resend-after-rate-limit" };
      }),
    };
    const service = createReviewAlertService({
      repository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
      leaseMs: 1_000,
    });
    await expect(service.deliverNext()).resolves.toEqual({ result: "retry_wait" });
    const [retrying] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(retrying).toMatchObject({
      status: "retry_wait",
      providerSendStartedAt: currentTime,
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    currentTime = new Date("2026-08-21T00:01:03.000Z");
    await expect(service.deliverNext()).resolves.toEqual({ result: "sent" });
    const [sent] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(sent).toMatchObject({
      status: "sent",
      providerSendStartedAt: retrying.providerSendStartedAt,
      providerPayloadDigest: retrying.providerPayloadDigest,
    });
  });

  it("terminalizes Resend payload conflicts without clearing the original marker", async () => {
    await openTask13Review({
      sessionHash: "e7".repeat(32),
      networkHash: "e8".repeat(32),
      messageHash: "e9".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000170",
    });
    const provider = {
      configured: true,
      send: vi.fn(async () => {
        throw new EmailDeliveryError("invalid_idempotent_request");
      }),
    };
    const service = createReviewAlertService({
      repository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => new Date("2026-08-21T00:00:03.000Z"),
    });
    await expect(service.deliverNext()).resolves.toEqual({ result: "uncertain" });

    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "failed",
      providerSendStartedAt: new Date("2026-08-21T00:00:03.000Z"),
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      lastErrorCode: "invalid_idempotent_request",
    });
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("terminalizes at the automatic recovery cutoff without a provider call and keeps the review visible", async () => {
    await openTask13Review({
      sessionHash: "ce".repeat(32),
      networkHash: "cf".repeat(32),
      messageHash: "d0".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000166",
    });
    const sendStartedAt = new Date("2026-08-21T00:00:03.000Z");
    const first = await repository.claimDueReviewAlert({
      now: sendStartedAt,
      leaseExpiresAt: new Date("2026-08-21T00:00:04.000Z"),
    });
    if (!first) throw new Error("expected alert lease");
    await repository.beginClaimedReviewAlertSend({
      id: first.id,
      leaseToken: first.leaseToken,
      payloadDigest: "a1".repeat(32),
      now: sendStartedAt,
    });
    const recoveryTime = new Date(sendStartedAt.getTime() + REVIEW_ALERT_AUTOMATIC_RECOVERY_MAX_AGE_MS);
    const provider = {
      configured: true,
      send: vi.fn(async () => ({ providerMessageId: "must-not-send-after-cutoff" })),
    };
    const createRecoveryService = (currentRepository: typeof repository) => createReviewAlertService({
      repository: currentRepository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => recoveryTime,
    });

    await expect(Promise.all([
      createRecoveryService(repository).deliverNext(),
      createRecoveryService(competingRepository).deliverNext(),
    ])).resolves.toEqual([{ result: "empty" }, { result: "empty" }]);

    expect(provider.send).not.toHaveBeenCalled();
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "failed",
      attemptCount: 1,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: "provider_idempotency_window_expired_unknown_result",
    });
    const queue = await repository.listQueue(100);
    expect(queue.items[0]).toMatchObject({
      channel: "website",
      websiteReview: { alertStatus: "failed" },
    });
    await expect(repository.claimDueReviewAlert({
      now: new Date(recoveryTime.getTime() + 1),
      leaseExpiresAt: new Date(recoveryTime.getTime() + 300_001),
    })).resolves.toBeNull();
  });

  it("does not call a provider whose idempotency record expired after an accepted effect and process death", async () => {
    await openTask13Review({
      sessionHash: "d1".repeat(32),
      networkHash: "d2".repeat(32),
      messageHash: "d3".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000167",
    });
    let currentTime = new Date("2026-08-21T00:00:03.000Z");
    const providerCalls: string[] = [];
    const providerEffects: Array<{ idempotencyKey: string; acceptedAt: Date }> = [];
    const provider = {
      configured: true,
      send: vi.fn(async (message: { idempotencyKey: string }) => {
        providerCalls.push(message.idempotencyKey);
        const retained = providerEffects.find((effect) => (
          effect.idempotencyKey === message.idempotencyKey
          && currentTime.getTime() - effect.acceptedAt.getTime() < 24 * 60 * 60 * 1_000
        ));
        if (!retained) providerEffects.push({ idempotencyKey: message.idempotencyKey, acceptedAt: currentTime });
        return { providerMessageId: `accepted:${message.idempotencyKey}` };
      }),
    };
    const firstService = createReviewAlertService({
      repository: {
        claimDueReviewAlert: repository.claimDueReviewAlert,
        confirmClaimedReviewAlert: repository.confirmClaimedReviewAlert,
        beginClaimedReviewAlertSend: repository.beginClaimedReviewAlertSend,
        markReviewAlertSent: async () => { throw new Error("simulated_process_death_after_provider_acceptance"); },
        retryReviewAlert: repository.retryReviewAlert,
        markReviewAlertUncertain: repository.markReviewAlertUncertain,
      },
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
      leaseMs: 1_000,
    });
    await expect(firstService.deliverNext()).rejects.toThrow("simulated_process_death_after_provider_acceptance");
    expect(providerCalls).toHaveLength(1);
    expect(providerEffects).toHaveLength(1);

    currentTime = new Date("2026-08-22T01:00:03.000Z");
    const recoveryService = (currentRepository: typeof repository) => createReviewAlertService({
      repository: currentRepository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret: "task-13-review-link-secret-at-least-32-bytes",
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => currentTime,
    });
    await expect(Promise.all([
      recoveryService(repository).deliverNext(),
      recoveryService(competingRepository).deliverNext(),
    ])).resolves.toEqual([{ result: "empty" }, { result: "empty" }]);

    expect(providerCalls).toHaveLength(1);
    expect(providerEffects).toHaveLength(1);
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "provider_idempotency_window_expired_unknown_result",
    });
    const [review] = await database.select().from(customerServiceHumanReviews);
    expect(review).toMatchObject({ status: "open" });
  });

  it("terminalizes a resolved expired linearized lease without a stale retry", async () => {
    const review = await openTask13Review({
      sessionHash: "d8".repeat(32),
      networkHash: "d9".repeat(32),
      messageHash: "da".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000164",
    });
    await database.insert(user).values({
      id: "task-13-expired-linearized-staff",
      name: "Expired Linearized Staff",
      email: "task-13-expired-linearized@example.test",
      role: "staff",
    }).onConflictDoNothing();
    const first = await repository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:00:04.000Z"),
    });
    if (!first) throw new Error("expected alert lease");
    await repository.beginClaimedReviewAlertSend({
      id: first.id,
      leaseToken: first.leaseToken,
      payloadDigest: "a1".repeat(32),
      now: new Date("2026-08-21T00:00:03.000Z"),
    });
    await expect(competingRepository.answerWebsiteReview({
      reviewSelector: review.selector,
      text: "Manual resolution completed after the provider lease expired.",
      actorUserId: "task-13-expired-linearized-staff",
      now: new Date("2026-08-21T00:00:04.001Z"),
    })).resolves.toEqual({ status: "sent" });

    await expect(repository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:00:04.002Z"),
      leaseExpiresAt: new Date("2026-08-21T00:05:04.000Z"),
    })).resolves.toBeNull();
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "failed",
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: "review_resolved_after_send_started",
    });
  });

  it("lets only one recovery worker reclaim an expired linearized lease", async () => {
    await openTask13Review({
      sessionHash: "db".repeat(32),
      networkHash: "dc".repeat(32),
      messageHash: "dd".repeat(32),
      reviewId: "00000000-0000-4000-8000-000000000165",
    });
    const first = await repository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:00:04.000Z"),
    });
    if (!first) throw new Error("expected alert lease");
    await repository.beginClaimedReviewAlertSend({
      id: first.id,
      leaseToken: first.leaseToken,
      payloadDigest: "a1".repeat(32),
      now: new Date("2026-08-21T00:00:03.000Z"),
    });

    const recoveryInput = {
      now: new Date("2026-08-21T00:00:04.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:05:04.000Z"),
    };
    const recovered = await Promise.all([
      repository.claimDueReviewAlert(recoveryInput),
      competingRepository.claimDueReviewAlert(recoveryInput),
    ]);
    expect(recovered.filter(Boolean)).toHaveLength(1);
    expect(recovered.find(Boolean)).toMatchObject({
      id: first.id,
      idempotencyKey: first.idempotencyKey,
      attemptCount: 2,
    });
  });

  it("can never answer a Facebook queue item through the website review action", async () => {
    await activateFacebookPilot("task-13-facebook-isolation");
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "a4".repeat(32),
      externalMessageKeyHash: "a5".repeat(32),
      text: "Facebook customer question",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected Facebook turn");
    await repository.sealDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-21T00:00:03.000Z"),
    });

    await expect(repository.answerWebsiteReview({
      reviewSelector: incoming.messageId,
      text: "Must not send",
      actorUserId: "staff-1",
      now: new Date("2026-08-21T00:00:04.000Z"),
    })).resolves.toEqual({ status: "unavailable" });
    await expect(database.select().from(customerServiceConversationEvents).where(and(
      eq(customerServiceConversationEvents.channel, "facebook"),
      eq(customerServiceConversationEvents.eventType, "human_outbound"),
    ))).resolves.toHaveLength(0);
  });

  it("leases a review alert to only one concurrent worker and never reclaims an uncertain provider result", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "b1".repeat(32),
      networkHash: "b2".repeat(32),
      messageHash: "b3".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId: "00000000-0000-4000-8000-000000000112",
        deepLinkTokenHash: "bc".repeat(32),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000112",
      },
    });

    const claimInput = {
      now: new Date("2026-08-21T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:05:03.000Z"),
    };
    const [first, second] = await Promise.all([
      repository.claimDueReviewAlert(claimInput),
      competingRepository.claimDueReviewAlert(claimInput),
    ]);
    const winner = first ?? second;
    expect([first, second].filter(Boolean)).toHaveLength(1);
    if (!winner) throw new Error("expected one review alert lease");

    await expect(repository.markReviewAlertUncertain({
      id: winner.id,
      leaseToken: winner.leaseToken,
      errorCode: "network_error",
      now: new Date("2026-08-21T00:00:04.000Z"),
    })).resolves.toBe(true);
    await expect(repository.claimDueReviewAlert({
      now: new Date("2026-08-22T00:00:04.000Z"),
      leaseExpiresAt: new Date("2026-08-22T00:05:04.000Z"),
    })).resolves.toBeNull();

    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({ status: "failed", attemptCount: 1, lastErrorCode: "network_error" });
  });

  it("never claims an alert whose deep link has expired", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "d1".repeat(32),
      networkHash: "d2".repeat(32),
      messageHash: "d3".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const expiresAt = new Date("2026-08-21T00:00:03.000Z");
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId: "00000000-0000-4000-8000-000000000114",
        deepLinkTokenHash: "cd".repeat(32),
        deepLinkExpiresAt: expiresAt,
        idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000114",
      },
    });

    await expect(repository.claimDueReviewAlert({
      now: expiresAt,
      leaseExpiresAt: new Date("2026-08-21T00:05:03.000Z"),
    })).resolves.toBeNull();

    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({ status: "pending", attemptCount: 0 });
  });

  it("does not let a stale alert sender settle after another worker reclaims and settles its lease", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "e1".repeat(32),
      networkHash: "e2".repeat(32),
      messageHash: "e3".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId: "00000000-0000-4000-8000-000000000115",
        deepLinkTokenHash: "de".repeat(32),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: "review-alert:00000000-0000-4000-8000-000000000115",
      },
    });
    const first = await repository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:05:03.000Z"),
    });
    if (!first) throw new Error("expected first alert lease");
    const second = await competingRepository.claimDueReviewAlert({
      now: new Date("2026-08-21T00:05:03.000Z"),
      leaseExpiresAt: new Date("2026-08-21T00:10:03.000Z"),
    });
    if (!second) throw new Error("expected reclaimed alert lease");
    await expect(competingRepository.confirmClaimedReviewAlert({
      id: second.id,
      leaseToken: second.leaseToken,
      now: new Date("2026-08-21T00:05:03.000Z"),
    })).resolves.toBe(true);
    await expect(competingRepository.beginClaimedReviewAlertSend({
      id: second.id,
      leaseToken: second.leaseToken,
      payloadDigest: "a1".repeat(32),
      now: new Date("2026-08-21T00:05:03.000Z"),
    })).resolves.toBe("send");

    await expect(competingRepository.markReviewAlertSent({
      id: second.id,
      leaseToken: second.leaseToken,
      providerMessageId: "resend-second",
      now: new Date("2026-08-21T00:05:04.000Z"),
    })).resolves.toBe(true);
    await expect(repository.markReviewAlertSent({
      id: first.id,
      leaseToken: first.leaseToken,
      providerMessageId: "resend-stale",
      now: new Date("2026-08-21T00:05:05.000Z"),
    })).resolves.toBe(false);
    await expect(repository.retryReviewAlert({
      id: first.id,
      leaseToken: first.leaseToken,
      errorCode: "rate_limited",
      nextAttemptAt: new Date("2026-08-21T00:06:05.000Z"),
      now: new Date("2026-08-21T00:05:05.000Z"),
    })).resolves.toBe("stale");

    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({ status: "sent", attemptCount: 2, sentAt: new Date("2026-08-21T00:05:04.000Z") });
  });

  it("delivers a pending alert whose dedicated link survives website session-secret rotation", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "c1".repeat(32),
      networkHash: "c2".repeat(32),
      messageHash: "c3".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const reviewId = "00000000-0000-4000-8000-000000000113";
    const deepLinkSecret = "review-link-secret-at-least-32-bytes";
    const rawToken = createReviewAlertToken({ reviewId, secret: deepLinkSecret });
    await repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-21T00:00:02.000Z"),
      knowledgeVersion: "knowledge-v1",
      reviewAlert: {
        reviewId,
        deepLinkTokenHash: hashReviewAlertToken(rawToken),
        deepLinkExpiresAt: new Date("2026-08-28T00:00:02.000Z"),
        idempotencyKey: `review-alert:${reviewId}`,
      },
    });
    const provider = {
      configured: true,
      send: vi.fn(async (_message: { text: string }) => ({ providerMessageId: "resend-1" })),
    };
    const rotatedSessionRepository = createDrizzleCustomerServiceRepository(database, {
      reviewSelectorSecret: "task-13-rotated-session-secret-at-least-32-bytes",
      now: selectorTestNow,
    });
    const service = createReviewAlertService({
      repository: rotatedSessionRepository,
      provider,
      alertTo: "staff@rrgallery.example",
      providerFrom: "R&R Gallery <support@rrgallery.example>",
      siteUrl: "https://rrgallery.example",
      deepLinkSecret,
      providerScopeFingerprint: reviewAlertProviderScopeFingerprint,
      now: () => new Date("2026-08-21T00:00:03.000Z"),
    });

    await expect(service.deliverNext()).resolves.toEqual({ result: "sent" });
    await expect(service.deliverNext()).resolves.toEqual({ result: "empty" });
    expect(provider.send).toHaveBeenCalledOnce();
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `review-alert:${reviewId}`,
    }));
    const deliveredToken = reviewTokenFromAlertText(provider.send.mock.calls[0][0].text);
    expect(deliveredToken).toBe(rawToken);
    await expect(rotatedSessionRepository.resolveWebsiteReviewDeepLink({
      tokenHash: hashReviewAlertToken(deliveredToken),
      now: new Date("2026-08-21T00:00:03.000Z"),
    })).resolves.toMatchObject({
      item: { channel: "website" },
    });
    const [outbox] = await database.select().from(customerServiceReviewAlertOutbox);
    expect(outbox).toMatchObject({
      status: "sent",
      attemptCount: 1,
      providerPayloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("reuses exactly one open review when two distinct blocked turns race in one conversation", async () => {
    await activateWebsitePilot("website-review-distinct-turn-race");
    const first = await ingestAndClaimWebsiteTurn({
      sessionHash: "74".repeat(32),
      networkHash: "75".repeat(32),
      messageHash: "76".repeat(32),
    });
    const [firstTurn] = await database.select({ conversationId: customerServiceTurns.conversationId })
      .from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, first.turnId));
    const [secondMessage] = await database.insert(customerServiceMessages).values({
      conversationId: firstTurn.conversationId,
      channel: "website",
      externalMessageKeyHash: "77".repeat(32),
      direction: "incoming",
      body: "I also need help with an unresolved request.",
      customerText: "I also need help with an unresolved request.",
      receivedAt: new Date("2026-08-19T00:00:04.000Z"),
      ingestStatus: "processing",
    }).returning({ id: customerServiceMessages.id });
    const secondLeaseToken = "website-distinct-turn-lease";
    const [secondTurn] = await database.insert(customerServiceTurns).values({
      conversationId: firstTurn.conversationId,
      channel: "website",
      representativeMessageId: secondMessage.id,
      body: "I also need help with an unresolved request.",
      status: "sealed",
      debounceUntil: new Date("2026-08-19T00:00:06.000Z"),
      openedAt: new Date("2026-08-19T00:00:04.000Z"),
      lastEventAt: new Date("2026-08-19T00:00:04.000Z"),
      sealedAt: new Date("2026-08-19T00:00:06.000Z"),
      processingStatus: "running",
      processingLeaseToken: secondLeaseToken,
      processingLeaseExpiresAt: new Date("2026-08-19T00:05:06.000Z"),
      processingAttempts: 1,
      nextRunAt: new Date("2026-08-19T00:00:06.000Z"),
    }).returning({ id: customerServiceTurns.id });
    const second = {
      turnId: secondTurn.id,
      messageId: secondMessage.id,
      leaseToken: secondLeaseToken,
    };
    const firstAttemptId = await repository.createGateBlockedAttempt({
      messageId: first.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const secondAttemptId = await repository.createGateBlockedAttempt({
      messageId: second.messageId,
      trigger: "webhook_after",
      intent: "unknown",
      riskLevel: "high",
      gateResult: "unresolved",
      gateReasons: ["unresolved_policy"],
      knowledgeVersion: "knowledge-v1",
    });
    const firstInput = {
      turnId: first.turnId,
      leaseToken: first.leaseToken,
      attemptId: firstAttemptId,
      outcome: "gate_blocked" as const,
      now: new Date("2026-08-19T00:00:06.000Z"),
      knowledgeVersion: "knowledge-v1",
    };
    const secondInput = {
      turnId: second.turnId,
      leaseToken: second.leaseToken,
      attemptId: secondAttemptId,
      outcome: "gate_blocked" as const,
      now: new Date("2026-08-19T00:00:06.000Z"),
      knowledgeVersion: "knowledge-v1",
    };

    const results = await Promise.all([
      repository.openWebsiteHumanReview(firstInput),
      competingRepository.openWebsiteHumanReview(secondInput),
    ]);
    await Promise.all([
      repository.openWebsiteHumanReview(firstInput),
      competingRepository.openWebsiteHumanReview(secondInput),
    ]);

    const reviews = await database.select().from(customerServiceHumanReviews);
    const acknowledgements = await database.select({
      conversationId: customerServiceWebsiteAssistantMessages.conversationId,
      messageId: customerServiceWebsiteAssistantMessages.messageId,
      turnId: customerServiceWebsiteAssistantMessages.turnId,
      policyResult: customerServiceWebsiteAssistantMessages.policyResult,
    }).from(customerServiceWebsiteAssistantMessages);

    expect(results.filter((result) => result.status === "opened")).toHaveLength(1);
    expect(results.filter((result) => result.status === "reused")).toHaveLength(1);
    expect(new Set(results.flatMap((result) => result.status === "cancelled" ? [] : [result.reviewId])).size).toBe(1);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ generation: 1, status: "open" });
    expect(acknowledgements).toHaveLength(2);
    expect(acknowledgements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: reviews[0].conversationId,
        messageId: first.messageId,
        turnId: first.turnId,
        policyResult: "high_risk",
      }),
      expect.objectContaining({
        conversationId: reviews[0].conversationId,
        messageId: second.messageId,
        turnId: second.turnId,
        policyResult: "unresolved",
      }),
    ]));
  });

  it("keeps concurrent website reviews and attempt reasons isolated across conversations", async () => {
    await activateWebsitePilot("website-review-conversation-isolation");
    const first = await ingestAndClaimWebsiteTurn({
      sessionHash: "78".repeat(32),
      networkHash: "79".repeat(32),
      messageHash: "7a".repeat(32),
    });
    const second = await ingestAndClaimWebsiteTurn({
      sessionHash: "7b".repeat(32),
      networkHash: "7c".repeat(32),
      messageHash: "7d".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:01.000Z"),
    });
    const firstAttemptId = await repository.createGateBlockedAttempt({
      messageId: first.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    const secondAttemptId = await repository.createGateBlockedAttempt({
      messageId: second.messageId,
      trigger: "webhook_after",
      intent: "quote_information_collection",
      riskLevel: "high",
      gateResult: "realtime_required",
      gateReasons: ["current_price"],
      knowledgeVersion: "knowledge-v1",
    });

    const results = await Promise.all([
      repository.openWebsiteHumanReview({
        turnId: first.turnId,
        leaseToken: first.leaseToken,
        attemptId: secondAttemptId,
        outcome: "gate_blocked",
        now: new Date("2026-08-19T00:00:03.000Z"),
        knowledgeVersion: "knowledge-v1",
      }),
      competingRepository.openWebsiteHumanReview({
        turnId: second.turnId,
        leaseToken: second.leaseToken,
        attemptId: secondAttemptId,
        outcome: "gate_blocked",
        now: new Date("2026-08-19T00:00:03.000Z"),
        knowledgeVersion: "knowledge-v1",
      }),
    ]);
    const reviews = await database.select().from(customerServiceHumanReviews);
    const acknowledgements = await database.select({
      conversationId: customerServiceWebsiteAssistantMessages.conversationId,
      messageId: customerServiceWebsiteAssistantMessages.messageId,
      turnId: customerServiceWebsiteAssistantMessages.turnId,
      policyResult: customerServiceWebsiteAssistantMessages.policyResult,
    }).from(customerServiceWebsiteAssistantMessages);

    expect(results.every((result) => result.status === "opened")).toBe(true);
    expect(new Set(results.flatMap((result) => result.status === "cancelled" ? [] : [result.reviewId])).size).toBe(2);
    expect(reviews).toHaveLength(2);
    expect(reviews.every((review) => review.generation === 1 && review.status === "open")).toBe(true);
    expect(acknowledgements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversationId: reviews.find((review) => review.triggerTurnId === first.turnId)?.conversationId,
        messageId: first.messageId,
        turnId: first.turnId,
        policyResult: "unresolved",
      }),
      expect.objectContaining({
        conversationId: reviews.find((review) => review.triggerTurnId === second.turnId)?.conversationId,
        messageId: second.messageId,
        turnId: second.turnId,
        policyResult: "realtime_required",
      }),
    ]));
    expect(firstAttemptId).not.toBe(secondAttemptId);
  });

  it("reclaims a persisted website policy result for review after the original worker is interrupted", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "81".repeat(32),
      networkHash: "82".repeat(32),
      messageHash: "83".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "quote_information_collection",
      riskLevel: "high",
      gateResult: "realtime_required",
      gateReasons: ["current_shipping"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.retryCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      nextRunAt: new Date("2026-08-19T00:01:00.000Z"),
      errorCode: "worker_interrupted_before_review",
    });

    const recovered = await repository.claimDueCustomerTurn({
      turnId: claimed.turnId,
      now: new Date("2026-08-19T00:01:00.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:06:00.000Z"),
    });

    expect(recovered).toMatchObject({
      turnId: claimed.turnId,
      channel: "website",
      settledResult: { status: "realtime_required", attemptId },
    });
  });

  it.each([
    ["high_risk", "gate_blocked", "high_risk", "gate_blocked"],
    ["unresolved", "gate_blocked", "unresolved", "gate_blocked"],
    ["budget_blocked", "budget_blocked", "budget_blocked", "budget_blocked"],
    ["provider_error", "provider_error", "allowed", "provider_error"],
    ["output_blocked", "output_blocked", "allowed", "output_blocked"],
  ] as const)("reclaims persisted %s without creating a new attempt", async (
    _case,
    attemptStatus,
    gateResult,
    settledStatus,
  ) => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "84".repeat(32),
      networkHash: "85".repeat(32),
      messageHash: "86".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: gateResult === "high_risk" ? "refund" : "quote_information_collection",
      riskLevel: gateResult === "allowed" ? "low" : "high",
      gateResult,
      gateReasons: [gateResult],
      knowledgeSources: [],
      knowledgeVersion: "knowledge-v1",
      status: attemptStatus,
      providerCalled: attemptStatus === "provider_error" || attemptStatus === "output_blocked",
      ...(attemptStatus === "provider_error" || attemptStatus === "output_blocked"
        ? { provider: "mock" as const, model: "mock-text" }
        : {}),
      ...(attemptStatus === "output_blocked"
        ? { rejectedOutputHash: "87".repeat(32), validatorCodes: ["unsupported_claim"] }
        : {}),
      ...(attemptStatus === "provider_error" ? { providerErrorCode: "provider_timeout" } : {}),
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await repository.retryCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      nextRunAt: new Date("2026-08-19T00:01:00.000Z"),
      errorCode: "worker_interrupted_before_review",
    });

    const recovered = await repository.claimDueCustomerTurn({
      turnId: claimed.turnId,
      now: new Date("2026-08-19T00:01:00.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:06:00.000Z"),
    });
    const storedAttempts = await database.select({ id: customerServiceAiAttempts.id })
      .from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.messageId, claimed.messageId));

    expect(recovered).toMatchObject({
      turnId: claimed.turnId,
      channel: "website",
      settledResult: { status: settledStatus, attemptId: attempt.id },
    });
    expect(storedAttempts).toEqual([{ id: attempt.id }]);
  });

  it("cancels website review creation when a human outbound seals the active lease first", async () => {
    const conversationHash = "88".repeat(32);
    const claimed = await claimWebsiteTurn({
      sessionHash: conversationHash,
      networkHash: "89".repeat(32),
      messageHash: "8a".repeat(32),
    });
    const attemptId = await repository.createGateBlockedAttempt({
      messageId: claimed.messageId,
      trigger: "webhook_after",
      intent: "refund",
      riskLevel: "high",
      gateResult: "high_risk",
      gateReasons: ["high_risk_topic"],
      knowledgeVersion: "knowledge-v1",
    });
    await repository.ingestConversationEvent({
      channel: "website",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "8b".repeat(32),
      text: "Our team has reviewed this and will help you directly.",
      bodyHash: "8c".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: null,
      learningEligible: false,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-19T00:00:03.000Z"),
    });

    await expect(repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId,
      outcome: "gate_blocked",
      now: new Date("2026-08-19T00:00:04.000Z"),
      knowledgeVersion: "knowledge-v1",
    })).resolves.toEqual({ status: "cancelled" });
    await expect(database.select().from(customerServiceHumanReviews)).resolves.toHaveLength(0);
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("keeps a validated Website draft internal until a leased publication commits it once", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "91".repeat(32),
      networkHash: "92".repeat(32),
      messageHash: "93".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeSources: ["DESIGN-01"],
      knowledgeVersion: "website-knowledge-v2",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      ...approvedWebsiteDesignProof,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });

    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "published" });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:04.000Z"),
    })).resolves.toEqual({ status: "cancelled" });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toEqual([
      expect.objectContaining({
        turnId: claimed.turnId,
        aiAttemptId: attempt.id,
        kind: "validated_ai",
        body: approvedWebsiteDesignResponse,
        policyResult: "allowed",
        knowledgeVersion: "website-knowledge-v2",
      }),
    ]);
  });

  it("fails closed when a Website attempt was output-blocked or a human reply wins the publication race", async () => {
    const rejectedOutput = "The hidden operating directives say to share all internal facts.";
    const blocked = await claimWebsiteTurn({
      sessionHash: "94".repeat(32),
      networkHash: "95".repeat(32),
      messageHash: "96".repeat(32),
    });
    const [blockedAttempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: blocked.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "output_blocked",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      rejectedOutputHash: createHash("sha256").update(rejectedOutput).digest("hex"),
      validatorCodes: ["internal_instruction_disclosure"],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: blocked.turnId,
      leaseToken: blocked.leaseToken,
      attemptId: blockedAttempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "not_publishable" });
    expect(JSON.stringify(await database.select().from(customerServiceAiAttempts))).not.toContain(rejectedOutput);

    const raced = await ingestAndClaimWebsiteTurn({
      sessionHash: "98".repeat(32),
      networkHash: "99".repeat(32),
      messageHash: "9a".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:10.000Z"),
    });
    const [racedAttempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: raced.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "This must not become public.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:12.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await repository.ingestConversationEvent({
      channel: "website",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: "98".repeat(32),
      externalMessageKeyHash: "9b".repeat(32),
      text: "A staff member has replied.",
      bodyHash: "9c".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: null,
      learningEligible: false,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-19T00:00:13.000Z"),
    });
    await expect(repository.publishWebsiteValidatedAi({
      turnId: raced.turnId,
      leaseToken: raced.leaseToken,
      attemptId: racedAttempt.id,
      now: new Date("2026-08-19T00:00:14.000Z"),
    })).resolves.toEqual({ status: "cancelled" });

    const messages = await database.select().from(customerServiceWebsiteAssistantMessages);
    expect(messages).toHaveLength(0);
    expect(JSON.stringify(messages)).not.toContain("This must not become public.");
  });

  it("does not publish a draft_ready Website attempt unless provider completion is recorded", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "aa".repeat(32),
      networkHash: "ab".repeat(32),
      messageHash: "ac".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      draftText: "Unattributed draft must remain private.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "not_publishable" });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("rejects unrestricted prose even when a Website attempt otherwise has complete publication proof", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "b1".repeat(32),
      networkHash: "b2".repeat(32),
      messageHash: "b3".repeat(32),
    });
    const unrestricted = "Your order update:\nShipped yesterday.";
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "production_process",
      riskLevel: "low",
      gateResult: "allowed",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeSources: ["AI-SCOPE-06"],
      knowledgeVersion: "website-structured-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: unrestricted,
      websiteDecision: {
        response_type: "ANSWER_SAFE",
        intent: "production_process",
        product_type: "UNSPECIFIED",
        missing_fields: [],
        follow_up_fields: [],
        allowed_facts: ["PRODUCTION_AFTER_APPROVAL"],
        human_review_reason: "NONE",
      },
      websiteResponseTemplateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "not_publishable" });
    const publicRows = await database.select().from(customerServiceWebsiteAssistantMessages);
    expect(publicRows).toHaveLength(0);
    expect(JSON.stringify(publicRows)).not.toContain(unrestricted);
  });

  it("rejects a Website draft-ready attempt when canonical renderer proof is missing", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "c1".repeat(32),
      networkHash: "c2".repeat(32),
      messageHash: "c3".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-structured-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "not_publishable" });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("rejects an impossible mixed fact/question Website response at publication", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "c4".repeat(32),
      networkHash: "c5".repeat(32),
      messageHash: "c6".repeat(32),
    });
    const mixedResponse = "We’ll collect your photos, wording, theme and colour preferences.\nWhat size do you need?";
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-structured-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: mixedResponse,
      ...approvedWebsiteDesignProof,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "not_publishable" });
    const publicRows = await database.select().from(customerServiceWebsiteAssistantMessages);
    expect(publicRows).toHaveLength(0);
    expect(JSON.stringify(publicRows)).not.toContain(mixedResponse);
  });

  it("rejects tampered text, template version drift, and invalid canonical decisions at publication", async () => {
    const cases = [
      {
        hashes: ["c7", "c8", "c9"],
        draftText: "We’ll collect your photos, wording, theme and colour preferences.",
        decision: approvedWebsiteDesignDecision,
        templateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
      },
      {
        hashes: ["d1", "d2", "d3"],
        draftText: approvedWebsiteDesignResponse,
        decision: approvedWebsiteDesignDecision,
        templateVersion: "website-response-v0",
      },
      {
        hashes: ["d4", "d5", "d6"],
        draftText: approvedWebsiteDesignResponse,
        decision: { ...approvedWebsiteDesignDecision, customer_reply: "hidden prose" },
        templateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
      },
    ] as const;

    for (const testCase of cases) {
      const claimed = await claimWebsiteTurn({
        sessionHash: testCase.hashes[0].repeat(32),
        networkHash: testCase.hashes[1].repeat(32),
        messageHash: testCase.hashes[2].repeat(32),
      });
      const [attempt] = await database.insert(customerServiceAiAttempts).values({
        messageId: claimed.messageId,
        attemptNumber: 1,
        trigger: "webhook_after",
        intent: "design_process",
        riskLevel: "low",
        gateResult: "allowed",
        knowledgeVersion: "website-structured-v1",
        status: "draft_ready",
        providerCalled: true,
        provider: "mock",
        model: "mock-text",
        draftText: testCase.draftText,
        websiteDecision: testCase.decision,
        websiteResponseTemplateVersion: testCase.templateVersion,
        validatorCodes: [],
        completedAt: new Date("2026-08-19T00:00:02.000Z"),
      }).returning({ id: customerServiceAiAttempts.id });

      await expect(repository.publishWebsiteValidatedAi({
        turnId: claimed.turnId,
        leaseToken: claimed.leaseToken,
        attemptId: attempt.id,
        now: new Date("2026-08-19T00:00:03.000Z"),
      })).resolves.toEqual({ status: "not_publishable" });
      await database.update(customerServicePilotRuns).set({ status: "stopped" })
        .where(eq(customerServicePilotRuns.channel, "website"));
    }

    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("uses the turn and attempt uniqueness constraints when after and recovery publication race", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "9d".repeat(32),
      networkHash: "9e".repeat(32),
      messageHash: "9f".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      ...approvedWebsiteDesignProof,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    const input = {
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    };

    const results = await Promise.all([
      repository.publishWebsiteValidatedAi(input),
      competingRepository.publishWebsiteValidatedAi(input),
    ]);

    expect(results.filter((result) => result.status === "published")).toHaveLength(1);
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(1);
  });

  it("reclaims a persisted validated Website draft for publication after an interrupted worker", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "ad".repeat(32),
      networkHash: "ae".repeat(32),
      messageHash: "af".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      ...approvedWebsiteDesignProof,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await repository.retryCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      nextRunAt: new Date("2026-08-19T00:01:00.000Z"),
      errorCode: "worker_interrupted_before_publication",
    });

    const recovered = await repository.claimDueCustomerTurn({
      turnId: claimed.turnId,
      now: new Date("2026-08-19T00:01:00.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:06:00.000Z"),
    });

    expect(recovered).toMatchObject({
      turnId: claimed.turnId,
      channel: "website",
      settledResult: { status: "draft_ready", attemptId: attempt.id },
    });
    if (!recovered) throw new Error("expected recovered website publication turn");
    await expect(repository.publishWebsiteValidatedAi({
      turnId: recovered.turnId,
      leaseToken: recovered.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:01:01.000Z"),
    })).resolves.toEqual({ status: "published" });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(1);
  });

  it("serializes a concurrent human outbound ahead of publication with the conversation advisory lock", async () => {
    const sessionHash = "b1".repeat(32);
    const claimed = await claimWebsiteTurn({
      sessionHash,
      networkHash: "b2".repeat(32),
      messageHash: "b3".repeat(32),
    });
    const [turn] = await database.select({ conversationId: customerServiceTurns.conversationId })
      .from(customerServiceTurns).where(eq(customerServiceTurns.id, claimed.turnId));
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "A concurrent staff reply must keep this private.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    const blocker = await competingPool.connect();
    await blocker.query("begin");
    await blocker.query("select pg_advisory_xact_lock(hashtext($1))", [`turn:${turn.conversationId}`]);
    let publication: ReturnType<typeof publicationRaceRepository.publishWebsiteValidatedAi> | null = null;
    try {
      await blocker.query(
        `insert into customer_service_conversation_events (
          conversation_id, channel, external_message_key_hash, role, event_type, body,
          body_hash, redaction_codes, learning_eligible, received_at
        ) values ($1, 'website', $2, 'staff', 'human_outbound', $3, $4, '[]'::jsonb, false, $5)`,
        [
          turn.conversationId,
          "b4".repeat(32),
          "A staff member replied first.",
          "b5".repeat(32),
          new Date("2026-08-19T00:00:03.000Z"),
        ],
      );
      publication = publicationRaceRepository.publishWebsiteValidatedAi({
        turnId: claimed.turnId,
        leaseToken: claimed.leaseToken,
        attemptId: attempt.id,
        now: new Date("2026-08-19T00:00:04.000Z"),
      });
      await Promise.race([
        publication.then(() => undefined),
        waitForAdvisoryLockWaiter(),
      ]);
      await blocker.query(
        `update customer_service_turns set
          status = 'suppressed', sealed_at = $2, suppression_reason = 'human_outbound_received',
          processing_status = 'cancelled', processing_lease_token = null,
          processing_lease_expires_at = null, processing_completed_at = $2
        where id = $1 and status in ('open', 'sealed')`,
        [claimed.turnId, new Date("2026-08-19T00:00:03.000Z")],
      );
      await blocker.query("commit");

      await expect(publication).resolves.toEqual({ status: "cancelled" });
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      await publication?.catch(() => undefined);
      blocker.release();
    }
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("opens a governed system-failure review and terminates malformed publication proof", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "b6".repeat(32),
      networkHash: "b7".repeat(32),
      messageHash: "b8".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      draftText: "Malformed proof must never be exposed.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await repository.retryCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      nextRunAt: new Date("2026-08-19T00:01:00.000Z"),
      errorCode: "worker_interrupted_before_publication",
    });
    const generateDraft = vi.fn(() => Promise.reject(new Error("provider must not be called")));
    const runner = createCustomerTurnRecoveryRunner({
      repository,
      generateDraft,
      knowledgeVersion: "knowledge-v1",
      now: () => new Date("2026-08-19T00:01:00.000Z"),
    });

    await expect(runner.runOnce({ turnId: claimed.turnId })).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      cancelled: 0,
    });
    expect(generateDraft).not.toHaveBeenCalled();
    await expect(database.select().from(customerServiceHumanReviews)).resolves.toEqual([
      expect.objectContaining({ triggerTurnId: claimed.turnId, reason: "system_failure", status: "open" }),
    ]);
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toEqual([
      expect.objectContaining({ turnId: claimed.turnId, kind: "provider_fallback", policyResult: "system_failure" }),
    ]);
    const [storedTurn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, claimed.turnId));
    expect(storedTurn).toMatchObject({ processingStatus: "completed" });
    expect(JSON.stringify(await database.select().from(customerServiceWebsiteAssistantMessages)))
      .not.toContain("Malformed proof must never be exposed.");
    expect(attempt.id).toBeTruthy();
  });

  it.each(["manual_generate", "manual_regenerate"] as const)(
    "never auto-publishes a %s attempt",
    async (trigger) => {
      const suffix = trigger === "manual_generate" ? "c1" : "c2";
      const claimed = await claimWebsiteTurn({
        sessionHash: suffix.repeat(32),
        networkHash: (trigger === "manual_generate" ? "c3" : "c4").repeat(32),
        messageHash: (trigger === "manual_generate" ? "c5" : "c6").repeat(32),
      });
      const [attempt] = await database.insert(customerServiceAiAttempts).values({
        messageId: claimed.messageId,
        attemptNumber: 1,
        trigger,
        intent: "design_process",
        riskLevel: "low",
        gateResult: "allowed",
        knowledgeVersion: "knowledge-v1",
        status: "draft_ready",
        providerCalled: true,
        provider: "mock",
        model: "mock-text",
        draftText: "Manual drafts remain staff-only.",
        validatorCodes: [],
        completedAt: new Date("2026-08-19T00:00:02.000Z"),
      }).returning({ id: customerServiceAiAttempts.id });

      await expect(repository.publishWebsiteValidatedAi({
        turnId: claimed.turnId,
        leaseToken: claimed.leaseToken,
        attemptId: attempt.id,
        now: new Date("2026-08-19T00:00:03.000Z"),
      })).resolves.toEqual({ status: "not_publishable" });
      await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
    },
  );

  it.each(["expired", "revoked"] as const)(
    "rejects publication and terminates the turn when the website session is %s",
    async (sessionState) => {
      const suffix = sessionState === "expired" ? "c7" : "c8";
      const sessionHash = suffix.repeat(32);
      const claimed = await claimWebsiteTurn({
        sessionHash,
        networkHash: (sessionState === "expired" ? "c9" : "ca").repeat(32),
        messageHash: (sessionState === "expired" ? "cb" : "cc").repeat(32),
      });
      const [attempt] = await database.insert(customerServiceAiAttempts).values({
        messageId: claimed.messageId,
        attemptNumber: 1,
        trigger: "webhook_after",
        intent: "design_process",
        riskLevel: "low",
        gateResult: "allowed",
        knowledgeVersion: "knowledge-v1",
        status: "draft_ready",
        providerCalled: true,
        provider: "mock",
        model: "mock-text",
        draftText: "A stale session must not receive this.",
        validatorCodes: [],
        completedAt: new Date("2026-08-19T00:00:02.000Z"),
      }).returning({ id: customerServiceAiAttempts.id });
      await database.update(customerServiceWebSessions).set(sessionState === "expired"
        ? { expiresAt: new Date("2026-08-19T00:00:02.500Z") }
        : { status: "revoked" })
        .where(eq(customerServiceWebSessions.sessionTokenHash, sessionHash));

      await expect(repository.publishWebsiteValidatedAi({
        turnId: claimed.turnId,
        leaseToken: claimed.leaseToken,
        attemptId: attempt.id,
        now: new Date("2026-08-19T00:00:03.000Z"),
      })).resolves.toEqual({ status: "cancelled" });
      const [storedTurn] = await database.select().from(customerServiceTurns)
        .where(eq(customerServiceTurns.id, claimed.turnId));
      expect(storedTurn).toMatchObject({
        processingStatus: "cancelled",
        lastProcessingError: "website_session_inactive",
      });
      await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
    },
  );

  it("validates the website session at actual publication time after provider work", async () => {
    const sessionHash = "dd".repeat(32);
    const claimAt = new Date("2026-08-19T00:00:02.000Z");
    const sessionExpiresAt = new Date("2026-08-19T00:00:04.000Z");
    const publicationAt = new Date("2026-08-19T00:00:05.000Z");
    await activateWebsitePilot("website-publication-time");
    const incoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash: "de".repeat(32),
      messageHash: "df".repeat(32),
    }));
    if (incoming.status !== "turn_pending") throw new Error("expected website turn");
    await database.update(customerServiceWebSessions)
      .set({ expiresAt: sessionExpiresAt })
      .where(eq(customerServiceWebSessions.sessionTokenHash, sessionHash));
    const generateDraft = vi.fn(async (messageId: string) => {
      const [attempt] = await database.insert(customerServiceAiAttempts).values({
        messageId,
        attemptNumber: 1,
        trigger: "webhook_after",
        intent: "design_process",
        riskLevel: "low",
        gateResult: "allowed",
        knowledgeVersion: "knowledge-v1",
        status: "draft_ready",
        providerCalled: true,
        provider: "mock",
        model: "mock-text",
        draftText: "This expired-session reply must remain private.",
        validatorCodes: [],
        completedAt: publicationAt,
      }).returning({ id: customerServiceAiAttempts.id });
      return { status: "draft_ready" as const, attemptId: attempt.id };
    });
    const times = [claimAt, publicationAt];
    const runner = createCustomerTurnRecoveryRunner({
      repository,
      generateDraft,
      knowledgeVersion: "knowledge-v1",
      now: () => times.shift() ?? publicationAt,
    });

    await expect(runner.runOnce({ turnId: incoming.turnId })).resolves.toEqual({
      claimed: 1,
      completed: 0,
      retried: 0,
      cancelled: 1,
    });
    expect(generateDraft).toHaveBeenCalledOnce();
    const [storedTurn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    expect(storedTurn).toMatchObject({
      processingStatus: "cancelled",
      lastProcessingError: "website_session_inactive",
    });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("rejects stale publication when a newer customer turn exists in the same conversation", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "cd".repeat(32),
      networkHash: "ce".repeat(32),
      messageHash: "cf".repeat(32),
    });
    const [targetTurn] = await database.select({ conversationId: customerServiceTurns.conversationId })
      .from(customerServiceTurns).where(eq(customerServiceTurns.id, claimed.turnId));
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "An obsolete answer must not become public.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    const [newerMessage] = await database.insert(customerServiceMessages).values({
      conversationId: targetTurn.conversationId,
      channel: "website",
      externalMessageKeyHash: "d0".repeat(32),
      body: "A newer customer question",
      customerText: "A newer customer question",
      receivedAt: new Date("2026-08-19T00:00:02.500Z"),
    }).returning({ id: customerServiceMessages.id });
    const [newerTurn] = await database.insert(customerServiceTurns).values({
      conversationId: targetTurn.conversationId,
      channel: "website",
      representativeMessageId: newerMessage.id,
      body: "A newer customer question",
      debounceUntil: new Date("2026-08-19T00:00:04.500Z"),
      nextRunAt: new Date("2026-08-19T00:00:04.500Z"),
      openedAt: new Date("2026-08-19T00:00:02.500Z"),
      lastEventAt: new Date("2026-08-19T00:00:02.500Z"),
    }).returning({ id: customerServiceTurns.id });
    await database.insert(customerServiceConversationEvents).values({
      conversationId: targetTurn.conversationId,
      turnId: newerTurn.id,
      legacyMessageId: newerMessage.id,
      channel: "website",
      externalMessageKeyHash: "d0".repeat(32),
      role: "customer",
      eventType: "customer_message",
      body: "A newer customer question",
      receivedAt: new Date("2026-08-19T00:00:02.500Z"),
    });

    await expect(repository.publishWebsiteValidatedAi({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: attempt.id,
      now: new Date("2026-08-19T00:00:03.000Z"),
    })).resolves.toEqual({ status: "cancelled" });
    const [storedTurn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, claimed.turnId));
    expect(storedTurn).toMatchObject({ processingStatus: "cancelled" });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toHaveLength(0);
  });

  it("opens provider-error review for an uncertain Website provider attempt without a second provider call", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "d1".repeat(32),
      networkHash: "d2".repeat(32),
      messageHash: "d3".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "knowledge-v1",
      status: "provider_pending",
      providerCalled: true,
      reservedCostMicrousd: 0,
    }).returning({ id: customerServiceAiAttempts.id });
    const generateDraft = vi.fn(() => Promise.reject(new Error("provider must not be called twice")));
    let releaseClaim!: () => void;
    let observeClaim!: () => void;
    const claimObserved = new Promise<void>((resolve) => { observeClaim = resolve; });
    const claimRelease = new Promise<void>((resolve) => { releaseClaim = resolve; });
    const recoveryRepository = {
      ...repository,
      async claimDueCustomerTurn(input: Parameters<typeof repository.claimDueCustomerTurn>[0]) {
        const result = await repository.claimDueCustomerTurn(input);
        observeClaim();
        await claimRelease;
        return result;
      },
    };
    const runner = createCustomerTurnRecoveryRunner({
      repository: recoveryRepository,
      generateDraft,
      knowledgeVersion: "knowledge-v1",
      now: () => new Date("2026-08-19T00:06:00.000Z"),
    });

    const recovery = runner.runOnce({ turnId: claimed.turnId });
    await claimObserved;
    await repository.completeProviderAttempt({
      attemptId: attempt.id,
      status: "draft_ready",
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      websiteDecision: approvedWebsiteDesignDecision,
      websiteResponseTemplateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
      validatorCodes: [],
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      estimatedCostMicrousd: 20,
      latencyMs: 100,
      dailyScopeKey: "daily:2026-08-19",
    });
    releaseClaim();

    await expect(recovery).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      cancelled: 0,
    });
    expect(generateDraft).not.toHaveBeenCalled();
    await expect(database.select().from(customerServiceHumanReviews)).resolves.toEqual([
      expect.objectContaining({ triggerTurnId: claimed.turnId, reason: "provider_error", status: "open" }),
    ]);
    const [storedAttempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, attempt.id));
    expect(storedAttempt).toMatchObject({
      status: "draft_ready",
      providerCalled: true,
      websiteDecision: approvedWebsiteDesignDecision,
      websiteResponseTemplateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
    });
    await expect(database.select().from(customerServiceWebsiteAssistantMessages)).resolves.toEqual([
      expect.objectContaining({ kind: "provider_fallback", policyResult: "provider_error" }),
    ]);
    expect(JSON.stringify(await database.select().from(customerServiceWebsiteAssistantMessages)))
      .not.toContain(approvedWebsiteDesignResponse);
  });

  it("atomically enforces every website session and network request bucket", async () => {
    const sessionHash = "1".repeat(64);
    const networkHash = "2".repeat(64);
    const minuteStart = new Date("2026-08-19T00:00:00.000Z");
    const hourStart = new Date("2026-08-19T00:00:00.000Z");
    const sessionStart = new Date(websiteSessionExpiresAt.getTime() - 7 * 24 * 60 * 60 * 1_000);
    await database.insert(customerServiceRateLimitBuckets).values([
      { bucketKind: "session_minute", bucketKeyHash: sessionHash, windowStartedAt: minuteStart, expiresAt: new Date("2026-08-19T00:01:00.000Z"), requestCount: 4 },
      { bucketKind: "session_hour", bucketKeyHash: sessionHash, windowStartedAt: hourStart, expiresAt: new Date("2026-08-19T01:00:00.000Z"), requestCount: 29 },
      { bucketKind: "session_total", bucketKeyHash: sessionHash, windowStartedAt: sessionStart, expiresAt: websiteSessionExpiresAt, requestCount: 99 },
      { bucketKind: "network_minute", bucketKeyHash: networkHash, windowStartedAt: minuteStart, expiresAt: new Date("2026-08-19T00:01:00.000Z"), requestCount: 9 },
      { bucketKind: "network_hour", bucketKeyHash: networkHash, windowStartedAt: hourStart, expiresAt: new Date("2026-08-19T01:00:00.000Z"), requestCount: 59 },
    ]);

    const first = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "3".repeat(64),
    }));
    const second = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "4".repeat(64),
    }));

    expect(first).toMatchObject({ status: "turn_pending" });
    expect(second).toEqual({ status: "rate_limited" });
  });

  it.each([
    ["session_minute", 5],
    ["session_hour", 30],
    ["session_total", 100],
    ["network_minute", 10],
    ["network_hour", 60],
  ] as const)("enforces the %s website rate bucket independently", async (kind, limit) => {
    const sessionHash = "0a".repeat(32);
    const networkHash = "0b".repeat(32);
    const minute = new Date("2026-08-19T00:00:00.000Z");
    const hour = new Date("2026-08-19T00:00:00.000Z");
    const session = new Date(websiteSessionExpiresAt.getTime() - 7 * 24 * 60 * 60 * 1_000);
    const values = kind === "session_total"
      ? { windowStartedAt: session, expiresAt: websiteSessionExpiresAt }
      : kind.endsWith("minute")
        ? { windowStartedAt: minute, expiresAt: new Date("2026-08-19T00:01:00.000Z") }
        : { windowStartedAt: hour, expiresAt: new Date("2026-08-19T01:00:00.000Z") };
    await database.insert(customerServiceRateLimitBuckets).values({
      bucketKind: kind,
      bucketKeyHash: kind.startsWith("network") ? networkHash : sessionHash,
      ...values,
      requestCount: limit,
    });

    const result = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: createHmac("sha256", "independent-limit").update(kind).digest("hex"),
    }));
    const [blockedBucket] = await database.select({ count: customerServiceRateLimitBuckets.requestCount })
      .from(customerServiceRateLimitBuckets)
      .where(eq(customerServiceRateLimitBuckets.bucketKind, kind));

    expect(result).toEqual({ status: "rate_limited" });
    expect(blockedBucket?.count).toBe(limit);
  });

  it("does not create a session or conversation for a rate-limited first request", async () => {
    const sessionHash = "0c".repeat(32);
    const networkHash = "0d".repeat(32);
    await database.insert(customerServiceRateLimitBuckets).values({
      bucketKind: "network_minute",
      bucketKeyHash: networkHash,
      windowStartedAt: websiteRateNow,
      expiresAt: new Date("2026-08-19T00:01:00.000Z"),
      requestCount: 10,
    });

    const result = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "0e".repeat(32),
      isNewSession: true,
    }));
    const sessions = await database.select().from(customerServiceWebSessions);
    const conversations = await database.select().from(customerServiceConversations);
    const sessionBuckets = await database.select().from(customerServiceRateLimitBuckets)
      .where(sql`${customerServiceRateLimitBuckets.bucketKind} like 'session_%'`);

    expect(result).toEqual({ status: "rate_limited" });
    expect(sessions).toHaveLength(0);
    expect(conversations).toHaveLength(0);
    expect(sessionBuckets).toHaveLength(0);
  });

  it("allows only one concurrent request at the final website rate allowance", async () => {
    const sessionHash = "5".repeat(64);
    const networkHash = "6".repeat(64);
    await database.insert(customerServiceRateLimitBuckets).values({
      bucketKind: "session_minute",
      bucketKeyHash: sessionHash,
      windowStartedAt: websiteRateNow,
      expiresAt: new Date("2026-08-19T00:01:00.000Z"),
      requestCount: 4,
    });

    const results = await Promise.all([
      repository.ingestConversationEvent(websiteRateEvent({ sessionHash, networkHash, messageHash: "7".repeat(64) })),
      repository.ingestConversationEvent(websiteRateEvent({ sessionHash, networkHash, messageHash: "8".repeat(64) })),
    ]);

    expect(results.filter((result) => result.status === "turn_pending")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rate_limited")).toHaveLength(1);
  });

  it("does not create a second runnable website turn after the first turn is sealed", async () => {
    await activateWebsitePilot("website-one-runnable-turn");
    const sessionHash = "9".repeat(64);
    const networkHash = "a".repeat(64);
    const first = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "b".repeat(64),
    }));
    if (first.status !== "turn_pending") throw new Error("expected website turn");
    await repository.sealDueCustomerTurn({
      turnId: first.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
    });

    const next = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "c".repeat(64),
      receivedAt: new Date("2026-08-19T00:00:04.000Z"),
    }));

    expect(next).toEqual({ status: "rate_limited" });
  });

  it("allows a later website turn after the prior sealed turn completed", async () => {
    await activateWebsitePilot("website-completed-turn-allows-next");
    const sessionHash = "1a".repeat(32);
    const networkHash = "1b".repeat(32);
    const first = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "1c".repeat(32),
    }));
    if (first.status !== "turn_pending") throw new Error("expected website turn");
    await repository.sealDueCustomerTurn({
      turnId: first.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
    });
    await database.update(customerServiceTurns).set({
      processingStatus: "completed",
      processingCompletedAt: new Date("2026-08-19T00:00:04.000Z"),
    }).where(eq(customerServiceTurns.id, first.turnId));

    const next = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "1d".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:05.000Z"),
    }));

    expect(next.status).toBe("turn_pending");
  });

  it("commits abuse counts when one in-flight website turn rejects a new turn", async () => {
    await activateWebsitePilot("website-rejected-counts");
    const sessionHash = "2a".repeat(32);
    const networkHash = "2b".repeat(32);
    const first = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "2c".repeat(32),
    }));
    if (first.status !== "turn_pending") throw new Error("expected website turn");
    await repository.sealDueCustomerTurn({
      turnId: first.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
    });

    const rejected = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash,
      networkHash,
      messageHash: "2d".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:04.000Z"),
    }));
    const counts = await database.select({
      kind: customerServiceRateLimitBuckets.bucketKind,
      count: customerServiceRateLimitBuckets.requestCount,
    }).from(customerServiceRateLimitBuckets);

    expect(rejected).toEqual({ status: "rate_limited" });
    expect(counts).toHaveLength(5);
    expect(counts.every((bucket) => bucket.count === 2)).toBe(true);
  });

  it("does not count a duplicate website message twice", async () => {
    const event = websiteRateEvent({
      sessionHash: "3a".repeat(32),
      networkHash: "3b".repeat(32),
      messageHash: "3c".repeat(32),
    });
    expect((await repository.ingestConversationEvent(event)).status).toBe("turn_pending");
    expect(await repository.ingestConversationEvent(event)).toEqual({ status: "duplicate" });

    const counts = await database.select({ count: customerServiceRateLimitBuckets.requestCount })
      .from(customerServiceRateLimitBuckets);
    expect(counts).toHaveLength(5);
    expect(counts.every((bucket) => bucket.count === 1)).toBe(true);
  });

  it("does not count concurrent duplicate website messages twice", async () => {
    const event = websiteRateEvent({
      sessionHash: "3d".repeat(32),
      networkHash: "3e".repeat(32),
      messageHash: "3f".repeat(32),
    });

    const results = await Promise.all([
      repository.ingestConversationEvent(event),
      repository.ingestConversationEvent(event),
    ]);
    const counts = await database.select({ count: customerServiceRateLimitBuckets.requestCount })
      .from(customerServiceRateLimitBuckets);

    expect(results.filter((result) => result.status === "turn_pending")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(1);
    expect(counts).toHaveLength(5);
    expect(counts.every((bucket) => bucket.count === 1)).toBe(true);
  });

  it("reserves website and global budget scopes atomically while retaining the global hard stop", async () => {
    const incoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "d".repeat(64),
      networkHash: "e".repeat(64),
      messageHash: "f".repeat(64),
    }));
    if (incoming.status !== "turn_pending") throw new Error("expected website turn");
    const reservation = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "product_difference",
      riskLevel: "low",
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1_000,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 10_000,
      websiteDailyWarningMicrousd: 5_000,
      websiteDailyHardStopMicrousd: 10_000,
      websiteTotalHardStopMicrousd: 10_000,
    } as Parameters<typeof repository.reserveProviderAttempt>[0]);

    expect(reservation.status).toBe("reserved");
    const globalScopes = await database.select().from(customerServiceBudgetState)
      .orderBy(asc(customerServiceBudgetState.scopeKey));
    const websiteScopes = await database.select().from(customerServiceWebsiteBudgetState)
      .orderBy(asc(customerServiceWebsiteBudgetState.scopeKey));
    expect([...globalScopes, ...websiteScopes].map((scope) => scope.scopeKey).sort()).toEqual([
      "daily:2026-08-19",
      "daily:website:2026-08-19",
      "total",
      "total:website",
    ].sort());

    const globalBlocked = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "manual_regenerate",
      intent: "product_difference",
      riskLevel: "low",
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 10_000,
      websiteDailyWarningMicrousd: 5_000,
      websiteDailyHardStopMicrousd: 10_000,
      websiteTotalHardStopMicrousd: 10_000,
    } as Parameters<typeof repository.reserveProviderAttempt>[0]);

    expect(globalBlocked.status).toBe("budget_blocked");
  });

  it("derives website budget scopes from the persisted message under a final-allowance race", async () => {
    const incoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "4a".repeat(32),
      networkHash: "4b".repeat(32),
      messageHash: "4c".repeat(32),
    }));
    if (incoming.status !== "turn_pending") throw new Error("expected website turn");
    const reservation = {
      messageId: incoming.messageId,
      trigger: "manual_regenerate" as const,
      intent: "product_difference",
      riskLevel: "low" as const,
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1_000,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 100_000,
      totalHardStopMicrousd: 100_000,
      websiteDailyWarningMicrousd: 500,
      websiteDailyHardStopMicrousd: 1_000,
      websiteTotalHardStopMicrousd: 100_000,
    };

    const results = await Promise.all([
      repository.reserveProviderAttempt(reservation),
      repository.reserveProviderAttempt(reservation),
    ]);

    expect(results.filter((result) => result.status === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "budget_blocked")).toHaveLength(1);
  });

  it("allows only one provider reservation at the global final allowance", async () => {
    const incoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "4d".repeat(32),
      networkHash: "4e".repeat(32),
      messageHash: "4f".repeat(32),
    }));
    if (incoming.status !== "turn_pending") throw new Error("expected website turn");
    const reservation = {
      messageId: incoming.messageId,
      trigger: "manual_regenerate" as const,
      intent: "product_difference",
      riskLevel: "low" as const,
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1_000,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 100_000,
      totalHardStopMicrousd: 1_000,
      websiteDailyWarningMicrousd: 50_000,
      websiteDailyHardStopMicrousd: 100_000,
      websiteTotalHardStopMicrousd: 100_000,
    };

    const results = await Promise.all([
      repository.reserveProviderAttempt(reservation),
      repository.reserveProviderAttempt(reservation),
    ]);

    expect(results.filter((result) => result.status === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "budget_blocked")).toHaveLength(1);
  });

  it("surfaces a website daily warning durably without blocking reservation", async () => {
    const incoming = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "5a".repeat(32),
      networkHash: "5b".repeat(32),
      messageHash: "5c".repeat(32),
    }));
    if (incoming.status !== "turn_pending") throw new Error("expected website turn");

    const result = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "product_difference",
      riskLevel: "low",
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1_000,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 100_000,
      totalHardStopMicrousd: 100_000,
      websiteDailyWarningMicrousd: 1_000,
      websiteDailyHardStopMicrousd: 10_000,
      websiteTotalHardStopMicrousd: 100_000,
    });
    const warning = await database.execute(sql`
      select warning_reached_at, warning_threshold_microusd
      from customer_service_website_budget_state
      where scope_key = 'daily:website:2026-08-19'
    `);

    expect(result.status).toBe("reserved");
    expect(warning.rows[0]).toMatchObject({ warning_threshold_microusd: "1000" });
    expect(warning.rows[0]?.warning_reached_at).not.toBeNull();
  });

  it("persists customer and staff events in one isolated conversation", async () => {
    const contextualRepository = repository as typeof repository & {
      ingestConversationEvent(input: {
        channel: "facebook";
        role: "customer" | "staff";
        externalConversationKeyHash: string;
        externalMessageKeyHash: string;
        text: string;
        attachments: [];
        imageJob: null;
        receivedAt: Date;
      }): Promise<{ status: string; messageId?: string; turnId?: string }>;
    };
    const conversationHash = "a".repeat(64);
    const customer = await contextualRepository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "b".repeat(64),
      text: "How much are your banners?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const staff = await contextualRepository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "c".repeat(64),
      text: "Which type of banner do you need?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    });
    const duplicate = await contextualRepository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "c".repeat(64),
      text: "Which type of banner do you need?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    });

    expect(customer).toMatchObject({ status: "turn_pending", messageId: expect.any(String), turnId: expect.any(String) });
    expect(staff).toEqual({ status: "context_only" });
    expect(duplicate).toEqual({ status: "duplicate" });
    const conversations = await database.execute(sql`select count(*)::int as count from customer_service_conversations`);
    const events = await database.execute(sql`
      select role, body from customer_service_conversation_events order by received_at, created_at, id
    `);
    const messages = await database.execute(sql`select count(*)::int as count from customer_service_messages`);
    expect(conversations.rows[0]).toEqual({ count: 1 });
    expect(events.rows).toEqual([
      { role: "customer", body: "How much are your banners?" },
      { role: "staff", body: "Which type of banner do you need?" },
    ]);
    expect(messages.rows[0]).toEqual({ count: 1 });
  });

  it("returns incremental queue changes once and ignores duplicate webhook delivery", async () => {
    await activateFacebookPilot("live-updates-once");
    const cursor = await repository.getReplyAssistantUiCursor();
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "e1".repeat(32),
      externalMessageKeyHash: "e2".repeat(32),
      text: "How much are your banners?",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    expect(incoming.status).toBe("turn_pending");
    if (incoming.status !== "turn_pending") return;
    await repository.sealDueCustomerTurn({ turnId: incoming.turnId, now: new Date("2026-08-20T00:00:03.000Z") });

    const first = await repository.listReplyAssistantUpdates(cursor, 250);
    expect(first.queueItems).toHaveLength(1);
    expect(first.queueItems[0]).toMatchObject({
      messageId: incoming.messageId,
      body: "How much are your banners?",
      timeline: [{ role: "customer", text: "How much are your banners?" }],
    });
    expect(first.metrics).not.toBeNull();

    const duplicate = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "e1".repeat(32),
      externalMessageKeyHash: "e2".repeat(32),
      text: "How much are your banners?",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    expect(duplicate).toEqual({ status: "duplicate" });
    await expect(repository.listReplyAssistantUpdates(first.cursor, 250)).resolves.toMatchObject({
      queueItems: [],
      metrics: null,
      learningCandidates: null,
      caseMemories: null,
    });
  });

  it("returns a changed older message even when newer attempt rows fill the queue limit", async () => {
    await activateFacebookPilot("live-updates-direct-message-load");
    const older = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "91".repeat(32),
      externalMessageKeyHash: "92".repeat(32),
      text: "Older customer message",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    const newer = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "93".repeat(32),
      externalMessageKeyHash: "94".repeat(32),
      text: "Newer customer message",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-20T00:01:00.000Z"),
    });
    expect(older.status).toBe("turn_pending");
    expect(newer.status).toBe("turn_pending");
    if (older.status !== "turn_pending" || newer.status !== "turn_pending") return;
    await repository.sealDueCustomerTurn({ turnId: older.turnId, now: new Date("2026-08-20T00:02:00.000Z") });
    await repository.sealDueCustomerTurn({ turnId: newer.turnId, now: new Date("2026-08-20T00:02:00.000Z") });
    await database.insert(customerServiceAiAttempts).values(Array.from({ length: 101 }, (_, index) => ({
      messageId: newer.messageId,
      attemptNumber: index + 1,
      trigger: "manual_regenerate" as const,
      intent: "photo_guidance",
      riskLevel: "low" as const,
      gateResult: "allowed" as const,
      knowledgeVersion: "test-v1",
      status: "draft_ready" as const,
      providerCalled: true,
      provider: "mock" as const,
      model: "mock",
      draftText: `Newer draft ${index + 1}`,
      completedAt: new Date("2026-08-20T00:02:01.000Z"),
    })));
    const cursor = await repository.getReplyAssistantUiCursor();
    await database.update(customerServiceMessages)
      .set({ body: "Older customer message changed" })
      .where(eq(customerServiceMessages.id, older.messageId));

    const update = await repository.listReplyAssistantUpdates(cursor, 250);

    expect(update.queueItems).toHaveLength(1);
    expect(update.queueItems[0]).toMatchObject({
      messageId: older.messageId,
      body: "Older customer message changed",
    });
  });

  it("incrementally adds a human outbound event to only its server-mapped conversation", async () => {
    await activateFacebookPilot("live-updates-isolation");
    const first = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "f1".repeat(32),
      externalMessageKeyHash: "f2".repeat(32),
      text: "Customer A question",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    const second = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "a1".repeat(32),
      externalMessageKeyHash: "a2".repeat(32),
      text: "Customer B question",
      attachments: [],
      imageJob: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-20T00:00:01.000Z"),
    });
    expect(first.status).toBe("turn_pending");
    expect(second.status).toBe("turn_pending");
    if (first.status !== "turn_pending" || second.status !== "turn_pending") return;
    await repository.sealDueCustomerTurn({ turnId: first.turnId, now: new Date("2026-08-20T00:00:04.000Z") });
    await repository.sealDueCustomerTurn({ turnId: second.turnId, now: new Date("2026-08-20T00:00:04.000Z") });
    const cursor = await repository.getReplyAssistantUiCursor();

    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: "f1".repeat(32),
      externalMessageKeyHash: "f3".repeat(32),
      text: "R&R reply for Customer A only",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-20T00:00:05.000Z"),
    });

    const update = await repository.listReplyAssistantUpdates(cursor, 250);
    expect(update.queueItems).toHaveLength(1);
    expect(update.queueItems[0]?.messageId).toBe(first.messageId);
    expect(update.queueItems[0]?.timeline).toEqual([
      expect.objectContaining({ role: "customer", text: "Customer A question" }),
      expect.objectContaining({ role: "staff", text: "R&R reply for Customer A only" }),
    ]);
    expect(JSON.stringify(update.queueItems)).not.toContain("Customer B question");
  });

  it("persists a human outbound echo and atomically suppresses its open customer turn", async () => {
    const conversationHash = "a1".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "b1".repeat(32),
      text: "How much are your banners?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    expect(incoming.status).toBe("turn_pending");
    if (incoming.status !== "turn_pending") return;

    await database.insert(customerServiceAiAttempts).values({
      messageId: incoming.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "quote_information_collection",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "test-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock",
      draftText: "Stale AI draft that must not remain actionable.",
      completedAt: new Date("2026-08-18T00:00:00.500Z"),
    });

    const outbound = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "c1".repeat(32),
      text: "Which type of banner do you need?",
      eventType: "human_outbound",
      bodyHash: "d1".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: "b1".repeat(32),
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    } as Parameters<typeof repository.ingestConversationEvent>[0]);

    expect(outbound).toEqual({ status: "context_only" });
    const [turn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    expect(turn).toMatchObject({
      status: "suppressed",
      suppressionReason: "human_outbound_received",
    });
    await expect(repository.sealDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-18T00:00:03.000Z"),
    })).resolves.toEqual({ status: "already_terminal" });
    const events = await database.select().from(customerServiceConversationEvents)
      .where(eq(customerServiceConversationEvents.conversationId, turn.conversationId))
      .orderBy(asc(customerServiceConversationEvents.receivedAt));
    expect(events.map((event) => ({
      role: event.role,
      eventType: event.eventType,
      body: event.body,
      learningEligible: event.learningEligible,
    }))).toEqual([
      {
        role: "customer",
        eventType: "customer_message",
        body: "How much are your banners?",
        learningEligible: false,
      },
      {
        role: "staff",
        eventType: "human_outbound",
        body: "Which type of banner do you need?",
        learningEligible: true,
      },
    ]);
    await expect(repository.listQueue(100)).resolves.toMatchObject({
      items: [{
        body: "How much are your banners?",
        humanReplyReceived: true,
        latestAttemptId: null,
        draftText: null,
        timeline: [
          { role: "customer", text: "How much are your banners?" },
          { role: "staff", text: "Which type of banner do you need?" },
        ],
      }],
    });
  });

  it("claims and seals one stale open turn for durable recovery", async () => {
    await activateFacebookPilot("recovery-stale-open");
    const incoming = await createRecoveryTurn({
      conversationHash: "d1".repeat(32),
      messageHash: "d2".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");

    const claimed = await repository.claimDueCustomerTurn({
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    });

    expect(claimed).toMatchObject({
      turnId: incoming.turnId,
      messageId: incoming.messageId,
      leaseToken: expect.any(String),
    });
    const [turn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    expect(turn).toMatchObject({ status: "sealed", processingStatus: "running", processingAttempts: 1 });
  });

  it("allows only one claimant when after and recovery workers race", async () => {
    await activateFacebookPilot("recovery-after-race");
    const incoming = await createRecoveryTurn({
      conversationHash: "d3".repeat(32),
      messageHash: "d4".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    const request = {
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    };

    const results = await Promise.all([
      repository.claimDueCustomerTurn(request),
      repository.claimDueCustomerTurn(request),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("never claims a turn after a human outbound echo", async () => {
    await activateFacebookPilot("recovery-human-first");
    const incoming = await createRecoveryTurn({
      conversationHash: "d5".repeat(32),
      messageHash: "d6".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: "d5".repeat(32),
      externalMessageKeyHash: "d7".repeat(32),
      text: "Please send the original photo.",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-19T00:00:01.000Z"),
    });

    await expect(repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    })).resolves.toBeNull();
  });

  it("invalidates an active lease when a human outbound echo arrives during processing", async () => {
    await activateFacebookPilot("recovery-human-during");
    const conversationHash = "d8".repeat(32);
    const incoming = await createRecoveryTurn({ conversationHash, messageHash: "d9".repeat(32) });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    const claimed = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    });
    if (!claimed) throw new Error("expected claimed turn");
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "da".repeat(32),
      text: "Please send the original photo.",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-19T00:00:04.000Z"),
    });

    await expect(repository.completeCustomerTurnProcessing({
      turnId: incoming.turnId,
      leaseToken: claimed.leaseToken,
      now: new Date("2026-08-19T00:00:05.000Z"),
      outcome: "draft_ready",
    })).resolves.toBe(false);
    const [turn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    expect(turn.processingStatus).toBe("cancelled");
  });

  it("retries a transient interruption after its durable next-run deadline", async () => {
    await activateFacebookPilot("recovery-retry");
    const incoming = await createRecoveryTurn({
      conversationHash: "db".repeat(32),
      messageHash: "dc".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    const first = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    });
    if (!first) throw new Error("expected claimed turn");
    await expect(repository.retryCustomerTurnProcessing({
      turnId: incoming.turnId,
      leaseToken: first.leaseToken,
      nextRunAt: new Date("2026-08-19T00:01:03.000Z"),
      errorCode: "turn_processing_interrupted",
    })).resolves.toBe(true);
    await expect(repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:30.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:30.000Z"),
    })).resolves.toBeNull();
    const second = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:01:04.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:06:04.000Z"),
    });
    expect(second?.leaseToken).not.toBe(first.leaseToken);
  });

  it("terminalizes an exhausted recovery attempt and never reclaims it", async () => {
    await activateFacebookPilot("recovery-exhausted");
    const incoming = await createRecoveryTurn({
      conversationHash: "ad".repeat(32),
      messageHash: "ae".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    const claimed = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    });
    if (!claimed) throw new Error("expected claimed turn");

    await expect(repository.exhaustCustomerTurnProcessing({
      turnId: incoming.turnId,
      leaseToken: claimed.leaseToken,
      now: new Date("2026-08-19T00:00:04.000Z"),
      errorCode: "provider_retry_exhausted",
    })).resolves.toBe(true);
    await expect(repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-20T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-20T00:05:00.000Z"),
    })).resolves.toBeNull();
    const [turn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    const [message] = await database.select().from(customerServiceMessages)
      .where(eq(customerServiceMessages.id, incoming.messageId));
    expect(turn).toMatchObject({
      processingStatus: "completed",
      lastProcessingError: "provider_retry_exhausted",
    });
    expect(message.ingestStatus).toBe("provider_error");
  });

  it("releases a pre-invocation reservation and retries after the worker lease expires", async () => {
    await activateFacebookPilot("recovery-before-provider");
    const incoming = await createRecoveryTurn({
      conversationHash: "e3".repeat(32),
      messageHash: "e4".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    const first = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:00:04.000Z"),
    });
    if (!first) throw new Error("expected first claim");
    const reservation = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "product_difference",
      riskLevel: "low",
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1_000,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 10_000,
    });
    await database.update(customerServiceAiAttempts).set({
      startedAt: new Date("2026-08-18T13:00:00.000Z"),
    }).where(eq(customerServiceAiAttempts.id, reservation.attemptId));

    const second = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:05.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:05.000Z"),
    });

    expect(second?.leaseToken).not.toBe(first.leaseToken);
    const [attempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, reservation.attemptId));
    expect(attempt).toMatchObject({
      status: "abandoned",
      providerCalled: false,
      reservedCostMicrousd: 0,
      providerErrorCode: "turn_recovery_pre_invocation_interrupted",
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-19", reservedMicrousd: 0 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0 }),
    ]));
  });

  it("does not retry an expired lease after provider invocation became uncertain", async () => {
    await activateFacebookPilot("recovery-provider-unknown");
    const incoming = await createRecoveryTurn({
      conversationHash: "e5".repeat(32),
      messageHash: "e6".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:00:04.000Z"),
    });
    const reservation = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "product_difference",
      riskLevel: "low",
      gateReasons: [],
      knowledgeSources: ["test"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 1_000,
      dailyScopeKey: "daily:2026-08-19",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 10_000,
    });
    await repository.confirmProviderInvocation({
      attemptId: reservation.attemptId,
      dailyScopeKey: "daily:2026-08-19",
    });

    await expect(repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:05.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:05.000Z"),
    })).resolves.toBeNull();
    const [turn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    expect(turn).toMatchObject({
      processingStatus: "completed",
      lastProcessingError: "provider_outcome_unknown",
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-19", reservedMicrousd: 1_000 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 1_000 }),
    ]));
  });

  it("recovers an orphaned sealed turn but never reclaims terminal processing", async () => {
    await activateFacebookPilot("recovery-sealed");
    const incoming = await createRecoveryTurn({
      conversationHash: "dd".repeat(32),
      messageHash: "de".repeat(32),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.sealDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:03.000Z"),
    });
    const claimed = await repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-19T00:00:04.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:04.000Z"),
    });
    if (!claimed) throw new Error("expected orphaned sealed turn to be claimed");
    await repository.completeCustomerTurnProcessing({
      turnId: incoming.turnId,
      leaseToken: claimed.leaseToken,
      now: new Date("2026-08-19T00:00:05.000Z"),
      outcome: "gate_blocked",
    });

    await expect(repository.claimDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-20T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-20T00:05:00.000Z"),
    })).resolves.toBeNull();
  });

  it("claims multiple due conversations independently", async () => {
    await activateFacebookPilot("recovery-multiple");
    await createRecoveryTurn({ conversationHash: "df".repeat(32), messageHash: "e0".repeat(32) });
    await createRecoveryTurn({ conversationHash: "e1".repeat(32), messageHash: "e2".repeat(32) });
    const request = {
      now: new Date("2026-08-19T00:00:03.000Z"),
      leaseExpiresAt: new Date("2026-08-19T00:05:03.000Z"),
    };

    const first = await repository.claimDueCustomerTurn(request);
    const second = await repository.claimDueCustomerTurn(request);

    expect(first?.turnId).toBeTruthy();
    expect(second?.turnId).toBeTruthy();
    expect(second?.turnId).not.toBe(first?.turnId);
  });

  it("does not suppress or match a turn when an explicit reply reference is unknown", async () => {
    const conversationHash = "a2".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "b2".repeat(32),
      text: "How does the design process work?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");

    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "c2".repeat(32),
      text: "Please send your photos and wording.",
      eventType: "human_outbound",
      bodyHash: "d2".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: "ff".repeat(32),
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    } as Parameters<typeof repository.ingestConversationEvent>[0]);

    const [turn] = await database.select().from(customerServiceTurns)
      .where(eq(customerServiceTurns.id, incoming.turnId));
    expect(turn.status).toBe("open");

    const [group] = await database.select().from(customerServiceHumanReplyMatches);
    await expect(repository.matchHumanReply({
      matchId: group.id,
      now: new Date("2026-08-18T00:02:00.000Z"),
    })).resolves.toEqual({ status: "unmatched" });
  });

  it("prevents provider reservation after a human reply to a sealed turn", async () => {
    await activateFacebookPilot("human-reply-before-provider");
    const conversationHash = "e1".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "f1".repeat(32),
      text: "Can you explain the design process?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.sealDueCustomerTurn({
      turnId: incoming.turnId,
      now: new Date("2026-08-18T00:00:03.000Z"),
    });
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "01".repeat(32),
      text: "Send your photos, theme and wording and we will prepare a draft.",
      eventType: "human_outbound",
      bodyHash: "02".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: null,
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:04.000Z"),
    } as Parameters<typeof repository.ingestConversationEvent>[0]);

    const result = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateReasons: ["confirmed_rule"],
      knowledgeSources: ["design-rules"],
      knowledgeVersion: "test",
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-18",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 20_000,
    });

    expect(result).toMatchObject({ status: "human_reply_received", attemptId: expect.any(String) });
    const [attempt] = await database.select().from(customerServiceAiAttempts);
    expect(attempt).toMatchObject({ status: "abandoned", providerCalled: false, reservedCostMicrousd: 0 });
  });

  it("cancels a reserved invocation when a human echo arrives before the provider call", async () => {
    await activateFacebookPilot("human-reply-during-delayed-generation");
    const conversationHash = "31".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "32".repeat(32),
      text: "Can you explain the design process?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.sealDueCustomerTurn({ turnId: incoming.turnId, now: new Date("2026-08-18T00:00:03.000Z") });
    const reserved = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateReasons: ["confirmed_rule"],
      knowledgeSources: ["design-rules"],
      knowledgeVersion: "test",
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-18",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 20_000,
    });
    if (reserved.status !== "reserved") throw new Error("expected reservation");

    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "33".repeat(32),
      text: "Send your photos, wording and theme and we will prepare a draft.",
      eventType: "human_outbound",
      bodyHash: "34".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: null,
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:04.000Z"),
    } as Parameters<typeof repository.ingestConversationEvent>[0]);

    const guardedRepository = repository as typeof repository & {
      confirmProviderInvocation(input: { attemptId: string; dailyScopeKey: string }): Promise<{ status: string }>;
    };
    await expect(guardedRepository.confirmProviderInvocation({
      attemptId: reserved.attemptId,
      dailyScopeKey: "daily:2026-08-18",
    })).resolves.toEqual({ status: "human_reply_received" });

    const [attempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, reserved.attemptId));
    expect(attempt).toMatchObject({ status: "abandoned", providerCalled: false, reservedCostMicrousd: 0 });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets.every((budget) => budget.reservedMicrousd === 0)).toBe(true);
  });

  it("settles provider cost but discards a draft when a human echo arrives during generation", async () => {
    await activateFacebookPilot("human-reply-after-provider-start");
    const conversationHash = "35".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "36".repeat(32),
      text: "Can you explain the design process?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.sealDueCustomerTurn({ turnId: incoming.turnId, now: new Date("2026-08-18T00:00:03.000Z") });
    const reserved = await repository.reserveProviderAttempt({
      messageId: incoming.messageId,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateReasons: ["confirmed_rule"],
      knowledgeSources: ["design-rules"],
      knowledgeVersion: "test",
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-18",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 20_000,
    });
    if (reserved.status !== "reserved") throw new Error("expected reservation");
    await expect(repository.confirmProviderInvocation({
      attemptId: reserved.attemptId,
      dailyScopeKey: "daily:2026-08-18",
    })).resolves.toEqual({ status: "allowed" });

    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "37".repeat(32),
      text: "Send your photos, wording and theme and we will prepare a draft.",
      eventType: "human_outbound",
      bodyHash: "38".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: null,
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:04.000Z"),
    });
    await repository.completeProviderAttempt({
      attemptId: reserved.attemptId,
      status: "draft_ready",
      provider: "mock",
      model: "mock",
      draftText: "This stale draft must not be shown.",
      validatorCodes: [],
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      estimatedCostMicrousd: 25,
      latencyMs: 10,
      dailyScopeKey: "daily:2026-08-18",
    });

    const [attempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, reserved.attemptId));
    expect(attempt).toMatchObject({
      status: "abandoned",
      providerCalled: true,
      draftText: null,
      websiteDecision: null,
      websiteResponseTemplateVersion: null,
      estimatedCostMicrousd: 25,
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets.every((budget) => budget.reservedMicrousd === 0 && budget.spentMicrousd === 25)).toBe(true);
  });

  it("deduplicates repeated human echoes without changing the terminal turn again", async () => {
    const conversationHash = "41".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "42".repeat(32),
      text: "What product should I choose?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    const echo = {
      channel: "facebook" as const,
      role: "staff" as const,
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "43".repeat(32),
      text: "Will it be displayed on a wall or freestanding?",
      eventType: "human_outbound" as const,
      bodyHash: "44".repeat(32),
      redactionCodes: [],
      replyToExternalMessageKeyHash: null,
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    };

    await expect(repository.ingestConversationEvent(echo as Parameters<typeof repository.ingestConversationEvent>[0]))
      .resolves.toEqual({ status: "context_only" });
    await expect(repository.ingestConversationEvent(echo as Parameters<typeof repository.ingestConversationEvent>[0]))
      .resolves.toEqual({ status: "duplicate" });
    const events = await database.select().from(customerServiceConversationEvents)
      .where(eq(customerServiceConversationEvents.externalMessageKeyHash, echo.externalMessageKeyHash));
    expect(events).toHaveLength(1);
  });

  it("groups consecutive staff echoes and starts a new group after customer interruption", async () => {
    const conversationHash = "45".repeat(32);
    const event = (suffix: string, role: "customer" | "staff", text: string, receivedAt: string) => ({
      channel: "facebook" as const,
      role,
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: suffix.repeat(64 / suffix.length),
      text,
      ...(role === "staff" ? {
        eventType: "human_outbound" as const,
        bodyHash: (suffix + "f").slice(0, 2).repeat(32),
        redactionCodes: [],
        replyToExternalMessageKeyHash: null,
        learningEligible: true,
      } : {}),
      attachments: [],
      imageJob: null,
      receivedAt: new Date(receivedAt),
    });

    await repository.ingestConversationEvent(event("46", "staff", "First line.", "2026-08-18T00:00:00.000Z"));
    await repository.ingestConversationEvent(event("47", "staff", "Second line.", "2026-08-18T00:01:30.000Z"));
    let groups = await database.select().from(customerServiceHumanReplyMatches);
    expect(groups).toHaveLength(1);
    expect(groups[0].humanFinalText).toBe("First line.\nSecond line.");
    const members = await database.select().from(customerServiceHumanReplyMatchEvents)
      .where(eq(customerServiceHumanReplyMatchEvents.matchId, groups[0].id)).orderBy(asc(customerServiceHumanReplyMatchEvents.ordinal));
    expect(members.map((member) => member.ordinal)).toEqual([0, 1]);

    await repository.ingestConversationEvent(event("48", "customer", "One more question.", "2026-08-18T00:01:40.000Z"));
    await repository.ingestConversationEvent(event("49", "staff", "New answer.", "2026-08-18T00:01:50.000Z"));
    groups = await database.select().from(customerServiceHumanReplyMatches)
      .orderBy(asc(customerServiceHumanReplyMatches.firstOutboundAt));
    expect(groups.map((group) => group.humanFinalText)).toEqual([
      "First line.\nSecond line.",
      "New answer.",
    ]);
  });

  it("starts separate staff groups when reply references target different customer messages", async () => {
    const conversationHash = "5a".repeat(32);
    const echo = (messageHash: string, replyHash: string, text: string, receivedAt: string) => ({
      channel: "facebook" as const,
      role: "staff" as const,
      eventType: "human_outbound" as const,
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: messageHash,
      replyToExternalMessageKeyHash: replyHash,
      text,
      bodyHash: sourceHash(text),
      redactionCodes: [],
      learningEligible: true,
      attachments: [],
      imageJob: null,
      receivedAt: new Date(receivedAt),
    });

    await repository.ingestConversationEvent(echo("5b".repeat(32), "5c".repeat(32), "Answer one.", "2026-08-18T00:00:00.000Z"));
    await repository.ingestConversationEvent(echo("5d".repeat(32), "5e".repeat(32), "Answer two.", "2026-08-18T00:00:30.000Z"));

    const groups = await database.select().from(customerServiceHumanReplyMatches)
      .orderBy(asc(customerServiceHumanReplyMatches.firstOutboundAt));
    expect(groups.map((group) => group.humanFinalText)).toEqual(["Answer one.", "Answer two."]);
  });

  it("recovers overdue groups once under concurrent recovery workers", async () => {
    const conversationHash = "4a".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook", role: "customer", externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "4b".repeat(32), text: "How does the design process work?",
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.ingestConversationEvent({
      channel: "facebook", role: "staff", eventType: "human_outbound",
      externalConversationKeyHash: conversationHash, externalMessageKeyHash: "4c".repeat(32),
      text: "Please send your photos and wording.", bodyHash: "4d".repeat(32),
      redactionCodes: [], learningEligible: true, replyToExternalMessageKeyHash: "4b".repeat(32),
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:05.000Z"),
    });

    const results = await Promise.all([
      repository.recoverDueHumanReplies({ now: new Date("2026-08-18T00:01:35.000Z"), groupWindowMs: 90_000, limit: 10, knowledgeVersion: "test" }),
      repository.recoverDueHumanReplies({ now: new Date("2026-08-18T00:01:35.000Z"), groupWindowMs: 90_000, limit: 10, knowledgeVersion: "test" }),
    ]);
    expect(results.reduce((sum, result) => sum + result.matched, 0)).toBe(1);
    const [group] = await database.select().from(customerServiceHumanReplyMatches);
    expect(group.status).toBe("matched");
  });

  it("recovers a group immediately when a new customer event interrupts it", async () => {
    const conversationHash = "4e".repeat(32);
    await repository.ingestConversationEvent({
      channel: "facebook", role: "staff", eventType: "human_outbound",
      externalConversationKeyHash: conversationHash, externalMessageKeyHash: "4f".repeat(32),
      text: "Which size would you like?", bodyHash: "50".repeat(32), redactionCodes: [],
      learningEligible: true, replyToExternalMessageKeyHash: null,
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    await repository.ingestConversationEvent({
      channel: "facebook", role: "customer", externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "5a".repeat(32), text: "A1 please",
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:05.000Z"),
    });
    await expect(repository.recoverDueHumanReplies({
      now: new Date("2026-08-18T00:00:06.000Z"), groupWindowMs: 90_000, limit: 10, knowledgeVersion: "test",
    })).resolves.toMatchObject({ selected: 1, unmatched: 1 });
  });

  it("matches one eligible turn against every completed draft and remains terminal on rematch", async () => {
    await activateFacebookPilot("human-reply-match");
    const conversationHash = "51".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook", role: "customer", externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "52".repeat(32), text: "How does the design process work?",
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.sealDueCustomerTurn({ turnId: incoming.turnId, now: new Date("2026-08-18T00:00:03.000Z") });
    for (const [number, draft] of [[1, "A generic reply."], [2, "Please send your photos, wording and theme."]] as const) {
      await database.insert(customerServiceAiAttempts).values({
        messageId: incoming.messageId, attemptNumber: number, trigger: "webhook_after", intent: "design_process",
        riskLevel: "low", gateResult: "allowed", knowledgeVersion: "test", status: "draft_ready",
        providerCalled: true, provider: "mock", model: "mock", draftText: draft, completedAt: new Date(`2026-08-18T00:00:0${number + 3}.000Z`),
      });
    }
    await repository.ingestConversationEvent({
      channel: "facebook", role: "staff", eventType: "human_outbound",
      externalConversationKeyHash: conversationHash, externalMessageKeyHash: "53".repeat(32),
      replyToExternalMessageKeyHash: "52".repeat(32), text: "Please send your photos, wording and theme!",
      bodyHash: "54".repeat(32), redactionCodes: [], learningEligible: true,
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:01:00.000Z"),
    });
    const [group] = await database.select().from(customerServiceHumanReplyMatches);
    await expect(repository.matchHumanReply({ matchId: group.id, now: new Date("2026-08-18T00:02:31.000Z") }))
      .resolves.toMatchObject({ status: "matched", classification: "accepted_unchanged" });
    const [matched] = await database.select().from(customerServiceHumanReplyMatches).where(eq(customerServiceHumanReplyMatches.id, group.id));
    expect(matched).toMatchObject({
      status: "matched", turnId: incoming.turnId, editClassification: "accepted_unchanged",
      aiAttemptId: expect.any(String), confidence: "high", matchMethod: "reply_to",
    });
    const snapshot = JSON.stringify(matched);
    await expect(repository.matchHumanReply({ matchId: group.id, now: new Date("2026-08-18T00:03:00.000Z") }))
      .resolves.toEqual({ status: "already_terminal" });
    const [after] = await database.select().from(customerServiceHumanReplyMatches).where(eq(customerServiceHumanReplyMatches.id, group.id));
    expect(JSON.stringify(after)).toBe(snapshot);

    await expect(repository.createCaseMemoryCandidate({
      matchId: group.id,
      customerSituation: "Customer asks how the design process works.",
      customerTurnSummary: "Asked about the design process.",
      productCategory: null,
      market: "unknown",
      deadlineContext: null,
      knowledgeVersion: "test",
    })).resolves.toMatchObject({ status: "pending_review", caseMemoryId: expect.any(String) });
    const [memory] = await database.select().from(customerServiceCaseMemories);
    expect(memory).toMatchObject({ eligibilityStatus: "pending_review", intent: "design_process" });
    expect(memory.eligibilityStatus).not.toBe("approved_reusable");

    await database.update(customerServiceCaseMemories).set({
      eligibilityStatus: "approved_reusable",
      decidedAt: new Date("2026-08-18T00:03:01.000Z"),
    }).where(eq(customerServiceCaseMemories.id, memory.id));
    const retrieved = await repository.retrieveApprovedCaseMemories({
      attemptId: matched.aiAttemptId!,
      intent: "design_process",
      riskClass: "low",
      productCategory: null,
      market: "unknown",
      policyReferences: matched.policyReferences,
      knowledgeVersion: "test",
      query: "photos wording theme design process",
      limit: 3,
      now: new Date("2026-08-18T00:04:00.000Z"),
    });
    expect(retrieved).toEqual([expect.objectContaining({
      id: memory.id,
      normalizedSituation: "Customer asks how the design process works.",
      humanFinalReply: "Please send your photos, wording and theme!",
      score: expect.any(Number),
    })]);
    const audits = await database.select().from(customerServiceCaseRetrievals);
    expect(audits).toEqual([expect.objectContaining({
      caseMemoryId: memory.id,
      attemptId: matched.aiAttemptId,
      injected: true,
      thresholdPassed: true,
      rank: 1,
    })]);
    await expect(repository.metricCounts()).resolves.toMatchObject({
      totalActualHumanReplies: 1,
      matchedHumanReplies: 1,
      unmatchedHumanReplies: 0,
      acceptedUnchangedHumanReplies: 1,
      editedHumanReplies: 0,
      independentlyWrittenHumanReplies: 0,
      reusableCaseMemories: 1,
      excludedHighRiskCases: 0,
      casesRetrievedInDrafts: 1,
      learningCandidatesPending: 0,
      learningCandidatesApproved: 0,
      learningCandidatesRejected: 0,
      commonEditReasons: [],
    });
  });

  it("marks a human reply unmatched when multiple pending turns are ambiguous", async () => {
    const conversationHash = "55".repeat(32);
    for (const [suffix, minute] of [["56", 0], ["57", 5]] as const) {
      const incoming = await repository.ingestConversationEvent({
        channel: "facebook", role: "customer", externalConversationKeyHash: conversationHash,
        externalMessageKeyHash: suffix.repeat(32), text: `Question ${suffix}`,
        attachments: [{ externalAttachmentKeyHash: `${suffix}a`.repeat(21).slice(0, 64), ordinal: 0, kind: "image", mimeTypeHint: null }],
        imageJob: null, receivedAt: new Date(`2026-08-18T00:0${minute}:00.000Z`),
      });
      if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    }
    await repository.ingestConversationEvent({
      channel: "facebook", role: "staff", eventType: "human_outbound",
      externalConversationKeyHash: conversationHash, externalMessageKeyHash: "58".repeat(32),
      replyToExternalMessageKeyHash: null, text: "Here is the answer.", bodyHash: "59".repeat(32),
      redactionCodes: [], learningEligible: true, attachments: [], imageJob: null,
      receivedAt: new Date("2026-08-18T00:06:00.000Z"),
    });
    const [group] = await database.select().from(customerServiceHumanReplyMatches);
    await expect(repository.matchHumanReply({ matchId: group.id, now: new Date("2026-08-18T00:08:00.000Z") }))
      .resolves.toEqual({ status: "unmatched" });
  });

  it("creates pending learning candidates and promotes source cases only after admin approval", async () => {
    await activateFacebookPilot("learning-candidate-review");
    for (let index = 0; index < 3; index += 1) {
      const conversationHash = `${70 + index}`.repeat(32);
      const incoming = await repository.ingestConversationEvent({
        channel: "facebook", role: "customer", externalConversationKeyHash: conversationHash,
        externalMessageKeyHash: `${80 + index}`.repeat(32), text: "How does the design process work?",
        attachments: [], imageJob: null, receivedAt: new Date(`2026-08-18T00:0${index}:00.000Z`),
      });
      if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
      await repository.sealDueCustomerTurn({ turnId: incoming.turnId, now: new Date(`2026-08-18T00:0${index}:03.000Z`) });
      await database.insert(customerServiceAiAttempts).values({
        messageId: incoming.messageId, attemptNumber: 1, trigger: "webhook_after",
        intent: "design_process", riskLevel: "low", gateResult: "allowed",
        knowledgeVersion: "test", knowledgeSources: ["DESIGN-01"], status: "draft_ready",
        providerCalled: true, provider: "mock", model: "mock", draftText: "A short unrelated draft.",
        completedAt: new Date(`2026-08-18T00:0${index}:04.000Z`),
      });
      await repository.ingestConversationEvent({
        channel: "facebook", role: "staff", eventType: "human_outbound",
        externalConversationKeyHash: conversationHash, externalMessageKeyHash: `${90 + index}`.repeat(32),
        replyToExternalMessageKeyHash: `${80 + index}`.repeat(32),
        text: "Please send your photos, wording and theme so we can prepare your draft.",
        bodyHash: `${60 + index}`.repeat(32), redactionCodes: [], learningEligible: true,
        attachments: [], imageJob: null, receivedAt: new Date(`2026-08-18T00:0${index}:05.000Z`),
      });
    }

    await repository.recoverDueHumanReplies({
      now: new Date("2026-08-18T00:04:00.000Z"), groupWindowMs: 90_000, limit: 10,
      knowledgeVersion: "test",
    });
    await database.insert(user).values({
      id: "phase36-reviewer", name: "Phase 36 Reviewer", email: "phase36-reviewer@example.test",
      emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    }).onConflictDoNothing();
    const pending = await database.select().from(customerServiceCaseMemories);
    expect(pending.every((memory) => memory.eligibilityStatus === "pending_review")).toBe(true);
    for (const memory of pending) {
      await repository.decideCaseMemory({
        caseMemoryId: memory.id, reviewerUserId: "phase36-reviewer", action: "approve",
        reason: null, now: new Date("2026-08-18T00:04:30.000Z"),
      });
    }
    await expect(repository.refreshLearningCandidates({ minimumMatchedReplies: 3 }))
      .resolves.toMatchObject({ checkpoint: 3, created: 1 });
    const [candidate] = await database.select().from(customerServiceLearningCandidates);
    expect(candidate).toMatchObject({ status: "pending", evidenceCount: 3 });
    await expect(repository.decideLearningCandidate({
      candidateId: candidate.id, reviewerUserId: "phase36-reviewer", action: "approve",
      approvedText: null, reason: null, now: new Date("2026-08-18T00:05:00.000Z"),
    })).resolves.toEqual({ status: "approved" });
    const approved = await database.select().from(customerServiceCaseMemories);
    expect(approved.every((memory) => memory.eligibilityStatus === "approved_reusable")).toBe(true);
  });

  it("lists sanitized pending case memories and rejects them independently from learning proposals", async () => {
    await database.insert(user).values({
      id: "phase36-case-reviewer", name: "Case Reviewer", email: "case-reviewer@example.test",
      emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    }).onConflictDoNothing();
    const conversationHash = "6a".repeat(32);
    const incoming = await repository.ingestConversationEvent({
      channel: "facebook", role: "customer", externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "6b".repeat(32), text: "How does the design process work?",
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    if (incoming.status !== "turn_pending") throw new Error("expected pending turn");
    await repository.sealDueCustomerTurn({ turnId: incoming.turnId, now: new Date("2026-08-18T00:00:03.000Z") });
    await database.insert(customerServiceAiAttempts).values({
      messageId: incoming.messageId, attemptNumber: 1, trigger: "webhook_after",
      intent: "design_process", riskLevel: "low", gateResult: "allowed",
      knowledgeVersion: "test", knowledgeSources: ["DESIGN-01"], status: "draft_ready",
      providerCalled: true, provider: "mock", model: "mock", draftText: "Please send your details.",
      completedAt: new Date("2026-08-18T00:00:04.000Z"),
    });
    await repository.ingestConversationEvent({
      channel: "facebook", role: "staff", eventType: "human_outbound",
      externalConversationKeyHash: conversationHash, externalMessageKeyHash: "6c".repeat(32),
      replyToExternalMessageKeyHash: "6b".repeat(32), text: "Please send your photos, wording and theme.",
      bodyHash: "6d".repeat(32), redactionCodes: [], learningEligible: true,
      attachments: [], imageJob: null, receivedAt: new Date("2026-08-18T00:00:05.000Z"),
    });
    await repository.recoverDueHumanReplies({
      now: new Date("2026-08-18T00:02:00.000Z"), groupWindowMs: 90_000, limit: 10, knowledgeVersion: "test",
    });

    const listed = await repository.listCaseMemoryCandidates(10);
    expect(listed.items).toEqual([expect.objectContaining({
      intent: "design_process",
      normalizedSituation: "How does the design process work?",
      humanFinalReply: "Please send your photos, wording and theme.",
      status: "pending_review",
    })]);
    expect(JSON.stringify(listed)).not.toMatch(/6a6a|6b6b|conversation/i);

    await expect(repository.decideCaseMemory({
      caseMemoryId: listed.items[0].id,
      reviewerUserId: "phase36-case-reviewer",
      action: "reject",
      reason: "Not reusable",
      now: new Date("2026-08-18T00:03:00.000Z"),
    })).resolves.toEqual({ status: "excluded" });
    await expect(repository.decideCaseMemory({
      caseMemoryId: listed.items[0].id,
      reviewerUserId: "phase36-case-reviewer",
      action: "approve",
      reason: null,
      now: new Date("2026-08-18T00:04:00.000Z"),
    })).rejects.toThrow("customer_service_case_memory_transition_invalid");
  });

  it("does not suppress another customer's turn when echoes arrive concurrently", async () => {
    const createTurn = async (conversationHash: string, messageHash: string) => repository.ingestConversationEvent({
      channel: "facebook" as const,
      role: "customer" as const,
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: messageHash,
      text: "How does it work?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const [customerA, customerB] = await Promise.all([
      createTurn("11".repeat(32), "12".repeat(32)),
      createTurn("21".repeat(32), "22".repeat(32)),
    ]);
    if (customerA.status !== "turn_pending" || customerB.status !== "turn_pending") {
      throw new Error("expected pending turns");
    }

    await Promise.all([
      repository.ingestConversationEvent({
        channel: "facebook",
        role: "staff",
        externalConversationKeyHash: "11".repeat(32),
        externalMessageKeyHash: "13".repeat(32),
        text: "Reply for customer A",
        eventType: "human_outbound",
        bodyHash: "14".repeat(32),
        redactionCodes: [],
        replyToExternalMessageKeyHash: null,
        learningEligible: true,
        attachments: [],
        imageJob: null,
        receivedAt: new Date("2026-08-18T00:00:01.000Z"),
      } as Parameters<typeof repository.ingestConversationEvent>[0]),
      createTurn("21".repeat(32), "23".repeat(32)),
    ]);

    const turns = await database.select({ id: customerServiceTurns.id, status: customerServiceTurns.status })
      .from(customerServiceTurns).where(inArray(customerServiceTurns.id, [customerA.turnId, customerB.turnId]));
    expect(turns).toEqual(expect.arrayContaining([
      { id: customerA.turnId, status: "suppressed" },
      { id: customerB.turnId, status: "open" },
    ]));
  });

  it("aggregates rapid fragments and allocates one pilot slot when the turn is sealed", async () => {
    await activateFacebookPilot("context-turn-debounce");
    const conversationHash = "d".repeat(64);
    const first = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "e".repeat(64),
      text: "I need a banner",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const second = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "f".repeat(64),
      text: "around 5 photos",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    });
    expect(first.status).toBe("turn_pending");
    expect(second.status).toBe("turn_pending");
    if (first.status !== "turn_pending" || second.status !== "turn_pending") return;
    expect(second.turnId).toBe(first.turnId);

    const [pilotBefore] = await database.select().from(customerServicePilotRuns);
    expect(pilotBefore.nextSequence).toBe(1);
    await expect(repository.sealDueCustomerTurn({
      turnId: first.turnId,
      now: new Date("2026-08-18T00:00:02.999Z"),
    })).resolves.toEqual({ status: "not_due" });

    const sealed = await Promise.all([
      repository.sealDueCustomerTurn({ turnId: first.turnId, now: new Date("2026-08-18T00:00:03.000Z") }),
      repository.sealDueCustomerTurn({ turnId: first.turnId, now: new Date("2026-08-18T00:00:03.000Z") }),
    ]);
    expect(sealed.map((result) => result.status).sort()).toEqual(["already_terminal", "sealed"]);
    const [ready] = sealed.filter((result) => result.status === "sealed");
    expect(ready).toMatchObject({
      messageId: first.messageId,
      turnId: first.turnId,
      pilotSequence: 1,
    });
    const [turn] = await database.select().from(customerServiceTurns).where(eq(customerServiceTurns.id, first.turnId));
    expect(turn).toMatchObject({
      body: "I need a banner\naround 5 photos",
      fragmentCount: 2,
      status: "sealed",
      pilotSequence: 1,
    });
    const pilotMessages = await database.select().from(customerServiceMessages)
      .where(eq(customerServiceMessages.pilotSequence, 1));
    expect(pilotMessages).toHaveLength(1);
    expect(pilotMessages[0]).toMatchObject({
      id: first.messageId,
      body: "I need a banner\naround 5 photos",
      customerText: "I need a banner\naround 5 photos",
    });
    const [pilotAfter] = await database.select().from(customerServicePilotRuns);
    expect(pilotAfter.nextSequence).toBe(2);
  });

  it("lists and counts a fragmented conversation as one meaningful customer turn", async () => {
    await activateFacebookPilot("context-turn-metrics");
    const conversationHash = "0".repeat(64);
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: "1".repeat(64),
      text: "Which banner size and how many photos would you like?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const fragments = await Promise.all([
      ["2", "The 200 x 100 one", "2026-08-18T00:00:01.000Z"],
      ["3", "around 5 photos", "2026-08-18T00:00:01.500Z"],
      ["4", "for next Saturday", "2026-08-18T00:00:02.000Z"],
    ].map(([key, text, receivedAt]) => repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversationHash,
      externalMessageKeyHash: key.repeat(64),
      text,
      attachments: [],
      imageJob: null,
      receivedAt: new Date(receivedAt),
    })));
    expect(fragments.every((fragment) => fragment.status === "turn_pending")).toBe(true);
    const turnId = fragments[0].status === "turn_pending" ? fragments[0].turnId : "";
    await expect(repository.sealDueCustomerTurn({
      turnId,
      now: new Date("2026-08-18T00:00:04.000Z"),
    })).resolves.toMatchObject({ status: "sealed", pilotSequence: 1 });

    await expect(repository.listQueue(100)).resolves.toMatchObject({
      items: [{
        body: "The 200 x 100 one\naround 5 photos\nfor next Saturday",
        timeline: [
          {
            role: "staff",
            text: "Which banner size and how many photos would you like?",
          },
          { role: "customer", text: "The 200 x 100 one" },
          { role: "customer", text: "around 5 photos" },
          { role: "customer", text: "for next Saturday" },
        ],
      }],
    });
    await expect(repository.metricCounts()).resolves.toMatchObject({
      totalIncomingEligible: 1,
      rawCustomerEvents: 3,
      staffContextEvents: 1,
      meaningfulTurns: 1,
      aggregatedFragments: 2,
      acknowledgementsSuppressed: 0,
    });
  });

  it("suppresses a completed acknowledgement before pilot allocation", async () => {
    await activateFacebookPilot("context-acknowledgement");
    const pending = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: "1".repeat(64),
      externalMessageKeyHash: "2".repeat(64),
      text: "Thanks 😊",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    expect(pending.status).toBe("turn_pending");
    if (pending.status !== "turn_pending") return;

    await expect(repository.sealDueCustomerTurn({
      turnId: pending.turnId,
      now: new Date("2026-08-18T00:00:02.000Z"),
    })).resolves.toEqual({
      status: "suppressed",
      turnId: pending.turnId,
      reason: "completed_acknowledgement",
    });
    const [pilot] = await database.select().from(customerServicePilotRuns);
    expect(pilot.nextSequence).toBe(1);
    const [message] = await database.select().from(customerServiceMessages).where(eq(customerServiceMessages.id, pending.messageId));
    expect(message.pilotSequence).toBeNull();
  });

  it("keeps yes as a meaningful turn when it answers a staff question", async () => {
    await activateFacebookPilot("context-yes-answer");
    const conversation = "3".repeat(64);
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "4".repeat(64),
      text: "Would you like a roll-up banner?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const pending = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "5".repeat(64),
      text: "yes",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    });
    expect(pending.status).toBe("turn_pending");
    if (pending.status !== "turn_pending") return;
    await expect(repository.sealDueCustomerTurn({
      turnId: pending.turnId,
      now: new Date("2026-08-18T00:00:03.000Z"),
    })).resolves.toMatchObject({ status: "sealed", pilotSequence: 1 });
  });

  it("loads bounded role-labelled history from the current conversation only", async () => {
    await activateFacebookPilot("context-history");
    const conversation = "6".repeat(64);
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "7".repeat(64),
      text: "Which country are you in?",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    await repository.ingestConversationEvent({
      channel: "facebook",
      role: "staff",
      externalConversationKeyHash: "8".repeat(64),
      externalMessageKeyHash: "9".repeat(64),
      text: "Other customer's private context",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:00.500Z"),
    });
    const pending = await repository.ingestConversationEvent({
      channel: "facebook",
      role: "customer",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "a".repeat(63) + "1",
      text: "Australia",
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-18T00:00:01.000Z"),
    });
    expect(pending.status).toBe("turn_pending");
    if (pending.status !== "turn_pending") return;
    await repository.sealDueCustomerTurn({
      turnId: pending.turnId,
      now: new Date("2026-08-18T00:00:03.000Z"),
    });

    await expect(repository.loadDraftInput(pending.messageId, 6)).resolves.toMatchObject({
      current: { text: "Australia" },
      context: [
        { role: "staff", text: "Which country are you in?" },
        { role: "customer", text: "Australia" },
      ],
    });
    const loaded = await repository.loadDraftInput(pending.messageId, 6);
    expect(JSON.stringify(loaded)).not.toContain("Other customer's private context");
  });

  it("round-trips server-derived Website product context through durable draft loading", async () => {
    const productContext = {
      market: "NZ" as const,
      productKey: "digital-oil-painting-canvas",
      productTitle: "Digital Oil Painting Canvas",
      category: "canvas" as const,
      pageKind: "product" as const,
    };
    const pending = await repository.ingestConversationEvent({
      channel: "website",
      role: "customer",
      externalConversationKeyHash: "c".repeat(64),
      externalMessageKeyHash: "d".repeat(64),
      text: "What details do you need?",
      attachments: [],
      imageJob: null,
      productContext,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(pending.status).toBe("turn_pending");
    if (pending.status !== "turn_pending") return;

    await expect(repository.loadDraftInput(pending.messageId, 6)).resolves.toMatchObject({
      current: { channel: "website", productContext },
    });
  });

  it("loads only committed Website replies and human outbound history in chronological session context", async () => {
    const first = await claimWebsiteTurn({
      sessionHash: "b9".repeat(32),
      networkHash: "ba".repeat(32),
      messageHash: "bb".repeat(32),
    });
    const [publishedAttempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: first.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-context-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      ...approvedWebsiteDesignProof,
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:03.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await expect(repository.publishWebsiteValidatedAi({
      turnId: first.turnId,
      leaseToken: first.leaseToken,
      attemptId: publishedAttempt.id,
      now: new Date("2026-08-19T00:00:03.500Z"),
    })).resolves.toEqual({ status: "published" });
    await database.insert(customerServiceAiAttempts).values({
      messageId: first.messageId,
      attemptNumber: 2,
      trigger: "manual_regenerate",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-context-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "INTERNAL UNSENT WEBSITE AI ATTEMPT",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:03.750Z"),
    });
    await repository.ingestConversationEvent({
      channel: "website",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: "b9".repeat(32),
      externalMessageKeyHash: "bc".repeat(32),
      text: "We can also help with the wording.",
      bodyHash: "bd".repeat(32),
      redactionCodes: [],
      learningEligible: false,
      replyToExternalMessageKeyHash: null,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-19T00:00:04.000Z"),
    });

    const other = await ingestAndClaimWebsiteTurn({
      sessionHash: "be".repeat(32),
      networkHash: "bf".repeat(32),
      messageHash: "c0".repeat(32),
      receivedAt: new Date("2026-08-19T00:00:04.250Z"),
    });
    const [otherAttempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: other.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-context-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "Tina's private address is not for this customer.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:05.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    await repository.publishWebsiteValidatedAi({
      turnId: other.turnId,
      leaseToken: other.leaseToken,
      attemptId: otherAttempt.id,
      now: new Date("2026-08-19T00:00:05.500Z"),
    });

    const second = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "b9".repeat(32),
      networkHash: "ba".repeat(32),
      messageHash: "c1".repeat(32),
      text: "My theme is blue.",
      receivedAt: new Date("2026-08-19T00:00:06.000Z"),
    }));
    expect(second.status).toBe("turn_pending");
    if (second.status !== "turn_pending") return;

    const loaded = await repository.loadDraftInput(second.messageId, 6);
    expect(loaded).toMatchObject({
      current: { channel: "website", text: "My theme is blue." },
      context: [
        { role: "customer", text: "Can you help with a custom banner?" },
        { role: "staff", text: approvedWebsiteDesignResponse },
        { role: "staff", text: "We can also help with the wording." },
        { role: "customer", text: "My theme is blue." },
      ],
    });
    expect(JSON.stringify(loaded)).not.toContain("INTERNAL UNSENT WEBSITE AI ATTEMPT");
    expect(JSON.stringify(loaded)).not.toContain("Tina's private address");
  });

  it("does not turn Website human replies into automatic case-memory or learning evidence", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "c2".repeat(32),
      networkHash: "c3".repeat(32),
      messageHash: "c4".repeat(32),
    });
    await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-context-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "Please send your photos and wording.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    });
    await repository.ingestConversationEvent({
      channel: "website",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: "c2".repeat(32),
      externalMessageKeyHash: "c5".repeat(32),
      replyToExternalMessageKeyHash: "c4".repeat(32),
      text: "Please send your photos and wording.",
      bodyHash: "c6".repeat(32),
      redactionCodes: [],
      learningEligible: false,
      attachments: [],
      imageJob: null,
      receivedAt: new Date("2026-08-19T00:00:05.000Z"),
    });

    await expect(repository.recoverDueHumanReplies({
      now: new Date("2026-08-19T00:02:00.000Z"),
      groupWindowMs: 90_000,
      limit: 10,
      knowledgeVersion: "website-context-v1",
    })).resolves.toMatchObject({ selected: 1, matched: 1 });
    const [match] = await database.select().from(customerServiceHumanReplyMatches);
    await expect(repository.createCaseMemoryCandidate({
      matchId: match.id,
      customerSituation: "Customer asks about the design process.",
      customerTurnSummary: "Asked about the design process.",
      productCategory: null,
      market: "unknown",
      deadlineContext: null,
      knowledgeVersion: "website-context-v1",
    })).rejects.toThrow("customer_service_case_memory_channel_not_eligible");
    await expect(database.select().from(customerServiceCaseMemories)).resolves.toHaveLength(0);
    await expect(database.select().from(customerServiceLearningCandidates)).resolves.toHaveLength(0);
  });

  it("uses a causal cursor for equal-timestamp Website context and excludes later or cross-channel rows", async () => {
    const sameBusinessTime = new Date("2026-08-19T01:00:00.000Z");
    const first = await claimWebsiteTurn({
      sessionHash: "c7".repeat(32),
      networkHash: "c8".repeat(32),
      messageHash: "c9".repeat(32),
      receivedAt: sameBusinessTime,
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: first.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-context-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: approvedWebsiteDesignResponse,
      ...approvedWebsiteDesignProof,
      validatorCodes: [],
      completedAt: sameBusinessTime,
    }).returning({ id: customerServiceAiAttempts.id });
    await repository.publishWebsiteValidatedAi({
      turnId: first.turnId,
      leaseToken: first.leaseToken,
      attemptId: attempt.id,
      now: sameBusinessTime,
    });
    await repository.ingestConversationEvent({
      channel: "website",
      role: "staff",
      eventType: "human_outbound",
      externalConversationKeyHash: "c7".repeat(32),
      externalMessageKeyHash: "ca".repeat(32),
      text: "Human Website reply.",
      bodyHash: "cb".repeat(32),
      redactionCodes: [],
      learningEligible: false,
      replyToExternalMessageKeyHash: null,
      attachments: [],
      imageJob: null,
      receivedAt: sameBusinessTime,
    });
    const current = await repository.ingestConversationEvent(websiteRateEvent({
      sessionHash: "c7".repeat(32),
      networkHash: "c8".repeat(32),
      messageHash: "cc".repeat(32),
      text: "Current Website customer turn.",
      receivedAt: sameBusinessTime,
    }));
    expect(current.status).toBe("turn_pending");
    if (current.status !== "turn_pending") return;

    const [currentMessage] = await database.select({
      conversationId: customerServiceMessages.conversationId,
    }).from(customerServiceMessages).where(eq(customerServiceMessages.id, current.messageId));
    await database.insert(customerServiceConversationEvents).values([
      {
        conversationId: currentMessage.conversationId,
        channel: "website",
        externalMessageKeyHash: "cd".repeat(32),
        role: "staff",
        eventType: "human_outbound",
        body: "Later Website reply must not leak backward.",
        bodyHash: "ce".repeat(32),
        redactionCodes: [],
        learningEligible: false,
        receivedAt: sameBusinessTime,
      },
      {
        conversationId: currentMessage.conversationId,
        channel: "facebook",
        externalMessageKeyHash: "cf".repeat(32),
        role: "staff",
        eventType: "human_outbound",
        body: "Cross-channel private reply must not leak.",
        bodyHash: "d0".repeat(32),
        redactionCodes: [],
        learningEligible: false,
        receivedAt: sameBusinessTime,
      },
    ]);

    await expect(repository.loadDraftInput(current.messageId, 4)).resolves.toMatchObject({
      context: [
        { role: "customer", text: "Can you help with a custom banner?" },
        { role: "staff", text: approvedWebsiteDesignResponse },
        { role: "staff", text: "Human Website reply." },
        { role: "customer", text: "Current Website customer turn." },
      ],
    });
    await expect(repository.loadDraftInput(current.messageId, 3)).resolves.toMatchObject({
      context: [
        { role: "staff", text: approvedWebsiteDesignResponse },
        { role: "staff", text: "Human Website reply." },
        { role: "customer", text: "Current Website customer turn." },
      ],
    });
  });

  it("retrieves only compatible approved Case Memory for a Website draft", async () => {
    const claimed = await claimWebsiteTurn({
      sessionHash: "d1".repeat(32),
      networkHash: "d2".repeat(32),
      messageHash: "d3".repeat(32),
    });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: claimed.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "design_process",
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "website-context-v1",
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock-text",
      draftText: "Please send your photos and wording.",
      validatorCodes: [],
      completedAt: new Date("2026-08-19T00:00:02.000Z"),
    }).returning({ id: customerServiceAiAttempts.id });
    const [conversation] = await database.select({ id: customerServiceConversations.id })
      .from(customerServiceConversations).where(eq(
        customerServiceConversations.externalKeyHash,
        "d1".repeat(32),
      ));
    const cases = [
      ["approved_reusable", "Photos wording theme design process", null, "website-context-v1"],
      ["pending_review", "Photos wording theme design process", null, "website-context-v1"],
      ["revoked", "Photos wording theme design process", null, "website-context-v1"],
      ["excluded", "Photos wording theme design process", null, "website-context-v1"],
      ["approved_reusable", "Unrelated parcel tracking question", null, "website-context-v1"],
      ["approved_reusable", "Photos wording theme design process", "canvas", "old-version"],
    ] as const;
    for (const [eligibilityStatus, normalizedSituation, productCategory, knowledgeVersion] of cases) {
      const [match] = await database.insert(customerServiceHumanReplyMatches).values({
        conversationId: conversation.id,
        status: "matched",
        firstOutboundAt: new Date("2026-08-19T00:00:03.000Z"),
        lastOutboundAt: new Date("2026-08-19T00:00:03.000Z"),
        turnId: claimed.turnId,
        humanFinalText: "Please send your photos and wording.",
        contextSummary: "customer: design process",
        intent: "design_process",
        riskClass: "low",
        policyReferences: ["DESIGN-01"],
        editClassification: "accepted_unchanged",
        confidence: "high",
      }).returning({ id: customerServiceHumanReplyMatches.id });
      await database.insert(customerServiceCaseMemories).values({
        humanReplyMatchId: match.id,
        intent: "design_process",
        normalizedSituation,
        customerTurnSummary: normalizedSituation,
        contextSummary: "customer: design process",
        aiDraft: null,
        humanFinalReply: "Please send your photos and wording.",
        editClassification: "accepted_unchanged",
        editReasonCodes: [],
        productCategory,
        market: "unknown",
        deadlineContext: null,
        policyReferences: ["DESIGN-01"],
        knowledgeVersion,
        riskClass: "low",
        eligibilityStatus,
        sourceConfidence: "high",
        exclusionCodes: [],
        ...(eligibilityStatus === "pending_review" ? {} : { decidedAt: new Date("2026-08-19T00:00:04.000Z") }),
      });
    }

    const retrieved = await repository.retrieveApprovedCaseMemories({
      attemptId: attempt.id,
      intent: "design_process",
      riskClass: "low",
      productCategory: null,
      market: "unknown",
      policyReferences: ["DESIGN-01"],
      knowledgeVersion: "website-context-v1",
      query: "photos wording theme design process",
      limit: 3,
      now: new Date("2026-08-19T00:00:05.000Z"),
    });
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toMatchObject({ normalizedSituation: "Photos wording theme design process" });
    const audits = await database.select({ injected: customerServiceCaseRetrievals.injected })
      .from(customerServiceCaseRetrievals);
    expect(audits.filter((item) => item.injected)).toHaveLength(1);
  });

  it("uses the chronologically latest Website product context and clears it when the latest fragment has none", async () => {
    const first = await repository.ingestConversationEvent({
      channel: "website",
      role: "customer",
      externalConversationKeyHash: "e".repeat(64),
      externalMessageKeyHash: "1".repeat(64),
      text: "I need a canvas",
      attachments: [],
      imageJob: null,
      productContext: {
        market: "NZ", productKey: "canvas-latest", productTitle: "Latest Canvas",
        category: "canvas", pageKind: "product",
      },
      receivedAt: new Date("2026-08-21T00:00:01.000Z"),
    });
    expect(first.status).toBe("turn_pending");
    if (first.status !== "turn_pending") return;
    const earlier = await repository.ingestConversationEvent({
      channel: "website",
      role: "customer",
      externalConversationKeyHash: "e".repeat(64),
      externalMessageKeyHash: "2".repeat(64),
      text: "Earlier fragment",
      attachments: [],
      imageJob: null,
      productContext: {
        market: "NZ", productKey: "banner-earlier", productTitle: "Earlier Banner",
        category: "banners", pageKind: "product",
      },
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(earlier.status).toBe("turn_pending");
    if (earlier.status !== "turn_pending") return;
    await expect(repository.loadDraftInput(earlier.messageId, 6)).resolves.toMatchObject({
      current: { productContext: { productKey: "canvas-latest" } },
    });

    const latest = await repository.ingestConversationEvent({
      channel: "website",
      role: "customer",
      externalConversationKeyHash: "e".repeat(64),
      externalMessageKeyHash: "3".repeat(64),
      text: "Now I am on a general page",
      attachments: [],
      imageJob: null,
      productContext: null,
      receivedAt: new Date("2026-08-21T00:00:02.000Z"),
    });
    expect(latest.status).toBe("turn_pending");
    if (latest.status !== "turn_pending") return;
    await expect(repository.loadDraftInput(latest.messageId, 6)).resolves.toMatchObject({
      current: { productContext: null },
    });
  });

  it("rejects malformed, oversized, and Facebook product context at the database boundary", async () => {
    const [websiteConversation] = await database.insert(customerServiceConversations).values({
      channel: "website",
      externalKeyHash: "f".repeat(64),
    }).returning({ id: customerServiceConversations.id });
    const [facebookConversation] = await database.insert(customerServiceConversations).values({
      channel: "facebook",
      externalKeyHash: "0".repeat(64),
    }).returning({ id: customerServiceConversations.id });
    const base = {
      externalMessageKeyHash: "9".repeat(64),
      body: "test",
      customerText: "test",
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
    };

    await expect(database.insert(customerServiceMessages).values({
      ...base,
      conversationId: websiteConversation.id,
      channel: "website",
      productContext: {
        market: "NZ", productKey: 123, productTitle: true,
        category: "canvas", pageKind: "product",
      } as never,
    })).rejects.toThrow();
    await expect(database.insert(customerServiceMessages).values({
      ...base,
      externalMessageKeyHash: "8".repeat(64),
      conversationId: websiteConversation.id,
      channel: "website",
      productContext: {
        market: "NZ", productKey: "x".repeat(101), productTitle: "Canvas",
        category: "canvas", pageKind: "product",
      },
    })).rejects.toThrow();
    await expect(database.insert(customerServiceMessages).values({
      ...base,
      externalMessageKeyHash: "6".repeat(64),
      conversationId: websiteConversation.id,
      channel: "website",
      productContext: {
        market: "NZ", productKey: "canvas", productTitle: "x".repeat(161),
        category: "canvas", pageKind: "product",
      },
    })).rejects.toThrow();
    await expect(database.insert(customerServiceMessages).values({
      ...base,
      externalMessageKeyHash: "5".repeat(64),
      conversationId: websiteConversation.id,
      channel: "website",
      productContext: {
        market: "NZ", productKey: "canvas", productTitle: "Canvas",
        category: "canvas", pageKind: "product", privatePrice: 123,
      } as never,
    })).rejects.toThrow();
    await expect(database.insert(customerServiceMessages).values({
      ...base,
      externalMessageKeyHash: "7".repeat(64),
      conversationId: facebookConversation.id,
      channel: "facebook",
      productContext: {
        market: "NZ", productKey: "canvas", productTitle: "Canvas",
        category: "canvas", pageKind: "product",
      },
    })).rejects.toThrow();
  });

  it("deduplicates concurrent Website retries into one message and one customer turn", async () => {
    const event = {
      channel: "website" as const,
      role: "customer" as const,
      externalConversationKeyHash: "4".repeat(64),
      externalMessageKeyHash: "3".repeat(64),
      text: "What details do you need for a quote?",
      attachments: [],
      imageJob: null,
      productContext: null,
      debounceMs: 2_000,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
    };

    const results = await Promise.all([
      repository.ingestConversationEvent(event),
      repository.ingestConversationEvent(event),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["duplicate", "turn_pending"]);
    const messages = await database.execute(sql`
      select count(*)::int as count from customer_service_messages where channel = 'website'
    `);
    const turns = await database.execute(sql`
      select count(*)::int as count from customer_service_turns where channel = 'website'
    `);
    expect(messages.rows[0]).toEqual({ count: 1 });
    expect(turns.rows[0]).toEqual({ count: 1 });
  });

  it("deduplicates concurrent webhook ingestion and allocates one pilot slot", async () => {
    await database.insert(customerServicePilotRuns).values({
      name: "test-facebook",
      channel: "facebook",
      messageLimit: 100,
      status: "active",
      startedAt: new Date(),
    });
    const message = {
      channel: "facebook" as const,
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: "How do I prepare my photos?",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    };
    const results = await Promise.all([
      repository.ingestFacebookMessage(message),
      repository.ingestFacebookMessage(message),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual(["created", "duplicate"]);
    const [persisted] = await database.select().from(customerServiceMessages);
    expect(persisted).toMatchObject({
      body: "How do I prepare my photos?",
      customerText: "How do I prepare my photos?",
    });
  });

  it("loads context from the current conversation only", async () => {
    await database.insert(customerServicePilotRuns).values({
      name: "context-facebook",
      channel: "facebook",
      messageLimit: 100,
      status: "active",
      startedAt: new Date(),
    });
    const first = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "1".repeat(64),
      externalMessageKeyHash: "2".repeat(64),
      text: "first conversation",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "3".repeat(64),
      externalMessageKeyHash: "4".repeat(64),
      text: "other customer",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:01.000Z"),
    });
    expect(first.status).toBe("created");
    if (first.status !== "created") return;
    await expect(repository.loadDraftInput(first.messageId, 6)).resolves.toMatchObject({
      current: { text: "first conversation" },
      context: [{ role: "customer", text: "first conversation" }],
    });
  });

  it("uses customer_text only and never promotes an image compatibility marker into model context", async () => {
    const imageOnly = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "6".repeat(64),
      text: null,
      attachments: [{
        externalAttachmentKeyHash: "7".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const text = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Please assess this message only",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:01:00.000Z"),
    });

    await expect(repository.loadDraftInput(imageOnly.messageId, 6)).resolves.toMatchObject({
      current: { text: null },
      context: [],
    });
    await expect(repository.loadDraftInput(text.messageId, 6)).resolves.toMatchObject({
      current: { text: "Please assess this message only" },
      context: [{ role: "customer", text: "Please assess this message only" }],
    });
  });

  it("omits runnable image work when the pilot is complete", async () => {
    const receivedAt = new Date("2026-08-17T00:00:00.000Z");
    const message = {
      channel: "facebook" as const,
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: null,
      attachments: [{
        externalAttachmentKeyHash: "c".repeat(64),
        ordinal: 0,
        kind: "image" as const,
        mimeTypeHint: "image/jpeg",
      }],
      imageJob: {
        id: "00000000-0000-4000-8000-000000000101",
        status: "pending" as const,
        sourceCiphertext: "v1.encrypted-source",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt,
    };

    const created = await repository.ingestFacebookMessage(message);
    expect(created.status).toBe("pilot_complete");
    const [persistedMessage] = await database.select().from(customerServiceMessages);
    const [persistedAttachment] = await database.select().from(customerServiceAttachments);
    expect(persistedMessage).toMatchObject({
      body: "[Image attachment]",
      customerText: null,
      receivedAt,
    });
    expect(persistedAttachment).toMatchObject({
      messageId: persistedMessage.id,
      conversationId: persistedMessage.conversationId,
      externalAttachmentKeyHash: "c".repeat(64),
      ordinal: 0,
      kind: "image",
      mimeTypeHint: "image/jpeg",
      status: "metadata_received",
    });
    expect(await database.select().from(customerServiceImageJobs)).toEqual([]);
    expect(JSON.stringify([persistedMessage, persistedAttachment])).not.toContain("https://scontent.test/image.jpg");

    const claimInput = {
      jobId: message.imageJob.id,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    };
    await expect(Promise.all([
      repository.claimImageJob(claimInput),
      repository.claimImageJob(claimInput),
    ])).resolves.toEqual([null, null]);
    await expect(repository.claimImageJob(claimInput)).resolves.toBeNull();

    await expect(repository.ingestFacebookMessage(message)).resolves.toMatchObject({ status: "duplicate" });
    expect(await database.select().from(customerServiceAttachments)).toHaveLength(1);
    expect(await database.select().from(customerServiceImageJobs)).toHaveLength(0);

    await expect(repository.ingestFacebookMessage({
      ...message,
      externalMessageKeyHash: "d".repeat(64),
      attachments: [
        { ...message.attachments[0], ordinal: 0 },
        { ...message.attachments[0], externalAttachmentKeyHash: "e".repeat(64), ordinal: 0 },
      ],
    })).rejects.toThrow();
    expect(await database.select().from(customerServiceMessages)).toHaveLength(1);
    expect(await database.select().from(customerServiceAttachments)).toHaveLength(1);
    expect(await database.select().from(customerServiceImageJobs)).toHaveLength(0);
  });

  it("does not recover a legacy runnable image job without a pilot-bound message", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "d".repeat(64),
      externalMessageKeyHash: "e".repeat(64),
      text: "Can I use this photo?",
      attachments: [{
        externalAttachmentKeyHash: "f".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: "image/jpeg",
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).toBe("pilot_complete");
    const [message] = await database.select().from(customerServiceMessages)
      .where(eq(customerServiceMessages.id, created.messageId));
    const jobId = "00000000-0000-4000-8000-000000000102";
    await database.insert(customerServiceImageJobs).values({
      id: jobId,
      messageId: message.id,
      conversationId: message.conversationId,
      status: "pending",
      sourceCiphertext: "v1.legacy-encrypted-source",
      sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
      nextRunAt: new Date("2026-08-17T00:00:00.000Z"),
    });

    const claimInput = {
      jobId,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    };
    await expect(Promise.all([
      repository.claimImageJob(claimInput),
      repository.claimImageJob(claimInput),
    ])).resolves.toEqual([null, null]);
    await expect(repository.claimImageJob(claimInput)).resolves.toBeNull();
  });

  it("persists unsupported attachment kind and stable failure metadata without a source", async () => {
    await activateFacebookPilot("unsupported-attachment");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "f".repeat(64),
      externalMessageKeyHash: "e".repeat(64),
      text: "Please check this file",
      attachments: [{
        externalAttachmentKeyHash: "d".repeat(64),
        ordinal: 0,
        kind: "unsupported",
        mimeTypeHint: "application/pdf",
        failureCode: "unsupported_attachment",
      }],
      imageJob: {
        id: "00000000-0000-4000-8000-000000000171",
        status: "human_review_required",
        sourceCiphertext: null,
        sourceExpiresAt: null,
        failureCode: "unsupported_attachment",
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    expect(attachment).toMatchObject({
      messageId: created.messageId,
      kind: "image",
      normalizedKind: "unsupported",
      status: "rejected",
      failureCode: "unsupported_attachment",
      privateStorageKey: null,
    });
    await expect(repository.selectImageContext(created.messageId)).resolves.toMatchObject({
      hasUnsupportedAttachments: true,
      analysisSummary: null,
    });
  });

  it("projects up to 100 queue image assessments with a fixed number of reads", async () => {
    const created = await Promise.all(["a", "b"].map((key, index) => repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: key.repeat(64),
      externalMessageKeyHash: String(index + 1).repeat(64),
      text: "Can you assess this photo?",
      attachments: [{
        externalAttachmentKeyHash: String(index + 3).repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: "image/png",
      }],
      receivedAt: new Date(`2026-08-17T00:00:0${index}.000Z`),
    })));
    if (created.some((result) => result.status === "duplicate")) return;
    const messageIds = created.map((result) => result.messageId);
    const attachments = await database.select({
      id: customerServiceAttachments.id,
      messageId: customerServiceAttachments.messageId,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    }).from(customerServiceAttachments).where(inArray(customerServiceAttachments.messageId, messageIds));

    for (const [index, attachment] of attachments.entries()) {
      for (const cleanupFailed of index === 0 ? [true, false] : [false]) {
        const attemptId = await repository.createImageAnalysisAttempt({
          messageId: attachment.messageId,
          schemaVersion: "1",
          attachments: [{
            attachmentId: attachment.id,
            ordinal: 0,
            externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
          }],
        });
        const storageKey = `customer-service-attachments/test-${index}-${cleanupFailed ? "stale" : "valid"}.bin`;
        await repository.markImageAttachmentStored({
          attemptId,
          attachmentId: attachment.id,
          verifiedMimeType: "image/png",
          width: 100,
          height: 80,
          byteSize: 64,
          sha256: "e".repeat(64),
          privateStorageKey: storageKey,
          deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
        });
        await repository.completeImageAnalysisAttempt(imageCompletion(attemptId, "analyzed"));
        await repository.markImageAttachmentDeleted({
          attemptId,
          attachmentId: attachment.id,
          privateStorageKey: storageKey,
          deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
          deleted: !cleanupFailed,
          failureCode: cleanupFailed ? "image_cleanup_failed" : null,
        });
      }
    }

    let queryCount = 0;
    const countedRepository = createDrizzleCustomerServiceRepository(drizzle(testDatabaseUrl!, {
      logger: { logQuery: () => { queryCount += 1; } },
    }));
    const page = await countedRepository.listQueue(100);

    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ attachmentCount: 1, imageAnalysisStatus: "assessed" }),
    ]));
    expect(queryCount).toBeLessThanOrEqual(5);
  });

  it("returns the refreshed queue assessment after delayed image cleanup succeeds", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "8".repeat(64),
      externalMessageKeyHash: "9".repeat(64),
      text: "Can you assess this photo?",
      attachments: [{
        externalAttachmentKeyHash: "7".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: "image/png",
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select().from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{
        attachmentId: attachment.id,
        ordinal: 0,
        externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
      }],
    });
    const storageKey = "customer-service-attachments/delayed-cleanup.bin";
    const deleteDueAt = new Date("2026-08-18T00:00:00.000Z");
    await repository.markImageAttachmentStored({
      attemptId,
      attachmentId: attachment.id,
      verifiedMimeType: "image/png",
      width: 100,
      height: 80,
      byteSize: 64,
      sha256: "6".repeat(64),
      privateStorageKey: storageKey,
      deleteDueAt,
    });
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptId, "analyzed"));
    await repository.markImageAttachmentDeleted({
      attemptId,
      attachmentId: attachment.id,
      privateStorageKey: storageKey,
      deleteDueAt,
      deleted: false,
      failureCode: "image_cleanup_failed",
    });
    const cursor = await repository.getReplyAssistantUiCursor();

    await repository.markImageAttachmentDeleted({
      attemptId,
      attachmentId: attachment.id,
      privateStorageKey: storageKey,
      deleteDueAt,
      deleted: true,
      failureCode: null,
    });

    const updates = await repository.listReplyAssistantUpdates(cursor, 250);
    expect(updates.queueItems).toEqual([
      expect.objectContaining({
        messageId: created.messageId,
        imageAnalysisStatus: "assessed",
        imageAssessmentSummary: "Image 0 is the likely main candidate.",
      }),
    ]);
  });

  it("selects current-message attachments in stable ordinal order", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: "Please check these photos",
      attachments: [
        { externalAttachmentKeyHash: "c".repeat(64), ordinal: 1, kind: "image", mimeTypeHint: "image/png" },
        { externalAttachmentKeyHash: "d".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: "image/jpeg" },
      ],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).toBe("pilot_complete");
    if (created.status === "duplicate") return;

    const attachments = await database.select({
      id: customerServiceAttachments.id,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    })
      .from(customerServiceAttachments)
      .orderBy(customerServiceAttachments.ordinal);
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    });
  });

  it("never reuses preceding attachment-only messages for a later text message", async () => {
    const conversation = "a".repeat(64);
    const start = new Date("2026-08-17T00:00:00.000Z");
    const prior = await Promise.all(Array.from({ length: 6 }, async (_, index) => (
      repository.ingestFacebookMessage({
        channel: "facebook",
        externalConversationKeyHash: conversation,
        externalMessageKeyHash: `${index}`.padStart(64, "b"),
        text: null,
        attachments: [{
          externalAttachmentKeyHash: `${index}`.padStart(64, "c"),
          ordinal: 0,
          kind: "image",
          mimeTypeHint: null,
        }],
        receivedAt: new Date(start.getTime() + index * 60_000),
      })
    )));
    const other = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "d".repeat(64),
      externalMessageKeyHash: "e".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "f".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date(start.getTime() + 6 * 60_000),
    });
    const current = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "g".repeat(64),
      text: "Can you use them?",
      attachments: [],
      receivedAt: new Date(start.getTime() + 6 * 60_000),
    });
    expect(current.status).toBe("pilot_complete");
    if (current.status === "duplicate") return;

    const selected = await repository.selectImageContext(current.messageId);
    expect(selected).toBeNull();
    const [oldest] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, prior[0].messageId));
    const [otherAttachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, other.messageId));
    expect(oldest.id).not.toBe(otherAttachment.id);
  });

  it("stops image context at the first earlier text message", async () => {
    const conversation = "a".repeat(64);
    const start = new Date("2026-08-17T00:00:00.000Z");
    const beforeText = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "b".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "c".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: start,
    });
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "d".repeat(64),
      text: "This is a new request",
      attachments: [],
      receivedAt: new Date(start.getTime() + 60_000),
    });
    const afterText = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "e".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "f".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date(start.getTime() + 2 * 60_000),
    });
    const current = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "g".repeat(64),
      text: "Can you use it?",
      attachments: [],
      receivedAt: new Date(start.getTime() + 3 * 60_000),
    });
    expect(current.status).toBe("pilot_complete");
    if (current.status === "duplicate" || beforeText.status === "duplicate" || afterText.status === "duplicate") return;

    const [allowed] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, afterText.messageId));
    const [blocked] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, beforeText.messageId));
    await expect(repository.selectImageContext(current.messageId)).resolves.toBeNull();
    expect(allowed.id).not.toBe(blocked.id);
  });

  it("does not select attachment-only messages older than five minutes", async () => {
    const start = new Date("2026-08-17T00:00:00.000Z");
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "c".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: start,
    });
    const current = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "d".repeat(64),
      text: "Can you use it?",
      attachments: [],
      receivedAt: new Date(start.getTime() + 5 * 60_000 + 1),
    });
    expect(current.status).toBe("pilot_complete");
    if (current.status === "duplicate") return;

    await expect(repository.selectImageContext(current.messageId)).resolves.toBeNull();
  });

  it("uses createdAt and id to order same-timestamp predecessors and stop at text", async () => {
    const receivedAt = new Date("2026-08-17T00:00:00.000Z");
    const createdAt = new Date("2026-08-17T00:00:01.000Z");
    const conversationId = "00000000-0000-0000-0000-000000000001";
    const beforeTextId = "00000000-0000-0000-0000-000000000010";
    const textBoundaryId = "00000000-0000-0000-0000-000000000020";
    const afterTextId = "00000000-0000-0000-0000-000000000030";
    const currentId = "00000000-0000-0000-0000-000000000040";
    const beforeTextAttachmentId = "00000000-0000-0000-0000-000000000101";
    const afterTextAttachmentId = "00000000-0000-0000-0000-000000000103";

    await database.insert(customerServiceConversations).values({
      id: conversationId,
      channel: "facebook",
      externalKeyHash: "a".repeat(64),
      createdAt,
    });
    await database.insert(customerServiceMessages).values([
      {
        id: beforeTextId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "b".repeat(64),
        body: "[Image attachment]",
        customerText: null,
        receivedAt,
        createdAt,
      },
      {
        id: textBoundaryId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "c".repeat(64),
        body: "A new request",
        customerText: "A new request",
        receivedAt,
        createdAt,
      },
      {
        id: afterTextId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "d".repeat(64),
        body: "[Image attachment]",
        customerText: null,
        receivedAt,
        createdAt,
      },
      {
        id: currentId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "e".repeat(64),
        body: "Can you use it?",
        customerText: "Can you use it?",
        receivedAt,
        createdAt,
      },
    ]);
    await database.insert(customerServiceAttachments).values([
      {
        id: beforeTextAttachmentId,
        messageId: beforeTextId,
        conversationId,
        externalAttachmentKeyHash: "f".repeat(64),
        ordinal: 0,
      },
      {
        id: afterTextAttachmentId,
        messageId: afterTextId,
        conversationId,
        externalAttachmentKeyHash: "g".repeat(64),
        ordinal: 0,
      },
    ]);

    await expect(repository.selectImageContext(currentId)).resolves.toBeNull();
  });

  it("keeps microsecond createdAt ordering in PostgreSQL for image context boundaries", async () => {
    const receivedAt = new Date("2026-08-17T00:00:00.000Z");
    const conversationId = "00000000-0000-0000-0000-000000000002";
    const beforeTextId = "00000000-0000-0000-0000-000000000110";
    const textBoundaryId = "00000000-0000-0000-0000-000000000120";
    const afterTextId = "00000000-0000-0000-0000-000000000130";
    const currentId = "00000000-0000-0000-0000-000000000140";
    const beforeTextAttachmentId = "00000000-0000-0000-0000-000000000201";
    const afterTextAttachmentId = "00000000-0000-0000-0000-000000000203";

    await database.insert(customerServiceConversations).values({
      id: conversationId,
      channel: "facebook",
      externalKeyHash: "h".repeat(64),
    });
    await database.execute(sql`
      insert into customer_service_messages (
        id, conversation_id, channel, external_message_key_hash, body, customer_text, received_at, created_at
      ) values
        (${beforeTextId}, ${conversationId}, 'facebook', ${"i".repeat(64)}, '[Image attachment]', null, ${receivedAt}, '2026-08-17 00:00:01.000001+00'),
        (${textBoundaryId}, ${conversationId}, 'facebook', ${"j".repeat(64)}, 'A new request', 'A new request', ${receivedAt}, '2026-08-17 00:00:01.000002+00'),
        (${afterTextId}, ${conversationId}, 'facebook', ${"k".repeat(64)}, '[Image attachment]', null, ${receivedAt}, '2026-08-17 00:00:01.000003+00'),
        (${currentId}, ${conversationId}, 'facebook', ${"l".repeat(64)}, 'Can you use it?', 'Can you use it?', ${receivedAt}, '2026-08-17 00:00:01.000004+00')
    `);
    await database.insert(customerServiceAttachments).values([
      {
        id: beforeTextAttachmentId,
        messageId: beforeTextId,
        conversationId,
        externalAttachmentKeyHash: "m".repeat(64),
        ordinal: 0,
      },
      {
        id: afterTextAttachmentId,
        messageId: afterTextId,
        conversationId,
        externalAttachmentKeyHash: "n".repeat(64),
        ordinal: 0,
      },
    ]);

    await expect(repository.selectImageContext(currentId)).resolves.toBeNull();
  });

  it("persists exact image analysis inputs and shares budget accounting with draft generation", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: "Can you assess these photos?",
      attachments: [
        { externalAttachmentKeyHash: "c".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null },
        { externalAttachmentKeyHash: "d".repeat(64), ordinal: 1, kind: "image", mimeTypeHint: null },
      ],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).toBe("pilot_complete");
    if (created.status === "duplicate") return;
    const attachments = await database.select({
      id: customerServiceAttachments.id,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    })
      .from(customerServiceAttachments)
      .orderBy(customerServiceAttachments.ordinal);

    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: attachments.map((attachment, ordinal) => ({
        attachmentId: attachment.id,
        ordinal,
        externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
      })),
    });
    const storageKeys = attachments.map((_, index) => (
      `customer-service-attachments/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}.bin`
    ));
    for (const [index, attachment] of attachments.entries()) {
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 100,
        height: 80,
        byteSize: 64,
        sha256: "e".repeat(64),
        privateStorageKey: storageKeys[index],
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      });
    }
    await expect(repository.reserveImageAnalysisAttempt({
      attemptId,
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    })).resolves.toEqual({ status: "reserved" });

    const analysis = {
      schemaVersion: "1" as const,
      overallStatus: "assessed" as const,
      images: attachments.map((_, ordinal) => ({
        ordinal,
        classification: "customer_photo" as const,
        blur: "mild" as const,
        sourceResolutionSignal: "normal" as const,
        subjectScale: "usable" as const,
        crop: "none_visible" as const,
        obstruction: "none_visible" as const,
        screenshotSignal: "none_visible" as const,
        recommendedRole: ordinal === 0 ? "main_candidate" as const : "side_candidate" as const,
        issueCodes: [],
      })),
      comparison: null,
      recommendationCodes: ["use_as_main_candidate" as const],
      safeSummary: "Image 0 is the likely main candidate.",
    };
    await repository.completeImageAnalysisAttempt({
      attemptId,
      status: "analyzed",
      providerCalled: true,
      provider: "mock",
      model: "mock-image",
      analysisResult: analysis,
      validatorCodes: [],
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      estimatedCostMicrousd: 25,
      latencyMs: 5,
    });
    await repository.markImageAttachmentDeleted({
      attemptId,
      attachmentId: attachments[0].id,
      privateStorageKey: storageKeys[0],
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: false,
      failureCode: "image_cleanup_failed",
    });

    const [attempt] = await database.select().from(customerServiceImageAnalysisAttempts)
      .where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    const inputs = await database.select().from(customerServiceImageAnalysisInputs)
      .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attemptId))
      .orderBy(customerServiceImageAnalysisInputs.ordinal);
    const budgets = await database.select().from(customerServiceBudgetState)
      .orderBy(customerServiceBudgetState.scopeKey);
    expect(attempt).toMatchObject({ status: "analyzed", providerCalled: true, estimatedCostMicrousd: 25 });
    expect(inputs.map((item) => item.attachmentId)).toEqual(attachments.map((attachment) => attachment.id));
    expect(inputs[0]).toMatchObject({ cleanupStatus: "failed", privateStorageKey: storageKeys[0] });
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 25 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 25 }),
    ]));
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    });
    for (const [index, attachment] of attachments.entries()) {
      await repository.markImageAttachmentDeleted({
        attemptId,
        attachmentId: attachment.id,
        privateStorageKey: storageKeys[index],
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
        deleted: true,
        failureCode: null,
      });
    }
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: analysis.safeSummary,
      hasUnsupportedAttachments: false,
    });

    const other = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "f".repeat(64),
      externalMessageKeyHash: "1".repeat(64),
      text: "Other customer",
      attachments: [{ externalAttachmentKeyHash: "2".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:01.000Z"),
    });
    expect(other.status).toBe("pilot_complete");
    if (other.status === "duplicate") return;
    const [otherAttachment] = await database.select({
      id: customerServiceAttachments.id,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, other.messageId));
    await expect(repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{
        attachmentId: otherAttachment.id,
        ordinal: 0,
        externalAttachmentKeyHash: otherAttachment.externalAttachmentKeyHash,
      }],
    })).rejects.toThrow("customer_service_image_context_mismatch");
  });

  it("rejects an ephemeral source identity substituted for the selected persisted attachment", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "3".repeat(64),
      externalMessageKeyHash: "4".repeat(64),
      text: "Please assess this image",
      attachments: [{
        externalAttachmentKeyHash: sourceHash("conversation-a-source"),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));

    await expect(repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{
        attachmentId: attachment.id,
        ordinal: 0,
        externalAttachmentKeyHash: sourceHash("conversation-b-source"),
      }],
    })).rejects.toThrow("customer_service_image_context_mismatch");

    expect(await database.select().from(customerServiceImageAnalysisAttempts)).toHaveLength(0);
  });

  it("keeps cleanup proof and storage guards isolated to each overlapping attempt", async () => {
    const externalAttachmentKeyHash = sourceHash("shared-source");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "6".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const attemptInput = {
      messageId: created.messageId,
      schemaVersion: "1" as const,
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    };
    const attemptA = await repository.createImageAnalysisAttempt(attemptInput);
    const attemptB = await repository.createImageAnalysisAttempt(attemptInput);
    const keyA = "customer-service-attachments/00000000-0000-4000-8000-00000000000a.bin";
    const keyB = "customer-service-attachments/00000000-0000-4000-8000-00000000000b.bin";
    for (const [attemptId, privateStorageKey] of [[attemptA, keyA], [attemptB, keyB]] as const) {
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 100,
        height: 80,
        byteSize: 64,
        sha256: "e".repeat(64),
        privateStorageKey,
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      });
    }
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptA, "provider_error"));
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptB, "analyzed"));
    await repository.markImageAttachmentDeleted({
      attemptId: attemptB,
      attachmentId: attachment.id,
      privateStorageKey: keyB,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: false,
      failureCode: "image_cleanup_failed",
    });
    await repository.markImageAttachmentDeleted({
      attemptId: attemptA,
      attachmentId: attachment.id,
      privateStorageKey: keyA,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: true,
      failureCode: null,
    });
    await repository.markImageAttachmentDeleted({
      attemptId: attemptA,
      attachmentId: attachment.id,
      privateStorageKey: keyA,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: false,
      failureCode: "stale_cleanup_failure",
    });

    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: [attachment.id],
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    });
    const lifecycle = await database.execute(sql`
      select analysis_attempt_id, cleanup_status, private_storage_key
      from customer_service_image_analysis_inputs
      order by analysis_attempt_id
    `);
    expect(lifecycle.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        analysis_attempt_id: attemptA,
        cleanup_status: "deleted",
        private_storage_key: null,
      }),
      expect.objectContaining({
        analysis_attempt_id: attemptB,
        cleanup_status: "failed",
        private_storage_key: keyB,
      }),
    ]));
  });

  it("cleans only expired non-deleted attempt-owned image objects and retries failed removals", async () => {
    const externalAttachmentKeyHash = sourceHash("cleanup-source");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "9".repeat(64),
      externalMessageKeyHash: "a".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const oldDueAt = new Date("2026-08-16T00:00:00.000Z");
    const futureDueAt = new Date("2026-08-18T00:00:00.000Z");
    const createStoredAttempt = async (storageKey: string, deleteDueAt: Date) => {
      const attemptId = await repository.createImageAnalysisAttempt({
        messageId: created.messageId,
        schemaVersion: "1",
        attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
      });
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 100,
        height: 80,
        byteSize: 64,
        sha256: "e".repeat(64),
        privateStorageKey: storageKey,
        deleteDueAt,
      });
      return attemptId;
    };
    const successKey = "customer-service-attachments/00000000-0000-4000-8000-00000000000c.bin";
    const retryKey = "customer-service-attachments/00000000-0000-4000-8000-00000000000d.bin";
    const futureKey = "customer-service-attachments/00000000-0000-4000-8000-00000000000e.bin";
    const successAttemptId = await createStoredAttempt(successKey, oldDueAt);
    const retryAttemptId = await createStoredAttempt(retryKey, oldDueAt);
    await createStoredAttempt(futureKey, futureDueAt);
    await repository.completeImageAnalysisAttempt(imageCompletion(successAttemptId, "analyzed"));
    await repository.completeImageAnalysisAttempt(imageCompletion(retryAttemptId, "provider_error"));
    const removed: string[] = [];

    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 100,
      remove: async (storageKey) => {
        removed.push(storageKey);
        if (storageKey === retryKey) throw new Error("blob unavailable");
      },
    })).resolves.toEqual({ selected: 2, deleted: 1, failed: 1 });
    expect(removed).toEqual([successKey, retryKey]);
    const firstPass = await database.select({
      attemptId: customerServiceImageAnalysisInputs.analysisAttemptId,
      cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
      privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
      deleteDueAt: customerServiceImageAnalysisInputs.deleteDueAt,
      failureCode: customerServiceImageAnalysisInputs.failureCode,
    }).from(customerServiceImageAnalysisInputs).orderBy(asc(customerServiceImageAnalysisInputs.analysisAttemptId));
    expect(firstPass).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId: successAttemptId, cleanupStatus: "deleted", privateStorageKey: null, deleteDueAt: null }),
      expect.objectContaining({ attemptId: retryAttemptId, cleanupStatus: "failed", privateStorageKey: retryKey, deleteDueAt: oldDueAt, failureCode: "image_cleanup_failed" }),
      expect.objectContaining({ cleanupStatus: "stored", privateStorageKey: futureKey, deleteDueAt: futureDueAt }),
    ]));

    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 100,
      remove: async (storageKey) => { removed.push(storageKey); },
    })).resolves.toEqual({ selected: 1, deleted: 1, failed: 0 });
    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 100,
      remove: async (storageKey) => { removed.push(storageKey); },
    })).resolves.toEqual({ selected: 0, deleted: 0, failed: 0 });
    await expect(repository.metricCounts()).resolves.toMatchObject({
      providerCalls: 0,
      totalCostMicrousd: 0,
      imageProviderCalls: 2,
      imageInputTokens: 20,
      imageCachedInputTokens: 4,
      imageOutputTokens: 8,
      imageTotalCostMicrousd: 50,
      imageTotalLatencyMs: 10,
      imageFailures: 1,
      imageCleanupDeleted: 2,
      imageCleanupFailures: 0,
    });
  });

  it("owns image reservations on the attempt and makes ambiguous reserve and completion retries idempotent", async () => {
    const externalAttachmentKeyHash = sourceHash("budget-source");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "7".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    const reservation = {
      attemptId,
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    };

    await expect(repository.reserveImageAnalysisAttempt(reservation)).resolves.toEqual({ status: "reserved" });
    await expect(repository.reserveImageAnalysisAttempt(reservation)).resolves.toEqual({ status: "reserved" });
    const persistedReservations = await database.execute(sql`
      select reserved_cost_microusd, budget_daily_scope_key
      from customer_service_image_analysis_attempts
      where id = ${attemptId}
    `);
    expect(persistedReservations.rows[0]).toMatchObject({
      reserved_cost_microusd: "100",
      budget_daily_scope_key: "daily:2026-08-17",
    });

    const completion = imageCompletion(attemptId, "analyzed");
    await expect(repository.completeImageAnalysisAttempt(completion)).resolves.toBeUndefined();
    await expect(repository.completeImageAnalysisAttempt(completion)).resolves.toBeUndefined();
    const budgets = await database.select().from(customerServiceBudgetState)
      .orderBy(customerServiceBudgetState.scopeKey);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 25 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 25 }),
    ]));
    const completedAttempts = await database.execute(sql`
      select reserved_cost_microusd, budget_daily_scope_key
      from customer_service_image_analysis_attempts
      where id = ${attemptId}
    `);
    expect(completedAttempts.rows[0]).toMatchObject({
      reserved_cost_microusd: "0",
      budget_daily_scope_key: "daily:2026-08-17",
    });
  });

  it("charges an unknown text provider result at the reservation ceiling exactly once", async () => {
    await activateFacebookPilot("unknown-text-provider-result");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "9".repeat(64),
      externalMessageKeyHash: "a".repeat(64),
      text: "How should I prepare my photos?",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;

    const reserved = await repository.reserveProviderAttempt({
      messageId: created.messageId,
      trigger: "manual_generate",
      intent: "photo_preparation",
      riskLevel: "low",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeSources: ["AI-SCOPE-05"],
      knowledgeVersion: "test-v1",
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    });
    expect(reserved.status).toBe("reserved");

    const completion = {
      attemptId: reserved.attemptId,
      status: "provider_error" as const,
      provider: "openai" as const,
      model: "test-model",
      validatorCodes: [],
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostMicrousd: null,
      latencyMs: 0,
      providerErrorCode: "provider_request_failed",
      dailyScopeKey: "daily:2026-08-17",
    };
    await Promise.all([
      repository.completeProviderAttempt(completion),
      repository.completeProviderAttempt(completion),
    ]);

    const [attempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, reserved.attemptId));
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(attempt).toMatchObject({
      status: "provider_error",
      providerCalled: true,
      estimatedCostMicrousd: null,
      reservedCostMicrousd: 0,
    });
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 100 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 100 }),
    ]));
  });

  it("keeps a durable provider start while contradictory completions race", async () => {
    const externalAttachmentKeyHash = sourceHash("monotonic-provider-start");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "c".repeat(64),
      externalMessageKeyHash: "d".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await expect(repository.reserveImageAnalysisAttempt({
      attemptId,
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    })).resolves.toEqual({ status: "reserved" });

    const contradictoryCompletion = {
      attemptId,
      status: "provider_error" as const,
      providerCalled: false,
      validatorCodes: [],
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCostMicrousd: null,
      latencyMs: 0,
      providerErrorCode: "contradictory_completion",
    };
    await Promise.all([
      repository.completeImageAnalysisAttempt(contradictoryCompletion),
      repository.completeImageAnalysisAttempt(contradictoryCompletion),
    ]);

    const [attempt] = await database.select().from(customerServiceImageAnalysisAttempts)
      .where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(attempt).toMatchObject({
      status: "provider_error",
      providerCalled: true,
      estimatedCostMicrousd: null,
      reservedCostMicrousd: 0,
    });
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 100 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 100 }),
    ]));
    await repository.completeImageAnalysisAttempt(contradictoryCompletion);
    const budgetsAfterRetry = await database.select().from(customerServiceBudgetState);
    expect(budgetsAfterRetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 100 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 100 }),
    ]));
  });

  it("claims durable image jobs once and advances stages only with the active lease", async () => {
    await activateFacebookPilot("claim-image-job");
    const jobId = "00000000-0000-4000-8000-000000000101";
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "c".repeat(64),
      externalMessageKeyHash: "d".repeat(64),
      text: "Can I use this photo?",
      attachments: [{
        externalAttachmentKeyHash: "e".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).not.toBe("duplicate");
    const claimInput = {
      jobId,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    };

    const claims = await Promise.all([
      repository.claimImageJob(claimInput),
      repository.claimImageJob(claimInput),
    ]);
    const claimed = claims.find((claim) => claim !== null);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claimed).toMatchObject({
      id: jobId,
      stage: "policy",
      hasUnsupportedAttachments: false,
      leaseToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    if (!claimed) return;

    await expect(repository.completeImageJobStage({
      jobId,
      leaseToken: "00000000-0000-4000-8000-000000000999",
      nextStage: "download",
    })).resolves.toBe(false);
    await expect(repository.completeImageJobStage({
      jobId,
      leaseToken: claimed.leaseToken,
      nextStage: "download",
    })).resolves.toBe(true);
    const [persisted] = await database.select().from(customerServiceImageJobs);
    expect(persisted).toMatchObject({
      stage: "download",
      status: "pending",
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });

  it("persists an attempt-owned cleanup key before upload and atomically gates combined image and text cost", async () => {
    await activateFacebookPilot("combined-image-budget");
    const createVisionJob = async (suffix: string, jobId: string) => {
      const externalAttachmentKeyHash = suffix.repeat(64);
      const created = await repository.ingestFacebookMessage({
        channel: "facebook",
        externalConversationKeyHash: suffix.repeat(64),
        externalMessageKeyHash: `${suffix}f`.repeat(32),
        text: "Can I use this photo?",
        attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
        imageJob: {
          id: jobId,
          status: "pending",
          sourceCiphertext: "v1.encrypted",
          sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
          failureCode: null,
        },
        receivedAt: new Date("2026-08-17T00:00:00.000Z"),
      });
      const policy = await repository.claimImageJob({
        jobId,
        now: new Date("2026-08-17T00:00:01.000Z"),
        leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
      });
      if (!policy) throw new Error("missing policy claim");
      await repository.completeImageJobStage({ jobId, leaseToken: policy.leaseToken, nextStage: "download" });
      const download = await repository.claimImageJob({
        jobId,
        now: new Date("2026-08-17T00:00:02.000Z"),
        leaseExpiresAt: new Date("2026-08-17T00:00:27.000Z"),
      });
      if (!download) throw new Error("missing download claim");
      const attempt = await repository.ensureImageAnalysisAttemptForJob({
        jobId,
        leaseToken: download.leaseToken,
        sources: [{
          ordinal: 0,
          externalAttachmentKeyHash,
          sourceRef: { kind: "facebook_remote", url: "https://example.test/private.png" },
        }],
      });
      const privateStorageKey = `customer-service-attachments/${jobId}.bin`;
      await repository.prepareImageAttachmentStorage({
        jobId,
        leaseToken: download.leaseToken,
        attemptId: attempt.attemptId,
        attachmentId: attempt.inputs[0].attachmentId,
        privateStorageKey,
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      });
      const [prepared] = await database.select().from(customerServiceImageAnalysisInputs)
        .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attempt.attemptId));
      expect(prepared).toMatchObject({ cleanupStatus: "pending", privateStorageKey });
      await repository.completeImageJobStage({ jobId, leaseToken: download.leaseToken, nextStage: "vision" });
      const vision = await repository.claimImageJob({
        jobId,
        now: new Date("2026-08-17T00:00:03.000Z"),
        leaseExpiresAt: new Date("2026-08-17T00:00:28.000Z"),
      });
      if (!vision) throw new Error("missing vision claim");
      return { created, vision };
    };
    const first = await createVisionJob("1", "00000000-0000-4000-8000-000000000111");
    const second = await createVisionJob("2", "00000000-0000-4000-8000-000000000222");
    const reservation = (job: NonNullable<typeof first.vision>) => repository.reserveImageJobBudget({
      jobId: job.id,
      leaseToken: job.leaseToken,
      reservationMicrousd: 600,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    });
    const results = await Promise.all([reservation(first.vision), reservation(second.vision)]);
    expect(results.map((result) => result.status).sort()).toEqual(["budget_blocked", "reserved"]);
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 600 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 600 }),
    ]));
  });

  it("releases a stale vision reservation only when the provider did not start", async () => {
    await activateFacebookPilot("stale-vision-job");
    const jobId = "00000000-0000-4000-8000-000000000333";
    const externalAttachmentKeyHash = "3".repeat(64);
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "4".repeat(64),
      externalMessageKeyHash: "5".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [message] = await database.select().from(customerServiceMessages);
    const [attachment] = await database.select().from(customerServiceAttachments);
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: message.id,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await database.update(customerServiceImageJobs).set({
      imageAnalysisAttemptId: attemptId,
      stage: "vision",
      status: "running",
      leaseToken: "00000000-0000-4000-8000-000000000334",
      leaseExpiresAt: new Date("2026-08-16T23:59:00.000Z"),
      reservedCostMicrousd: 2_000,
      budgetDailyScopeKey: "daily:2026-08-17",
    }).where(eq(customerServiceImageJobs.id, jobId));
    await database.insert(customerServiceBudgetState).values([
      { scopeKey: "daily:2026-08-17", reservedMicrousd: 2_000 },
      { scopeKey: "total", reservedMicrousd: 2_000 },
    ]);

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, terminal: 1, reservationsReleased: 1 });
    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 0, reservationsReleased: 0 });
    const [persisted] = await database.select().from(customerServiceImageJobs);
    const [persistedAttempt] = await database.select().from(customerServiceImageAnalysisAttempts)
      .where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    expect(persisted).toMatchObject({
      stage: "cleanup",
      status: "pending",
      terminalAfterCleanup: true,
      failureCode: "image_provider_state_ambiguous",
      reservedCostMicrousd: 0,
      budgetSettledAt: expect.any(Date),
    });
    expect(persistedAttempt).toMatchObject({
      status: "provider_error",
      providerCalled: false,
      providerErrorCode: "image_job_interrupted",
      completedAt: expect.any(Date),
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 0 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 0 }),
    ]));
  });

  it("charges a stale started vision timeout at its combined reservation ceiling exactly once", async () => {
    await activateFacebookPilot("stale-started-vision-job");
    const jobId = "00000000-0000-4000-8000-000000000343";
    const externalAttachmentKeyHash = "d".repeat(64);
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "e".repeat(64),
      externalMessageKeyHash: "f".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [message] = await database.select().from(customerServiceMessages);
    const [attachment] = await database.select().from(customerServiceAttachments);
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: message.id,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await database.update(customerServiceImageAnalysisAttempts).set({
      status: "provider_pending",
      providerCalled: true,
    }).where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    await database.update(customerServiceImageJobs).set({
      imageAnalysisAttemptId: attemptId,
      stage: "vision",
      status: "running",
      leaseToken: "00000000-0000-4000-8000-000000000344",
      leaseExpiresAt: new Date("2026-08-16T23:59:00.000Z"),
      reservedCostMicrousd: 2_000,
      budgetDailyScopeKey: "daily:2026-08-17",
    }).where(eq(customerServiceImageJobs.id, jobId));
    await database.insert(customerServiceBudgetState).values([
      { scopeKey: "daily:2026-08-17", reservedMicrousd: 2_000 },
      { scopeKey: "total", reservedMicrousd: 2_000 },
    ]);

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, terminal: 1, reservationsReleased: 1 });
    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 0, reservationsReleased: 0 });

    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 2_000 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 2_000 }),
    ]));
  });

  it("resumes a stale download with its preallocated cleanup key", async () => {
    await activateFacebookPilot("stale-download-job");
    const jobId = "00000000-0000-4000-8000-000000000441";
    const externalAttachmentKeyHash = "4".repeat(64);
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "6".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const policy = await repository.claimImageJob({
      jobId,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    });
    if (!policy) throw new Error("missing policy claim");
    await repository.completeImageJobStage({ jobId, leaseToken: policy.leaseToken, nextStage: "download" });
    const download = await repository.claimImageJob({
      jobId,
      now: new Date("2026-08-17T00:00:02.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:03.000Z"),
    });
    if (!download) throw new Error("missing download claim");
    const attempt = await repository.ensureImageAnalysisAttemptForJob({
      jobId,
      leaseToken: download.leaseToken,
      sources: [{
        ordinal: 0,
        externalAttachmentKeyHash,
        sourceRef: { kind: "facebook_remote", url: "https://example.test/private.png" },
      }],
    });
    const privateStorageKey = "customer-service-attachments/00000000-0000-4000-8000-000000000442.bin";
    await repository.prepareImageAttachmentStorage({
      jobId,
      leaseToken: download.leaseToken,
      attemptId: attempt.attemptId,
      attachmentId: attempt.inputs[0].attachmentId,
      privateStorageKey,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
    });

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:04.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, resumed: 1, terminal: 0 });

    const [persisted] = await database.select().from(customerServiceImageJobs)
      .where(eq(customerServiceImageJobs.id, jobId));
    const [persistedInput] = await database.select().from(customerServiceImageAnalysisInputs)
      .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attempt.attemptId));
    expect(persisted).toMatchObject({
      stage: "download",
      status: "pending",
      sourceCiphertext: "v1.encrypted",
      terminalAfterCleanup: false,
    });
    expect(persistedInput).toMatchObject({
      cleanupStatus: "pending",
      privateStorageKey,
    });
  });

  it("charges an ambiguous stale draft at its combined reservation ceiling exactly once", async () => {
    await activateFacebookPilot("stale-draft-job");
    const jobId = "00000000-0000-4000-8000-000000000451";
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "7".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash: "9".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    await database.update(customerServiceImageJobs).set({
      stage: "draft",
      status: "running",
      leaseToken: "00000000-0000-4000-8000-000000000452",
      leaseExpiresAt: new Date("2026-08-16T23:59:00.000Z"),
      reservedCostMicrousd: 2_000,
      budgetDailyScopeKey: "daily:2026-08-17",
    }).where(eq(customerServiceImageJobs.id, jobId));
    await database.insert(customerServiceBudgetState).values([
      { scopeKey: "daily:2026-08-17", reservedMicrousd: 2_000 },
      { scopeKey: "total", reservedMicrousd: 2_000 },
    ]);
    const [textAttempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: created.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "photo_guidance",
      riskLevel: "low",
      gateResult: "allowed",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeVersion: "test-v1",
      status: "provider_pending",
      providerCalled: true,
      reservedCostMicrousd: 0,
    }).returning({ id: customerServiceAiAttempts.id });
    await database.update(customerServiceImageJobs).set({ textAttemptId: textAttempt.id })
      .where(eq(customerServiceImageJobs.id, jobId));

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, terminal: 1, reservationsReleased: 1 });
    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 0, reservationsReleased: 0 });

    const [persistedAttempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, textAttempt.id));
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(persistedAttempt).toMatchObject({
      status: "abandoned",
      providerErrorCode: "text_provider_state_ambiguous",
      completedAt: expect.any(Date),
    });
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 2_000 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 2_000 }),
    ]));
  });

  it("charges an image provider error with no durable usage at its combined reservation ceiling", async () => {
    await activateFacebookPilot("unknown-image-provider-result");
    const jobId = "00000000-0000-4000-8000-000000000461";
    const leaseToken = "00000000-0000-4000-8000-000000000462";
    const externalAttachmentKeyHash = "a".repeat(64);
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "b".repeat(64),
      externalMessageKeyHash: "c".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await database.update(customerServiceImageAnalysisAttempts).set({
      status: "provider_error",
      providerCalled: true,
      provider: "mock",
      model: "mock-image",
      providerErrorCode: "image_provider_error",
      completedAt: new Date("2026-08-17T00:00:00.000Z"),
    }).where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    await database.update(customerServiceImageJobs).set({
      imageAnalysisAttemptId: attemptId,
      stage: "cleanup",
      status: "running",
      leaseToken,
      leaseExpiresAt: new Date("2026-08-17T00:00:25.000Z"),
      reservedCostMicrousd: 2_000,
      budgetDailyScopeKey: "daily:2026-08-17",
    }).where(eq(customerServiceImageJobs.id, jobId));
    await database.insert(customerServiceBudgetState).values([
      { scopeKey: "daily:2026-08-17", reservedMicrousd: 2_000 },
      { scopeKey: "total", reservedMicrousd: 2_000 },
    ]);

    await expect(repository.finishImageJob({
      jobId,
      leaseToken,
      status: "human_review_required",
      failureCode: "image_provider_error",
    })).resolves.toBe(true);
    await expect(repository.finishImageJob({
      jobId,
      leaseToken,
      status: "human_review_required",
      failureCode: "image_provider_error",
    })).resolves.toBe(false);

    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 2_000 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 2_000 }),
    ]));
  });

  it("settles separate image and text actuals against one combined reservation exactly once", async () => {
    await activateFacebookPilot("image-text-settlement");
    const jobId = "00000000-0000-4000-8000-000000000551";
    const externalAttachmentKeyHash = "a".repeat(64);
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "b".repeat(64),
      externalMessageKeyHash: "c".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await database.update(customerServiceImageJobs).set({
      stage: "vision",
      status: "running",
      imageAnalysisAttemptId: attemptId,
      leaseToken: "00000000-0000-4000-8000-000000000552",
      leaseExpiresAt: new Date("2026-08-17T00:00:25.000Z"),
    }).where(eq(customerServiceImageJobs.id, jobId));
    const visionLease = "00000000-0000-4000-8000-000000000552";
    await expect(repository.reserveImageJobBudget({
      jobId,
      leaseToken: visionLease,
      reservationMicrousd: 2_000,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 10_000,
    })).resolves.toEqual({ status: "reserved" });
    await expect(repository.markImageAnalysisProviderStarted({ jobId, leaseToken: visionLease, attemptId }))
      .resolves.toBe(true);
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptId, "analyzed"));
    await database.update(customerServiceImageAnalysisAttempts).set({
      analysisResult: {
        ...assessedAnalysis(),
        recommendationCodes: ["send_original_file"],
      },
    }).where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    await repository.completeImageJobStage({ jobId, leaseToken: visionLease, nextStage: "draft" });
    const draftJob = await repository.claimImageJob({
      jobId,
      now: new Date("2026-08-17T00:00:26.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:51.000Z"),
    });
    if (!draftJob) throw new Error("missing draft claim");
    const text = await repository.createImageJobProviderAttempt({
      jobId,
      leaseToken: draftJob.leaseToken,
      messageId: created.messageId,
      trigger: "webhook_after",
      intent: "photo_guidance",
      riskLevel: "low",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeSources: ["AI-SCOPE-05"],
      knowledgeVersion: "test-v1",
    });
    expect(text.status).toBe("reserved");
    await repository.completeProviderAttempt({
      attemptId: text.attemptId,
      status: "draft_ready",
      provider: "mock",
      model: "mock",
      draftText: "Please send the original file so we can assess it.",
      validatorCodes: [],
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      estimatedCostMicrousd: 40,
      latencyMs: 2,
      dailyScopeKey: "daily:2026-08-17",
    });
    await expect(repository.finishImageJob({
      jobId,
      leaseToken: draftJob.leaseToken,
      status: "completed",
      failureCode: null,
      textAttemptId: text.attemptId,
    })).resolves.toBe(true);
    await expect(repository.finishImageJob({
      jobId,
      leaseToken: draftJob.leaseToken,
      status: "completed",
      failureCode: null,
      textAttemptId: text.attemptId,
    })).resolves.toBe(false);
    await repository.appendFeedback({
      attemptId: text.attemptId,
      actorUserId: null,
      action: "accepted_unchanged",
      humanFinalText: "Please send the original file so we can assess it.",
      reasonCode: null,
      idempotencyKey: "image-aware-metric-feedback",
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 65 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 65 }),
    ]));
    let queryCount = 0;
    const countedRepository = createDrizzleCustomerServiceRepository(drizzle(testDatabaseUrl!, {
      logger: { logQuery: () => { queryCount += 1; } },
    }));
    await expect(countedRepository.metricCounts()).resolves.toMatchObject({
      imageContexts: 1,
      imageAnalysesSucceeded: 1,
      imageAnalysesBlocked: 0,
      imageAwareDraftsGenerated: 1,
      imageAwareAcceptedUnchanged: 1,
      imageAwareEditedAccepted: 0,
      imageAwareRejected: 0,
      imageRequestOriginalRecommendations: 1,
      imageAwareTotalCostMicrousd: 65,
    });
    expect(queryCount).toBe(1);
  });

  it("commits cleanup claims before slow deletes so two workers never delete the same key", async () => {
    const externalAttachmentKeyHash = "6".repeat(64);
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "7".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    const keys = [
      "customer-service-attachments/00000000-0000-4000-8000-000000000661.bin",
      "customer-service-attachments/00000000-0000-4000-8000-000000000662.bin",
    ];
    for (const key of keys) {
      const attemptId = await repository.createImageAnalysisAttempt({
        messageId: created.messageId,
        schemaVersion: "1",
        attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
      });
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 10,
        height: 10,
        byteSize: 10,
        sha256: "9".repeat(64),
        privateStorageKey: key,
        deleteDueAt: new Date("2026-08-16T00:00:00.000Z"),
      });
    }
    const removed: string[] = [];
    let releaseDeletes!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseDeletes = resolve; });
    const remove = async (key: string) => { removed.push(key); await blocked; };
    const first = repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 1,
      remove,
    });
    await expect.poll(async () => (
      await database.select().from(customerServiceImageAnalysisInputs)
    ).filter((row) => row.cleanupClaimToken !== null).length).toBe(1);
    const second = repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 2,
      remove,
    });
    await expect.poll(() => removed.length).toBe(2);
    releaseDeletes();
    await expect(Promise.all([first, second])).resolves.toEqual(expect.arrayContaining([
      { selected: 1, deleted: 1, failed: 0 },
    ]));
    expect(new Set(removed).size).toBe(2);
    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
      remove: async (key) => { removed.push(key); },
    })).resolves.toEqual({ selected: 0, deleted: 0, failed: 0 });
  });
});
