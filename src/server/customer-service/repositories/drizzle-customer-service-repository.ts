import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, max, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversationEvents,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
  customerServiceMessages,
  customerServicePilotRuns,
  customerServiceTurns,
} from "@/server/db/schema";
import type {
  CustomerServiceRepository,
  FeedbackEventInput,
  GateBlockedAttemptInput,
  HashedIncomingMessage,
  HashedConversationEvent,
  ProviderAttemptCompletion,
  ProviderAttemptReservation,
} from "./customer-service-repository";
import { parseImageAnalysisResult } from "../image-analysis-schema";
import { IMAGE_LIMITS } from "../attachments/limits";

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

  return {
    async ingestConversationEvent(input: HashedConversationEvent) {
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

        const body = input.text?.trim() || "[Image attachment]";
        if (input.role === "staff") {
          const inserted = await transaction.insert(customerServiceConversationEvents).values({
            conversationId: conversation.id,
            channel: input.channel,
            externalMessageKeyHash: input.externalMessageKeyHash,
            role: "staff",
            body,
            receivedAt: input.receivedAt,
          }).onConflictDoNothing().returning({ id: customerServiceConversationEvents.id });
          return inserted.length ? { status: "context_only" as const } : { status: "duplicate" as const };
        }

        const customerText = input.text?.trim() || null;
        const [message] = await transaction.insert(customerServiceMessages).values({
          conversationId: conversation.id,
          channel: input.channel,
          externalMessageKeyHash: input.externalMessageKeyHash,
          body,
          customerText,
          receivedAt: input.receivedAt,
        }).onConflictDoNothing().returning({ id: customerServiceMessages.id });
        if (!message) return { status: "duplicate" as const };

        const debounceUntil = new Date(input.receivedAt.getTime() + 2_000);
        const [turn] = await transaction.insert(customerServiceTurns).values({
          conversationId: conversation.id,
          channel: input.channel,
          representativeMessageId: message.id,
          body,
          debounceUntil,
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
          body,
          receivedAt: input.receivedAt,
        });
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
        }
        return { status: "turn_pending" as const, messageId: message.id, turnId: turn.id, debounceUntil };
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
        conversationId: customerServiceMessages.conversationId,
        receivedAt: customerServiceMessages.receivedAt,
      }).from(customerServiceMessages).where(eq(customerServiceMessages.id, messageId)).limit(1);
      if (!current) return null;
      const context = await database.select({ text: customerServiceMessages.customerText })
        .from(customerServiceMessages)
        .where(and(
          eq(customerServiceMessages.conversationId, current.conversationId),
          lte(customerServiceMessages.receivedAt, current.receivedAt),
          isNotNull(customerServiceMessages.customerText),
        ))
        .orderBy(desc(customerServiceMessages.receivedAt))
        .limit(Math.max(1, Math.min(6, contextLimit)));
      return {
        current: { id: current.id, text: current.text, channel: current.channel },
        context: context.reverse().flatMap((row) => row.text === null ? [] : [row.text]),
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
          await ensureBudgetRows(transaction, [input.dailyScopeKey, "total"].sort());
          const settledCost = input.estimatedCostMicrousd ?? attempt.reserved;
          await transaction.update(customerServiceBudgetState).set({
            reservedMicrousd: sql`greatest(0, ${customerServiceBudgetState.reservedMicrousd} - ${attempt.reserved})`,
            spentMicrousd: sql`${customerServiceBudgetState.spentMicrousd} + ${settledCost}`,
          }).where(sql`${customerServiceBudgetState.scopeKey} in (${input.dailyScopeKey}, 'total')`);
        }
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
      const result = await database.execute(sql`
        select
          (select count(*) from customer_service_messages where pilot_run_id is not null) as total_incoming_eligible,
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
            left join customer_service_ai_attempts text_attempts on text_attempts.id = jobs.text_attempt_id) as image_aware_total_cost_microusd
      `);
      const row = result.rows[0] as Record<string, unknown>;
      const count = (name: string) => Number(row[name] ?? 0);
      return {
        totalIncomingEligible: count("total_incoming_eligible"),
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
      };
    },
  };
}
