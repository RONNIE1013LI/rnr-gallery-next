import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceCaseMemories,
  customerServiceCaseRetrievals,
  customerServiceConversationEvents,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceHumanReplyMatches,
  customerServiceHumanReplyMatchEvents,
  customerServiceLearningCandidates,
  customerServiceMessages,
  customerServiceTurns,
  customerServiceUiChanges,
  customerServiceUiRevision,
  user,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import {
  buildLearningCandidateEvidenceSignature,
  getLearningPatternDefinition,
} from "../learning/learning-candidate";
import { createDrizzleCustomerServiceRepository } from "./drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerServiceRepository(database, {
  reviewSelectorSecret: "learning-candidate-integration-secret-at-least-32-bytes",
});
const reviewerId = "learning-candidate-integration-reviewer";
type PatternEvidenceInput = Readonly<{
  intent: string;
  situation: string;
  aiDraft: string;
  humanFinal: string;
}>;
const designPatternEvidence: PatternEvidenceInput = Object.freeze({
  intent: "design_process",
  situation: "Customer asks how the design process starts.",
  aiDraft: "A short unrelated draft.",
  humanFinal: "Please send your photos, wording and theme so we can prepare your draft.",
});
let patternEvidenceBatch = 0;

async function clearLearningFixtures() {
  await database.delete(customerServiceLearningCandidates);
  await database.delete(customerServiceCaseRetrievals);
  await database.delete(customerServiceCaseMemories);
  await database.delete(customerServiceHumanReplyMatchEvents);
  await database.delete(customerServiceHumanReplyMatches);
  await database.delete(customerServiceFeedbackEvents);
  await database.delete(customerServiceConversationEvents);
  await database.delete(customerServiceAiAttempts);
  await database.delete(customerServiceTurns);
  await database.delete(customerServiceMessages);
  await database.delete(customerServiceConversations);
  await database.delete(customerServiceUiChanges);
  await database.update(customerServiceUiRevision).set({ revision: 0 });
}

async function createPatternEvidence(input: PatternEvidenceInput = designPatternEvidence, count = 3) {
  patternEvidenceBatch += 1;
  for (let index = 0; index < count; index += 1) {
    const suffix = `${index + 1}`.padStart(2, "0");
    const [conversation] = await database.insert(customerServiceConversations).values({
      channel: "facebook",
      externalKeyHash: createHash("sha256").update(`learning-conversation-${patternEvidenceBatch}-${suffix}`).digest("hex"),
    }).returning({ id: customerServiceConversations.id });
    const [message] = await database.insert(customerServiceMessages).values({
      conversationId: conversation.id,
      channel: "facebook",
      externalMessageKeyHash: createHash("sha256").update(`learning-message-${patternEvidenceBatch}-${suffix}`).digest("hex"),
      body: input.situation,
      customerText: input.situation,
      receivedAt: new Date(`2026-08-18T00:0${index}:00.000Z`),
      ingestStatus: "draft_ready",
    }).returning({ id: customerServiceMessages.id });
    const [turn] = await database.insert(customerServiceTurns).values({
      conversationId: conversation.id,
      channel: "facebook",
      representativeMessageId: message.id,
      body: input.situation,
      status: "pilot_complete",
      debounceUntil: new Date(`2026-08-18T00:0${index}:00.000Z`),
      openedAt: new Date(`2026-08-18T00:0${index}:00.000Z`),
      lastEventAt: new Date(`2026-08-18T00:0${index}:00.000Z`),
      sealedAt: new Date(`2026-08-18T00:0${index}:01.000Z`),
      processingStatus: "completed",
      nextRunAt: new Date(`2026-08-18T00:0${index}:00.000Z`),
      processingCompletedAt: new Date(`2026-08-18T00:0${index}:04.000Z`),
    }).returning({ id: customerServiceTurns.id });
    const [attempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: message.id,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: input.intent,
      riskLevel: "low",
      gateResult: "allowed",
      knowledgeVersion: "test",
      knowledgeSources: ["DESIGN-01"],
      status: "draft_ready",
      providerCalled: true,
      provider: "mock",
      model: "mock",
      draftText: input.aiDraft,
      completedAt: new Date(`2026-08-18T00:0${index}:04.000Z`),
    }).returning({ id: customerServiceAiAttempts.id });
    const [match] = await database.insert(customerServiceHumanReplyMatches).values({
      conversationId: conversation.id,
      status: "matched",
      firstOutboundAt: new Date(`2026-08-18T00:0${index}:05.000Z`),
      lastOutboundAt: new Date(`2026-08-18T00:0${index}:05.000Z`),
      turnId: turn.id,
      aiAttemptId: attempt.id,
      humanFinalText: input.humanFinal,
      contextSummary: input.situation,
      matchMethod: "reply_to",
      confidence: "high",
      matchScore: 100,
      editClassification: "ai_ignored",
      similarityScore: 0,
      editReasonCodes: ["independent_human_reply"],
      intent: input.intent,
      riskClass: "low",
    }).returning({ id: customerServiceHumanReplyMatches.id });
    await database.insert(customerServiceCaseMemories).values({
      humanReplyMatchId: match.id,
      intent: input.intent,
      normalizedSituation: input.situation,
      customerTurnSummary: input.situation,
      contextSummary: input.situation,
      aiDraft: input.aiDraft,
      humanFinalReply: input.humanFinal,
      editClassification: "ai_ignored",
      editReasonCodes: ["independent_human_reply"],
      market: "unknown",
      knowledgeVersion: "test",
      riskClass: "low",
      eligibilityStatus: "approved_reusable",
      sourceConfidence: "high",
      decidedAt: new Date(`2026-08-18T00:0${index}:06.000Z`),
    });
  }
  await repository.refreshLearningCandidates({ minimumMatchedReplies: 3 });
  const [candidate] = await database.select().from(customerServiceLearningCandidates);
  if (!candidate) throw new Error("expected learning candidate");
  return candidate;
}

describe.runIf(enabled)("learning candidate repository", () => {
  beforeAll(async () => {
    await database.insert(customerServiceUiRevision).values({ singleton: 1, revision: 0 }).onConflictDoNothing();
    await database.insert(user).values({
      id: reviewerId,
      name: "Learning Candidate Reviewer",
      email: "learning-candidate-reviewer@example.test",
      role: "admin",
    }).onConflictDoNothing();
  });

  beforeEach(clearLearningFixtures);

  afterAll(async () => {
    await clearLearningFixtures();
    await database.delete(user).where(eq(user.id, reviewerId));
  });

  it("creates one semantic candidate, merges a later refresh, and returns bounded supporting evidence", async () => {
    const candidate = await createPatternEvidence(designPatternEvidence, 6);
    await expect(repository.refreshLearningCandidates({ minimumMatchedReplies: 3 }))
      .resolves.toEqual({ checkpoint: 6, created: 0 });
    expect(await database.select().from(customerServiceLearningCandidates)).toHaveLength(1);
    expect(await repository.listLearningCandidates(10)).toEqual({
      items: [expect.objectContaining({
        id: candidate.id,
        observedPattern: expect.stringContaining("photos, wording"),
        proposedChange: expect.stringContaining("photos, wording"),
        evidenceCount: 6,
        supportingCases: expect.arrayContaining([expect.objectContaining({
          customer: "Customer asks how the design process starts.",
          aiDraft: "A short unrelated draft.",
          humanFinal: "Please send your photos, wording and theme so we can prepare your draft.",
          detectedChange: expect.stringContaining("design inputs"),
        })]),
      })],
    });
    expect((await repository.listLearningCandidates(10)).items[0]?.supportingCases).toHaveLength(5);
  });

  it("stores the exact proposed guidance for Approve", async () => {
    const candidate = await createPatternEvidence();
    await repository.decideLearningCandidate({
      candidateId: candidate.id, reviewerUserId: reviewerId, action: "approve",
      approvedText: null, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
    });
    const [row] = await database.select().from(customerServiceLearningCandidates);
    expect(row).toMatchObject({ status: "approved", approvedText: candidate.proposedChange });
  });

  it("stores edited guidance for Edit and Approve and no guidance for Reject", async () => {
    const edited = "Collect photos, wording and theme only when those design inputs are still missing.";
    const first = await createPatternEvidence();
    await repository.decideLearningCandidate({
      candidateId: first.id, reviewerUserId: reviewerId, action: "edit_and_approve",
      approvedText: edited, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
    });
    expect((await database.select().from(customerServiceLearningCandidates))[0])
      .toMatchObject({ status: "approved", approvedText: edited });

    await clearLearningFixtures();
    const second = await createPatternEvidence();
    await repository.decideLearningCandidate({
      candidateId: second.id, reviewerUserId: reviewerId, action: "reject",
      approvedText: null, reason: "Not reusable", now: new Date("2026-08-18T00:10:00.000Z"),
    });
    expect((await database.select().from(customerServiceLearningCandidates))[0])
      .toMatchObject({ status: "rejected", approvedText: null });
  });

  it("hides placeholder candidates from list and count and blocks direct approval", async () => {
    const valid = await createPatternEvidence();
    const [placeholder] = await database.insert(customerServiceLearningCandidates).values({
      candidateKind: "answer_quality_rule",
      intent: "design_process",
      proposedChange: "Review this repeated edit pattern before changing the approved guidance.",
      evidenceCount: valid.evidenceCount,
      distinctCaseCount: valid.distinctCaseCount,
      reasonCodes: ["independent_human_reply"],
      sourceCaseMemoryIds: valid.sourceCaseMemoryIds,
      evidenceSignature: createHash("sha256").update("legacy-placeholder-candidate").digest("hex"),
      status: "pending",
    }).returning();
    expect((await repository.listLearningCandidates(10)).items.map((item) => item.id)).toEqual([valid.id]);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(1);
    await expect(repository.decideLearningCandidate({
      candidateId: placeholder.id, reviewerUserId: reviewerId, action: "approve",
      approvedText: null, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
    })).rejects.toThrow("customer_service_learning_candidate_invalid");
  });

  it("blocks a recognized proposal when its supporting cases describe a different pattern", async () => {
    const valid = await createPatternEvidence();
    const quotePattern = getLearningPatternDefinition("quote_ask_next_missing_detail");
    if (!quotePattern) throw new Error("expected quote pattern");
    const [mismatched] = await database.insert(customerServiceLearningCandidates).values({
      candidateKind: "answer_quality_rule",
      intent: "quote_information_collection",
      proposedChange: quotePattern.proposedGuidance,
      evidenceCount: valid.evidenceCount,
      distinctCaseCount: valid.distinctCaseCount,
      reasonCodes: ["quote_ask_next_missing_detail"],
      sourceCaseMemoryIds: valid.sourceCaseMemoryIds,
      evidenceSignature: buildLearningCandidateEvidenceSignature({
        candidateKind: "answer_quality_rule",
        intent: "quote_information_collection",
        reasonCode: "quote_ask_next_missing_detail",
        proposedChange: quotePattern.proposedGuidance,
      }),
      status: "pending",
    }).returning();
    expect((await repository.listLearningCandidates(10)).items.map((item) => item.id)).toEqual([valid.id]);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(1);
    await expect(repository.decideLearningCandidate({
      candidateId: mismatched.id, reviewerUserId: reviewerId, action: "approve",
      approvedText: null, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
    })).rejects.toThrow("customer_service_learning_candidate_invalid");
  });

  it("excludes tampered signatures and wrong candidate kinds from list, count and approval", async () => {
    const valid = await createPatternEvidence();
    const definition = getLearningPatternDefinition("design_collect_photos_wording_theme");
    if (!definition) throw new Error("expected design pattern");
    const [tampered] = await database.insert(customerServiceLearningCandidates).values({
      candidateKind: "answer_quality_rule",
      intent: "design_process",
      proposedChange: definition.proposedGuidance,
      evidenceCount: valid.evidenceCount,
      distinctCaseCount: valid.distinctCaseCount,
      reasonCodes: ["design_collect_photos_wording_theme"],
      sourceCaseMemoryIds: valid.sourceCaseMemoryIds,
      evidenceSignature: "0".repeat(64),
      status: "pending",
    }).returning();
    const [wrongKind] = await database.insert(customerServiceLearningCandidates).values({
      candidateKind: "knowledge_change",
      intent: "design_process",
      proposedChange: definition.proposedGuidance,
      evidenceCount: valid.evidenceCount,
      distinctCaseCount: valid.distinctCaseCount,
      reasonCodes: ["design_collect_photos_wording_theme"],
      sourceCaseMemoryIds: valid.sourceCaseMemoryIds,
      evidenceSignature: buildLearningCandidateEvidenceSignature({
        candidateKind: "knowledge_change",
        intent: "design_process",
        reasonCode: "design_collect_photos_wording_theme",
        proposedChange: definition.proposedGuidance,
      }),
      status: "pending",
    }).returning();

    expect((await repository.listLearningCandidates(10)).items.map((item) => item.id)).toEqual([valid.id]);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(1);
    for (const candidate of [tampered, wrongKind]) {
      await expect(repository.decideLearningCandidate({
        candidateId: candidate.id, reviewerUserId: reviewerId, action: "approve",
        approvedText: null, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
      })).rejects.toThrow("customer_service_learning_candidate_invalid");
    }
  });

  it("rejects sensitive, realtime and automatic-action edited guidance", async () => {
    const candidate = await createPatternEvidence();
    for (const approvedText of [
      "Hi Tina, collect the photos and wording for this customer.",
      "Email the customer at tina@example.test when the design is ready.",
      "Promise a refund when the customer asks to cancel an order.",
      "Use the current shipping price of NZ$25 for this repeated case.",
      "Automatically send this reply when the same request appears.",
      "Send this reply automatically when the same request appears.",
      "Send this reply without human review when the request appears.",
      "Reply directly to the customer whenever this pattern appears.",
    ]) {
      await expect(repository.decideLearningCandidate({
        candidateId: candidate.id, reviewerUserId: reviewerId, action: "edit_and_approve",
        approvedText, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
      })).rejects.toThrow("customer_service_learning_candidate_invalid");
    }
    expect((await database.select().from(customerServiceLearningCandidates))[0]?.status).toBe("pending");
  });

  it("does not let more than 100 newer invalid rows hide an older valid candidate", async () => {
    const valid = await createPatternEvidence();
    await database.insert(customerServiceLearningCandidates).values(Array.from({ length: 101 }, (_, index) => ({
      candidateKind: "answer_quality_rule" as const,
      intent: "design_process",
      proposedChange: "Review this repeated edit pattern before changing the approved guidance.",
      evidenceCount: valid.evidenceCount,
      distinctCaseCount: valid.distinctCaseCount,
      reasonCodes: ["independent_human_reply"],
      sourceCaseMemoryIds: valid.sourceCaseMemoryIds,
      evidenceSignature: createHash("sha256").update(`legacy-placeholder-${index}`).digest("hex"),
      status: "pending" as const,
      createdAt: new Date(1_777_000_000_000 + index * 1_000),
    })));
    expect((await repository.listLearningCandidates(10)).items.map((item) => item.id)).toEqual([valid.id]);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(1);
  });

  it("does not count a candidate whose evidence list repeats a case ID", async () => {
    const candidate = await createPatternEvidence();
    const sourceIds = [...candidate.sourceCaseMemoryIds];
    await database.update(customerServiceLearningCandidates).set({
      sourceCaseMemoryIds: [sourceIds[0], sourceIds[0], sourceIds[1], sourceIds[2]],
      evidenceCount: 4,
      distinctCaseCount: 3,
    }).where(eq(customerServiceLearningCandidates.id, candidate.id));

    expect((await repository.listLearningCandidates(10)).items).toEqual([]);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(0);
  });

  it("prioritizes pending review candidates over newer completed history", async () => {
    const design = await createPatternEvidence(designPatternEvidence);
    await createPatternEvidence({
      intent: "quote_information_collection",
      situation: "Customer asks for a banner price.",
      aiDraft: "Please send every quote detail.",
      humanFinal: "Is this for NZ or Australia, and do you need a roll-up or wall-hanging banner?",
    });
    const candidates = await database.select().from(customerServiceLearningCandidates);
    const quote = candidates.find((item) => item.reasonCodes.includes("quote_confirm_market_and_banner_format"));
    if (!quote) throw new Error("expected pending quote candidate");
    await database.update(customerServiceLearningCandidates).set({
      status: "approved",
      approvedText: design.proposedChange,
      reviewerUserId: reviewerId,
      decidedAt: new Date("2026-08-18T01:00:00.000Z"),
      createdAt: new Date("2099-01-01T00:00:00.000Z"),
    }).where(eq(customerServiceLearningCandidates.id, design.id));

    expect((await repository.listLearningCandidates(1)).items.map((item) => item.id)).toEqual([quote.id]);
  });

  it("excludes approved medium-risk Case Memory from generation, list, count and approval", async () => {
    const candidate = await createPatternEvidence();
    await database.update(customerServiceCaseMemories).set({ riskClass: "medium" });

    expect((await repository.listLearningCandidates(10)).items).toEqual([]);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(0);
    await expect(repository.decideLearningCandidate({
      candidateId: candidate.id, reviewerUserId: reviewerId, action: "approve",
      approvedText: null, reason: null, now: new Date("2026-08-18T00:10:00.000Z"),
    })).rejects.toThrow("customer_service_learning_candidate_invalid");

    await database.delete(customerServiceLearningCandidates);
    await expect(repository.refreshLearningCandidates({ minimumMatchedReplies: 3 }))
      .resolves.toEqual({ checkpoint: 3, created: 0 });
  });

  it.each([
    ["design inputs", designPatternEvidence],
    ["quote market and format", {
      intent: "quote_information_collection",
      situation: "Customer asks for a banner price.",
      aiDraft: "Please send every quote detail.",
      humanFinal: "Is this for NZ or Australia, and do you need a roll-up or wall-hanging banner?",
    }],
    ["next quote detail", {
      intent: "quote_information_collection",
      situation: "Customer already supplied the product type.",
      aiDraft: "Please send the product, size, photos and required date.",
      humanFinal: "What size do you need?",
    }],
    ["concise acknowledgement", {
      intent: "tone_adjustment",
      situation: "Customer thanks the team.",
      aiDraft: "Thank you for your message. Would you like to provide any more information for us today?",
      humanFinal: "You're welcome!",
    }],
    ["unicode punctuation acknowledgement", {
      intent: "tone_adjustment",
      situation: "Customer thanks the team.",
      aiDraft: "Thank you for your message. Would you like to provide any more information for us today?",
      humanFinal: "You’re welcome!",
    }],
  ])("keeps SQL pending metrics and TypeScript evidence validation aligned for %s", async (_label, evidence) => {
    await createPatternEvidence(evidence);
    expect((await repository.listLearningCandidates(10)).items).toHaveLength(1);
    expect((await repository.metricCounts()).learningCandidatesPending).toBe(1);
  });
});
