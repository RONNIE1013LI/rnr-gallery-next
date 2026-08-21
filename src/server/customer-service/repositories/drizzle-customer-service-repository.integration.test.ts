import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
  customerServiceLearningCandidates,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
  customerServiceMessages,
  customerServicePilotRuns,
  customerServiceTurns,
  customerServiceUiChanges,
  customerServiceUiRevision,
  user,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "./drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerServiceRepository(database);
const sourceIdentitySecret = "integration-source-identity-secret";

function sourceHash(value: string) {
  return createHmac("sha256", sourceIdentitySecret).update(value).digest("hex");
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
  await database.delete(customerServiceConversations);
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

describe.runIf(enabled)("DrizzleCustomerServiceRepository", () => {
  beforeEach(clearTables);
  afterAll(clearTables);

  it("claims Facebook profile resolution once and reuses the cached display name", async () => {
    await activateFacebookPilot("profile-cache");
    const incoming = await createRecoveryTurn({
      conversationHash: sourceHash("profile-customer"),
      messageHash: sourceHash("profile-message"),
    });
    expect(incoming.status).toBe("turn_pending");
    const now = new Date("2026-08-21T00:00:00.000Z");
    const leaseExpiresAt = new Date("2026-08-21T00:00:30.000Z");

    const [first, concurrent] = await Promise.all([
      repository.claimFacebookProfileResolution({
        externalConversationKeyHash: sourceHash("profile-customer"),
        now,
        leaseExpiresAt,
      }),
      repository.claimFacebookProfileResolution({
        externalConversationKeyHash: sourceHash("profile-customer"),
        now,
        leaseExpiresAt,
      }),
    ]);
    const claimed = first ?? concurrent;
    expect([first, concurrent].filter(Boolean)).toHaveLength(1);
    expect(claimed).not.toBeNull();
    await expect(repository.completeFacebookProfileResolution({
      conversationId: claimed!.conversationId,
      status: "resolved",
      customerDisplayName: "Tina Stuart",
      resolvedAt: now,
      retryAfter: new Date("2026-09-20T00:00:00.000Z"),
      leaseExpiresAt,
    })).resolves.toBe(true);

    await expect(repository.claimFacebookProfileResolution({
      externalConversationKeyHash: sourceHash("profile-customer"),
      now: new Date("2026-08-22T00:00:00.000Z"),
      leaseExpiresAt: new Date("2026-08-22T00:00:30.000Z"),
    })).resolves.toBeNull();
    if (incoming.status === "turn_pending") {
      await expect(repository.sealDueCustomerTurn({
        turnId: incoming.turnId,
        now: new Date("2026-08-21T00:00:03.000Z"),
      })).resolves.toMatchObject({ status: "sealed" });
    }
    await expect(repository.listQueue(10)).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ customerDisplayName: "Tina Stuart" })],
    }));
  });

  it("keeps concurrent Facebook profile claims isolated by hashed conversation", async () => {
    await activateFacebookPilot("profile-isolation");
    await Promise.all([
      createRecoveryTurn({ conversationHash: sourceHash("customer-a"), messageHash: sourceHash("message-a") }),
      createRecoveryTurn({ conversationHash: sourceHash("customer-b"), messageHash: sourceHash("message-b") }),
    ]);
    const now = new Date("2026-08-21T00:00:00.000Z");
    const leaseExpiresAt = new Date("2026-08-21T00:00:30.000Z");
    const [a, b] = await Promise.all([
      repository.claimFacebookProfileResolution({ externalConversationKeyHash: sourceHash("customer-a"), now, leaseExpiresAt }),
      repository.claimFacebookProfileResolution({ externalConversationKeyHash: sourceHash("customer-b"), now, leaseExpiresAt }),
    ]);

    expect(a?.conversationId).toBeTruthy();
    expect(b?.conversationId).toBeTruthy();
    expect(a?.conversationId).not.toBe(b?.conversationId);
  });

  it("rejects completion from an expired Facebook profile lease", async () => {
    await activateFacebookPilot("profile-stale-lease");
    await createRecoveryTurn({
      conversationHash: sourceHash("stale-profile-customer"),
      messageHash: sourceHash("stale-profile-message"),
    });
    const firstLease = new Date("2026-08-21T00:00:10.000Z");
    const first = await repository.claimFacebookProfileResolution({
      externalConversationKeyHash: sourceHash("stale-profile-customer"),
      now: new Date("2026-08-21T00:00:00.000Z"),
      leaseExpiresAt: firstLease,
    });
    const secondLease = new Date("2026-08-21T00:00:21.000Z");
    const second = await repository.claimFacebookProfileResolution({
      externalConversationKeyHash: sourceHash("stale-profile-customer"),
      now: new Date("2026-08-21T00:00:11.000Z"),
      leaseExpiresAt: secondLease,
    });
    expect(second?.conversationId).toBe(first?.conversationId);

    await expect(repository.completeFacebookProfileResolution({
      conversationId: first!.conversationId,
      status: "resolved",
      customerDisplayName: "Wrong Customer",
      resolvedAt: new Date("2026-08-21T00:00:11.000Z"),
      retryAfter: new Date("2026-09-20T00:00:00.000Z"),
      leaseExpiresAt: firstLease,
    })).resolves.toBe(false);
    await expect(repository.completeFacebookProfileResolution({
      conversationId: second!.conversationId,
      status: "resolved",
      customerDisplayName: "Correct Customer",
      resolvedAt: new Date("2026-08-21T00:00:11.000Z"),
      retryAfter: new Date("2026-09-20T00:00:00.000Z"),
      leaseExpiresAt: secondLease,
    })).resolves.toBe(true);
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
