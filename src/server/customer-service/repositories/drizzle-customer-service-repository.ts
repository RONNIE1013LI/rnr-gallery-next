import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { getDatabase } from "@/server/db/client";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceMessages,
  customerServicePilotRuns,
} from "@/server/db/schema";
import type {
  CustomerServiceRepository,
  FeedbackEventInput,
  GateBlockedAttemptInput,
  HashedIncomingMessage,
  ProviderAttemptCompletion,
  ProviderAttemptReservation,
} from "./customer-service-repository";
import { parseImageAnalysisResult } from "../image-analysis-schema";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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

export function createDrizzleCustomerServiceRepository(database: Database): CustomerServiceRepository {
  return {
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
            kind: attachment.kind,
            mimeTypeHint: attachment.mimeTypeHint,
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
        return { status: "created" as const, messageId, pilotSequence: pilot.nextSequence };
      });
    },

    async loadDraftInput(messageId, contextLimit) {
      const [current] = await database.select({
        id: customerServiceMessages.id,
        body: customerServiceMessages.body,
        channel: customerServiceMessages.channel,
        conversationId: customerServiceMessages.conversationId,
        receivedAt: customerServiceMessages.receivedAt,
      }).from(customerServiceMessages).where(eq(customerServiceMessages.id, messageId)).limit(1);
      if (!current) return null;
      const context = await database.select({ body: customerServiceMessages.body })
        .from(customerServiceMessages)
        .where(and(
          eq(customerServiceMessages.conversationId, current.conversationId),
          lte(customerServiceMessages.receivedAt, current.receivedAt),
        ))
        .orderBy(desc(customerServiceMessages.receivedAt))
        .limit(Math.max(1, Math.min(6, contextLimit)));
      return {
        current: { id: current.id, body: current.body, channel: current.channel },
        context: context.reverse().map((row) => row.body),
      };
    },

    async selectImageContext(messageId) {
      const [current] = await database.select({
        id: customerServiceMessages.id,
        conversationId: customerServiceMessages.conversationId,
      }).from(customerServiceMessages).where(eq(customerServiceMessages.id, messageId)).limit(1);
      if (!current) return null;

      const ownAttachments = await database.select({ id: customerServiceAttachments.id })
        .from(customerServiceAttachments)
        .where(and(
          eq(customerServiceAttachments.messageId, current.id),
          eq(customerServiceAttachments.conversationId, current.conversationId),
        ))
        .orderBy(asc(customerServiceAttachments.ordinal));
      if (ownAttachments.length) {
        const attachmentIds = ownAttachments.slice(0, 5).map((attachment) => attachment.id);
        return {
          messageId: current.id,
          attachmentIds,
          analysisSummary: await validatedAnalysisSummary(database, current.id, attachmentIds),
        };
      }

      const currentMessage = alias(customerServiceMessages, "current_image_context_message");
      const candidateMessage = alias(customerServiceMessages, "candidate_image_context_message");
      const preceding = await database.select({
        id: candidateMessage.id,
        customerText: candidateMessage.customerText,
      }).from(currentMessage).innerJoin(candidateMessage, and(
        eq(candidateMessage.conversationId, currentMessage.conversationId),
        gte(candidateMessage.receivedAt, sql`${currentMessage.receivedAt} - interval '5 minutes'`),
        sql`(${candidateMessage.receivedAt}, ${candidateMessage.createdAt}, ${candidateMessage.id})
          < (${currentMessage.receivedAt}, ${currentMessage.createdAt}, ${currentMessage.id})`,
      )).where(eq(currentMessage.id, messageId)).orderBy(
        desc(candidateMessage.receivedAt),
        desc(candidateMessage.createdAt),
        desc(candidateMessage.id),
      );
      const attachmentIds: string[] = [];
      for (const message of preceding) {
        if (message.customerText !== null) break;
        const attachments = await database.select({ id: customerServiceAttachments.id })
          .from(customerServiceAttachments)
          .where(and(
            eq(customerServiceAttachments.messageId, message.id),
            eq(customerServiceAttachments.conversationId, current.conversationId),
          ))
          .orderBy(asc(customerServiceAttachments.ordinal))
          .limit(5 - attachmentIds.length);
        attachmentIds.push(...attachments.map((attachment) => attachment.id));
        if (attachmentIds.length === 5) break;
      }
      return attachmentIds.length ? {
        messageId: current.id,
        attachmentIds,
        analysisSummary: await validatedAnalysisSummary(database, current.id, attachmentIds),
      } : null;
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
          reservedCostMicrousd: customerServiceImageAnalysisAttempts.reservedCostMicrousd,
          budgetDailyScopeKey: customerServiceImageAnalysisAttempts.budgetDailyScopeKey,
        })
          .from(customerServiceImageAnalysisAttempts)
          .where(eq(customerServiceImageAnalysisAttempts.id, input.attemptId))
          .limit(1)
          .for("update");
        if (!attempt) throw new Error("customer_service_image_attempt_not_found");
        if (!["pending", "provider_pending"].includes(attempt.status)) return;
        if (attempt.reservedCostMicrousd > 0) {
          if (!attempt.budgetDailyScopeKey) throw new Error("customer_service_image_reservation_invalid");
          await ensureBudgetRows(transaction, [attempt.budgetDailyScopeKey, "total"].sort());
          await transaction.update(customerServiceBudgetState).set({
            reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${attempt.reservedCostMicrousd})`,
            spentMicrousd: sql`${customerServiceBudgetState.spentMicrousd} + ${input.estimatedCostMicrousd}`,
          }).where(sql`${customerServiceBudgetState.scopeKey} in (${attempt.budgetDailyScopeKey}, 'total')`);
        }
        await transaction.update(customerServiceImageAnalysisAttempts).set({
          status: input.status,
          providerCalled: input.providerCalled,
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

    async createGateBlockedAttempt(input) {
      return database.transaction((transaction) => insertGateAttempt(transaction, input));
    },

    async reserveProviderAttempt(input: ProviderAttemptReservation) {
      return database.transaction(async (transaction) => {
        const rows = await ensureBudgetRows(transaction, [input.dailyScopeKey, "total"].sort());
        const daily = rows.find((row) => row.scopeKey === input.dailyScopeKey);
        const total = rows.find((row) => row.scopeKey === "total");
        const blocked = !daily || !total
          || daily.spentMicrousd + daily.reservedMicrousd + input.reservationMicrousd > input.dailyHardStopMicrousd
          || total.spentMicrousd + total.reservedMicrousd + input.reservationMicrousd > input.totalHardStopMicrousd;
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
          reservedCostMicrousd: input.reservationMicrousd,
        }).returning({ id: customerServiceAiAttempts.id });
        return { status: "reserved" as const, attemptId: attempt.id };
      });
    },

    async completeProviderAttempt(input: ProviderAttemptCompletion) {
      await database.transaction(async (transaction) => {
        const [attempt] = await transaction.select({ reserved: customerServiceAiAttempts.reservedCostMicrousd })
          .from(customerServiceAiAttempts)
          .where(eq(customerServiceAiAttempts.id, input.attemptId)).limit(1).for("update");
        if (!attempt) throw new Error("customer_service_attempt_not_found");
        await ensureBudgetRows(transaction, [input.dailyScopeKey, "total"].sort());
        await transaction.update(customerServiceBudgetState).set({
          reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${attempt.reserved})`,
          spentMicrousd: sql`${customerServiceBudgetState.spentMicrousd} + ${input.estimatedCostMicrousd}`,
        }).where(sql`${customerServiceBudgetState.scopeKey} in (${input.dailyScopeKey}, 'total')`);
        await transaction.update(customerServiceAiAttempts).set({
          status: input.status,
          providerCalled: true,
          provider: input.provider,
          model: input.model,
          draftText: input.status === "draft_ready" ? input.draftText : null,
          rejectedOutputHash: input.rejectedOutputHash ?? null,
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
      const rows = await database.select({
        messageId: customerServiceMessages.id,
        body: customerServiceMessages.body,
        receivedAt: customerServiceMessages.receivedAt,
        status: customerServiceMessages.ingestStatus,
        latestAttemptId: customerServiceAiAttempts.id,
        draftText: customerServiceAiAttempts.draftText,
        gateResult: customerServiceAiAttempts.gateResult,
      }).from(customerServiceMessages)
        .leftJoin(customerServiceAiAttempts, eq(customerServiceAiAttempts.messageId, customerServiceMessages.id))
        .orderBy(desc(customerServiceMessages.receivedAt), desc(customerServiceAiAttempts.attemptNumber))
        .limit(Math.max(1, Math.min(100, limit)));
      const seen = new Set<string>();
      const items = rows.filter((row) => !seen.has(row.messageId) && Boolean(seen.add(row.messageId))).map((row) => ({
        ...row,
        receivedAt: row.receivedAt.toISOString(),
      }));
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
      return {
        items: items.map((item) => {
          const attachmentIds = attachmentIdsByMessage.get(item.messageId) ?? [];
          const assessment = assessments.get(item.messageId);
          return {
            ...item,
            attachmentCount: attachmentIds.length,
            imageAnalysisStatus: attachmentIds.length
              ? assessment?.status ?? "human_review_required"
              : "not_applicable",
            imageAssessmentSummary: assessment?.summary ?? null,
          };
        }),
      };
    },

    async metricCounts() {
      const [messages, attempts, feedback] = await Promise.all([
        database.select({ id: customerServiceMessages.id, pilotRunId: customerServiceMessages.pilotRunId }).from(customerServiceMessages),
        database.select({
          id: customerServiceAiAttempts.id,
          status: customerServiceAiAttempts.status,
          providerCalled: customerServiceAiAttempts.providerCalled,
          validatorCodes: customerServiceAiAttempts.validatorCodes,
          cost: customerServiceAiAttempts.estimatedCostMicrousd,
          latency: customerServiceAiAttempts.latencyMs,
        }).from(customerServiceAiAttempts),
        database.select({ action: customerServiceFeedbackEvents.action }).from(customerServiceFeedbackEvents),
      ]);
      const generated = attempts.filter((attempt) => attempt.status === "draft_ready");
      const policyCodes = new Set(["forbidden_commitment", "monetary_claim", "unconfirmed_policy_claim"]);
      return {
        totalIncomingEligible: messages.filter((message) => message.pilotRunId !== null).length,
        draftsGenerated: generated.length,
        acceptedUnchanged: feedback.filter((event) => event.action === "accepted_unchanged").length,
        editedAccepted: feedback.filter((event) => event.action === "edited").length,
        rejected: feedback.filter((event) => event.action === "rejected").length,
        gateBlocked: attempts.filter((attempt) => attempt.status === "gate_blocked").length,
        outputValidatorBlocked: attempts.filter((attempt) => attempt.status === "output_blocked").length,
        providerCalls: attempts.filter((attempt) => attempt.providerCalled).length,
        policyViolationAttempts: attempts.filter((attempt) => attempt.validatorCodes.some((code) => policyCodes.has(code))).length,
        totalCostMicrousd: attempts.reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0),
        totalLatencyMs: attempts.reduce((sum, attempt) => sum + (attempt.latency ?? 0), 0),
      };
    },
  };
}
