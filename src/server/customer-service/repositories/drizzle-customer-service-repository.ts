import { and, asc, desc, eq, lte, max, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  customerServiceAiAttempts,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceFeedbackEvents,
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

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function nextAttemptNumber(transaction: Transaction, messageId: string) {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${messageId}))`);
  const [row] = await transaction.select({ value: max(customerServiceAiAttempts.attemptNumber) })
    .from(customerServiceAiAttempts)
    .where(eq(customerServiceAiAttempts.messageId, messageId));
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

        const inserted = await transaction.insert(customerServiceMessages).values({
          conversationId: conversation.id,
          channel: input.channel,
          externalMessageKeyHash: input.externalMessageKeyHash,
          body: input.text.trim(),
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
      return {
        items: rows.filter((row) => !seen.has(row.messageId) && Boolean(seen.add(row.messageId))).map((row) => ({
          ...row,
          receivedAt: row.receivedAt.toISOString(),
        })),
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
