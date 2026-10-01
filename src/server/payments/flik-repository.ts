import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { flikCheckoutSessions, flikWebhookEvents } from "@/server/db/schema/flik";
import { orders } from "@/server/db/schema/orders";
import { paymentAttempts } from "@/server/db/schema/payments";

export type FlikSessionRecord = typeof flikCheckoutSessions.$inferSelect;
export type FlikSessionSnapshot = Pick<FlikSessionRecord,
  "id" | "paymentAttemptId" | "orderId" | "merchantReference" | "adminUserId" | "testMode" | "market" | "billingCountry" |
  "deliveryCountry" | "currency" | "expectedAmountCents" | "idempotencyKey" | "returnUrl" | "webhookUrl">;
export type FlikWebhookRecord = typeof flikWebhookEvents.$inferSelect;
export type FlikWebhookInput = Pick<FlikWebhookRecord,
  "transactionId" | "payloadSha256" | "checkoutSessionId" | "foreignTransactionId">;
export type FlikSessionBinding = Readonly<{
  id: string; claimId: string; providerReference: string; hostedUrl: string; expiresAt: Date;
}>;
export interface FlikRepository {
  createOrGetSession(input: FlikSessionSnapshot): Promise<FlikSessionRecord>;
  findSession(id: string): Promise<FlikSessionRecord | null>;
  findSessionByProviderReference(reference: string): Promise<FlikSessionRecord | null>;
  claimSessionCreation(id: string): Promise<Readonly<{ session: FlikSessionRecord; claimId: string | null }>>;
  bindSession(input: FlikSessionBinding): Promise<FlikSessionRecord>;
  releaseSessionCreation(id: string, claimId: string): Promise<void>;
  updateVerifiedSession(id: string, providerReference: string, status: string): Promise<FlikSessionRecord>;
  /** Call only after provider API retrieval verified the stored session snapshot. */
  recoverLiveAttemptBinding(id: string): Promise<void>;
  markSessionApplied(id: string, providerReference: string): Promise<void>;
  deferSession(id: string): Promise<void>;
  listPendingSessions(limit: number): Promise<readonly FlikSessionRecord[]>;
  receiveWebhook(input: FlikWebhookInput): Promise<"accepted" | "duplicate" | "conflict">;
  deferWebhook(transactionId: string): Promise<void>;
  listPendingWebhooks(limit: number): Promise<readonly FlikWebhookRecord[]>;
  markWebhookProcessed(transactionId: string): Promise<void>;
}

export class FlikRepositoryConflictError extends Error {
  constructor() { super("Flik session conflicts with its saved payment snapshot"); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["unknown", "created", "pending", "failed", "expired", "completed"]);
const IMMUTABLE_FIELDS = ["id", "paymentAttemptId", "orderId", "merchantReference", "adminUserId", "testMode", "market", "billingCountry", "deliveryCountry", "currency", "expectedAmountCents", "idempotencyKey", "returnUrl", "webhookUrl"] as const;
const CREATION_LEASE_MS = 60_000;
// Flik only guarantees idempotency for 24 hours; never replay creation after that window.
const CREATION_RETRY_WINDOW_MS = 23 * 60 * 60 * 1_000;

export function assertFlikSnapshot(input: FlikSessionSnapshot): void {
  if (!UUID.test(input.id) || input.market !== "NZ" || input.billingCountry !== "NZ" ||
      input.deliveryCountry !== "NZ" || input.currency !== "NZD" ||
      !Number.isSafeInteger(input.expectedAmountCents) || input.expectedAmountCents < 1 || input.expectedAmountCents > 1_000_000 ||
      !input.merchantReference.trim() || !input.idempotencyKey.trim() || !input.returnUrl || !input.webhookUrl ||
      (input.testMode ? input.paymentAttemptId !== null || input.orderId !== null || !input.adminUserId?.trim()
        : input.paymentAttemptId !== input.id || !input.orderId || !UUID.test(input.orderId) || input.adminUserId !== null)) throw new FlikRepositoryConflictError();
}
export function assertMatchingFlikSnapshot(saved: FlikSessionSnapshot, incoming: FlikSessionSnapshot): void {
  if (IMMUTABLE_FIELDS.some((field) => saved[field] !== incoming[field])) throw new FlikRepositoryConflictError();
}
export function nextFlikProviderStatus(current: string, incoming: string): string {
  if (!STATUSES.has(incoming)) throw new FlikRepositoryConflictError();
  return current === "completed" ? current : incoming;
}
function assertLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Flik batch limit must be from 1 to 50");
}

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function databaseNow(transaction: Transaction): Promise<Date> {
  const result = await transaction.execute<{ now: Date }>(sql`select clock_timestamp() as "now"`);
  const now = new Date(result.rows[0].now);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid database clock");
  return now;
}
async function lockSession(transaction: Transaction, id: string): Promise<FlikSessionRecord> {
  const [row] = await transaction.select().from(flikCheckoutSessions).where(eq(flikCheckoutSessions.id, id)).for("update").limit(1);
  if (!row) throw new FlikRepositoryConflictError();
  return row;
}

export function createDrizzleFlikRepository(database: Database): FlikRepository {
  return {
    async createOrGetSession(input) {
      assertFlikSnapshot(input);
      return database.transaction(async (transaction) => {
        await transaction.insert(flikCheckoutSessions).values(input).onConflictDoNothing();
        const row = await lockSession(transaction, input.id);
        assertMatchingFlikSnapshot(row, input);
        return row;
      });
    },
    async findSession(id) {
      const [row] = await database.select().from(flikCheckoutSessions).where(eq(flikCheckoutSessions.id, id)).limit(1);
      return row ?? null;
    },
    async findSessionByProviderReference(reference) {
      const [row] = await database.select().from(flikCheckoutSessions).where(eq(flikCheckoutSessions.providerReference, reference)).limit(1);
      return row ?? null;
    },
    async claimSessionCreation(id) {
      return database.transaction(async (transaction) => {
        const row = await lockSession(transaction, id);
        const now = await databaseNow(transaction);
        if (row.providerReference || row.providerStatus === "completed" || row.providerStatus === "expired" ||
            now.getTime() - row.createdAt.getTime() >= CREATION_RETRY_WINDOW_MS ||
            (row.creationLeaseExpiresAt && row.creationLeaseExpiresAt > now)) return { session: row, claimId: null };
        const claimId = randomUUID();
        const [session] = await transaction.update(flikCheckoutSessions).set({
          creationLeaseId: claimId, creationLeaseExpiresAt: new Date(now.getTime() + CREATION_LEASE_MS), updatedAt: now,
        }).where(eq(flikCheckoutSessions.id, id)).returning();
        return { session, claimId };
      });
    },
    async bindSession(input) {
      return database.transaction(async (transaction) => {
        const row = await lockSession(transaction, input.id);
        if (row.providerReference) {
          if (row.providerReference !== input.providerReference || row.hostedUrl !== input.hostedUrl) throw new FlikRepositoryConflictError();
          return row;
        }
        if (row.creationLeaseId !== input.claimId || !input.providerReference || !input.hostedUrl || !Number.isFinite(input.expiresAt.getTime())) throw new FlikRepositoryConflictError();
        const [updated] = await transaction.update(flikCheckoutSessions).set({
          providerReference: input.providerReference, hostedUrl: input.hostedUrl, expiresAt: input.expiresAt,
          creationLeaseId: null, creationLeaseExpiresAt: null, updatedAt: await databaseNow(transaction),
        }).where(eq(flikCheckoutSessions.id, input.id)).returning();
        return updated;
      });
    },
    async releaseSessionCreation(id, claimId) {
      await database.update(flikCheckoutSessions).set({ creationLeaseId: null, creationLeaseExpiresAt: null, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(flikCheckoutSessions.id, id), eq(flikCheckoutSessions.creationLeaseId, claimId)));
    },
    async updateVerifiedSession(id, providerReference, status) {
      return database.transaction(async (transaction) => {
        const row = await lockSession(transaction, id);
        if (row.providerReference !== providerReference) throw new FlikRepositoryConflictError();
        const [updated] = await transaction.update(flikCheckoutSessions).set({
          providerStatus: nextFlikProviderStatus(row.providerStatus, status), updatedAt: await databaseNow(transaction),
        }).where(eq(flikCheckoutSessions.id, id)).returning();
        return updated;
      });
    },
    async recoverLiveAttemptBinding(id) {
      await database.transaction(async (transaction) => {
        const [hint] = await transaction.select().from(flikCheckoutSessions).where(eq(flikCheckoutSessions.id, id)).limit(1);
        if (!hint || hint.testMode || !hint.orderId || hint.paymentAttemptId !== id) throw new FlikRepositoryConflictError();
        // Match the commerce repository's order -> attempt lock ordering.
        const [order] = await transaction.select().from(orders).where(eq(orders.id, hint.orderId)).for("update").limit(1);
        const [attempt] = await transaction.select().from(paymentAttempts).where(eq(paymentAttempts.id, id)).for("update").limit(1);
        const row = await lockSession(transaction, id);
        assertFlikSnapshot(row);
        if (!order || !attempt || row.testMode || row.orderId !== order.id || row.paymentAttemptId !== attempt.id ||
            attempt.orderId !== order.id || attempt.paymentRequestId !== null || String(attempt.provider) !== "flik" || String(attempt.method) !== "flik" ||
            attempt.expectedAmountCents !== row.expectedAmountCents || order.totalInclGstCents !== row.expectedAmountCents ||
            attempt.currency !== row.currency || order.currency !== row.currency || attempt.country !== "NZ" || order.market !== "NZ" ||
            (order.paymentReference ?? order.orderNumber) !== row.merchantReference || !row.providerReference) throw new FlikRepositoryConflictError();
        const state = new URL(row.returnUrl).searchParams.get("state");
        if (!state || !/^[a-f0-9]{64}$/.test(state)) throw new FlikRepositoryConflictError();
        const digest = createHash("sha256").update(state).digest("hex");
        if (attempt.providerReference === row.providerReference && attempt.returnStateDigest === digest) return;
        if (attempt.providerReference || attempt.returnStateDigest || !["created", "requires_action", "processing"].includes(attempt.status) ||
            ["paid", "refunded"].includes(order.paymentStatus)) throw new FlikRepositoryConflictError();
        await transaction.update(paymentAttempts).set({
          providerReference: row.providerReference, returnStateDigest: digest, status: "requires_action",
          providerSessionLeaseId: null, providerSessionLeaseExpiresAt: null, updatedAt: await databaseNow(transaction),
        }).where(eq(paymentAttempts.id, attempt.id));
      });
    },
    async markSessionApplied(id, providerReference) {
      await database.transaction(async (transaction) => {
        const row = await lockSession(transaction, id);
        if (row.providerReference !== providerReference || !["completed", "expired"].includes(row.providerStatus)) throw new FlikRepositoryConflictError();
        if (row.appliedAt) return;
        await transaction.update(flikCheckoutSessions).set({ appliedAt: await databaseNow(transaction) }).where(eq(flikCheckoutSessions.id, id));
      });
    },
    async deferSession(id) {
      await database.update(flikCheckoutSessions).set({ updatedAt: sql`clock_timestamp()` }).where(eq(flikCheckoutSessions.id, id));
    },
    async listPendingSessions(limit) {
      assertLimit(limit);
      return database.select().from(flikCheckoutSessions).where(isNull(flikCheckoutSessions.appliedAt))
        .orderBy(asc(flikCheckoutSessions.updatedAt), asc(flikCheckoutSessions.id)).limit(limit);
    },
    async receiveWebhook(input) {
      if (!input.transactionId || !/^cs_[A-Za-z0-9_-]+$/.test(input.checkoutSessionId) || !UUID.test(input.foreignTransactionId) ||
          !/^[0-9a-f]{64}$/.test(input.payloadSha256)) throw new FlikRepositoryConflictError();
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`set local statement_timeout = '2000ms'`);
        await transaction.execute(sql`set local lock_timeout = '1000ms'`);
        const inserted = await transaction.insert(flikWebhookEvents).values(input)
          .onConflictDoNothing({ target: flikWebhookEvents.transactionId }).returning();
        if (inserted.length) return "accepted";
        const [row] = await transaction.select().from(flikWebhookEvents).where(eq(flikWebhookEvents.transactionId, input.transactionId)).for("update").limit(1);
        return row && row.payloadSha256 === input.payloadSha256 && row.checkoutSessionId === input.checkoutSessionId && row.foreignTransactionId === input.foreignTransactionId ? "duplicate" : "conflict";
      });
    },
    async deferWebhook(transactionId) {
      await database.update(flikWebhookEvents).set({ updatedAt: sql`clock_timestamp()` })
        .where(and(eq(flikWebhookEvents.transactionId, transactionId), isNull(flikWebhookEvents.processedAt)));
    },
    async listPendingWebhooks(limit) {
      assertLimit(limit);
      return database.select().from(flikWebhookEvents).where(isNull(flikWebhookEvents.processedAt)).orderBy(asc(flikWebhookEvents.updatedAt), asc(flikWebhookEvents.transactionId)).limit(limit);
    },
    async markWebhookProcessed(transactionId) {
      await database.update(flikWebhookEvents).set({ processedAt: sql`clock_timestamp()` })
        .where(and(eq(flikWebhookEvents.transactionId, transactionId), isNull(flikWebhookEvents.processedAt)));
    },
  };
}
