import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import { orders } from "@/server/db/schema/orders";
import { paymentLedgerEntries, paymentAttempts } from "@/server/db/schema/payments";
import { wisePayIdAudit as audit, wisePayIdIntents as intents, wisePayIdPollState as polls, wisePayIdReceipts as receipts } from "@/server/db/schema/wise-payid";
import type { WisePayIdConfig } from "./wise-payid-config";
import { matchWiseCredit, type WiseCredit } from "./wise-payid-matching";

type Database = ReturnType<typeof getDatabase>;
export type WiseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type WiseReceipt = typeof receipts.$inferSelect;
export type WiseIntentRecord = typeof intents.$inferSelect;
export class WiseConflict extends Error { constructor() { super("Wise reconciliation changed or needs review"); } }
export function wiseReference(attemptId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) throw new WiseConflict();
  return `RRA${attemptId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}
const sameAccount = (config: Pick<WisePayIdConfig, "profileId" | "balanceId">) => and(eq(receipts.profileId, config.profileId), eq(receipts.balanceId, config.balanceId));
function credit(row: WiseReceipt): WiseCredit {
  return { transactionId: row.transactionId, amountCents: row.amountCents, currency: row.currency, reference: row.reference,
    payerName: row.payerName, receivedAt: row.receivedAt, eligible: row.eligible, digest: row.digest, isCredit: true };
}
export function createWisePayIdRepository(database: Database, config: Pick<WisePayIdConfig, "profileId" | "balanceId">) {
  return {
    async createIntent(input: { id: string; orderId: string; amountCents: number; merchantReference: string }): Promise<WiseIntentRecord> {
      return database.transaction(async (tx) => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update").limit(1);
        const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, input.id)).for("update").limit(1);
        if (!order || !attempt || order.market !== "AU" || order.currency !== "AUD" || order.totalInclGstCents !== input.amountCents ||
          !["awaiting_payment", "processing"].includes(order.paymentStatus) || attempt.provider !== "wise" || attempt.method !== "payid" ||
          attempt.orderId !== order.id || attempt.paymentRequestId !== null || attempt.country !== "AU" || attempt.currency !== "AUD" ||
          attempt.expectedAmountCents !== input.amountCents || !["created", "requires_action", "processing"].includes(attempt.status) ||
          (order.paymentReference ?? order.orderNumber) !== input.merchantReference) throw new WiseConflict();
        const [inserted] = await tx.insert(intents).values({ ...input, ...config, reference: wiseReference(input.id), currency: "AUD" }).onConflictDoNothing().returning();
        if (inserted) await tx.insert(audit).values({ intentId: input.id, actorId: "system:wise", action: "intent_created", reason: "pending_aud_bank_transfer" });
        const [row] = await tx.select().from(intents).where(eq(intents.id, input.id)).limit(1);
        if (!row || row.orderId !== input.orderId || row.amountCents !== input.amountCents || row.merchantReference !== input.merchantReference ||
          row.profileId !== config.profileId || row.balanceId !== config.balanceId) throw new WiseConflict();
        return row;
      });
    },
    async claimPoll(): Promise<boolean> {
      const key = `${config.profileId}:${config.balanceId}`;
      const result = await database.insert(polls).values({ key, lastStartedAt: sql`clock_timestamp()` }).onConflictDoUpdate({ target: polls.key,
        set: { lastStartedAt: sql`clock_timestamp()` }, where: sql`${polls.lastStartedAt} < clock_timestamp() - interval '1 hour'` }).returning();
      return result.length === 1;
    },
    async finishPoll(success: boolean) {
      await database.transaction(async (tx) => {
        await tx.update(polls).set(success ? { successfulAt: sql`clock_timestamp()`, consecutiveFailures: 0 }
          : { consecutiveFailures: sql`${polls.consecutiveFailures} + 1` }).where(eq(polls.key, `${config.profileId}:${config.balanceId}`));
        await tx.insert(audit).values({ actorId: "system:wise", action: success ? "poll_completed" : "poll_failed", reason: success ? "statement_processed" : "statement_verification_or_application_failed" });
      });
    },
    async hasPending(): Promise<boolean> {
      const rows = await database.select({ id: intents.id }).from(intents).innerJoin(paymentAttempts, eq(paymentAttempts.id, intents.id))
        .where(and(eq(intents.profileId, config.profileId), eq(intents.balanceId, config.balanceId), inArray(paymentAttempts.status, ["created", "requires_action", "processing"]))).limit(1);
      return rows.length > 0;
    },
    async ingest(credits: readonly WiseCredit[]) {
      // Entire response is validated before any receipt can be reserved.
      await database.transaction(async (tx) => {
        for (const row of credits) {
          const transactionId = row.transactionId || `unidentified:${row.digest}`;
          const [inserted] = await tx.insert(receipts).values({ ...config, transactionId, digest: row.digest, amountCents: row.amountCents, currency: row.currency,
            reference: row.reference, payerName: row.payerName, receivedAt: row.receivedAt, eligible: row.eligible,
            status: row.eligible ? "unmatched" : "review", reason: row.eligible ? null : "unsupported_credit" }).onConflictDoNothing().returning();
          if (inserted) await tx.insert(audit).values({ receiptId: inserted.id, actorId: "system:wise", action: "receipt_imported", reason: row.eligible ? "aud_deposit" : "unsupported_credit" });
          const [existing] = await tx.select().from(receipts).where(and(sameAccount(config), eq(receipts.transactionId, transactionId))).for("update").limit(1);
          if (!existing || existing.digest !== row.digest) throw new WiseConflict();
        }
      });
    },
    async holdForReview() {
      await database.transaction(async (tx) => {
        const held = await tx.update(receipts).set({ status: "review", reason: "automatic_confirmation_disabled" })
          .where(and(sameAccount(config), eq(receipts.status, "unmatched"))).returning();
        for (const row of held) await tx.insert(audit).values({ receiptId: row.id, actorId: "system:wise", action: "review_required", reason: "automatic_confirmation_disabled" });
      });
    },
    async candidates(): Promise<readonly WiseReceipt[]> {
      return database.select().from(receipts).where(and(sameAccount(config), inArray(receipts.status, ["unmatched", "reserved"]))).orderBy(asc(receipts.createdAt)).limit(50);
    },
    async reserve(receiptId: string, manual?: { intentId: string; actorId: string; reason: string; expectedDigest: string }): Promise<{ receipt: WiseReceipt; intent: WiseIntentRecord } | null> {
      return database.transaction(async (tx) => {
        // Serialise all assignments on this account, including manual reviews and workers.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wise-payid:${config.profileId}:${config.balanceId}`}, 0))`);
        const [row] = await tx.select().from(receipts).where(and(sameAccount(config), eq(receipts.id, receiptId))).for("update").limit(1);
        if (!row || row.status === "ignored" || row.status === "applied") return null;
        if (row.status === "review" && !manual) return null;
        const rows = await tx.select({ intent: intents, status: paymentAttempts.status, orderStatus: orders.paymentStatus, fulfilmentStatus: orders.fulfilmentStatus, currentAmount: orders.totalInclGstCents }).from(intents)
          .innerJoin(paymentAttempts, eq(paymentAttempts.id, intents.id)).innerJoin(orders, eq(orders.id, intents.orderId))
          .where(and(eq(intents.profileId, config.profileId), eq(intents.balanceId, config.balanceId),
            manual ? eq(intents.id, manual.intentId) : row.intentId ? eq(intents.id, row.intentId) : eq(intents.reference, row.reference ?? "")));
        // Permanently stale authority must not block the remaining account queue.
        const targetOrder = rows[0];
        const existingLedger = targetOrder ? await tx.select({ id: paymentLedgerEntries.id }).from(paymentLedgerEntries)
          .where(eq(paymentLedgerEntries.orderId, targetOrder.intent.orderId)).limit(1) : [];
        if (row.status === "reserved" && (!targetOrder || targetOrder.fulfilmentStatus === "cancelled" ||
          !["awaiting_payment", "processing"].includes(targetOrder.orderStatus) ||
          !["created", "requires_action", "processing"].includes(targetOrder.status) ||
          targetOrder.currentAmount !== targetOrder.intent.amountCents || existingLedger.length > 0)) {
          await tx.update(receipts).set({ status: "review", reason: "order_payment_authority_changed" }).where(eq(receipts.id, row.id));
          await tx.insert(audit).values({ receiptId, intentId: row.intentId, actorId: "system:wise", action: "review_required", reason: "order_payment_authority_changed" });
          return null;
        }
        const snapshots = rows.map(({ intent, status, orderStatus }) => ({ ...intent,
          status: ["awaiting_payment", "processing"].includes(orderStatus) && ["created", "requires_action", "processing"].includes(status) ? "pending" : status }));
        let match = matchWiseCredit(credit(row), snapshots);
        if (manual && (manual.expectedDigest !== row.digest || (row.intentId && row.intentId !== manual.intentId))) throw new WiseConflict();
        if (row.intentId && row.status === "reserved") {
          const saved = rows.find(({ intent }) => intent.id === row.intentId)?.intent;
          if (!saved) throw new WiseConflict();
          return { receipt: row, intent: saved }; // Crash recovery uses only the immutable reservation.
        }
        if (manual) {
          if (!manual.actorId || !manual.reason.trim() || manual.expectedDigest !== row.digest) throw new WiseConflict();
          const target = snapshots.find((i) => i.id === manual.intentId);
          if (!target || target.status !== "pending" || !row.eligible || row.amountCents !== target.amountCents || row.currency !== "AUD" || row.receivedAt < target.createdAt) throw new WiseConflict();
          match = { kind: "matched", intentId: target.id };
        } else if (match.kind === "matched") {
          const duplicates = await tx.select({ id: receipts.id }).from(receipts).where(and(sameAccount(config), eq(receipts.reference, row.reference!)));
          if (duplicates.length !== 1) match = { kind: "review", reason: "duplicate_reference_receipts" };
        }
        if (match.kind === "review") {
          await tx.update(receipts).set({ status: "review", reason: match.reason }).where(eq(receipts.id, row.id));
          await tx.insert(audit).values({ receiptId, actorId: "system:wise", action: "review_required", reason: match.reason });
          return null;
        }
        const intent = rows.find(({ intent }) => intent.id === match.intentId)?.intent;
        if (!intent) throw new WiseConflict();
        const already = await tx.select({ id: receipts.id }).from(receipts).where(eq(receipts.intentId, intent.id)).limit(1);
        if (already.length) {
          await tx.update(receipts).set({ status: "review", reason: "intent_already_has_receipt" }).where(eq(receipts.id, row.id));
          await tx.insert(audit).values({ receiptId, intentId: intent.id, actorId: "system:wise", action: "review_required", reason: "intent_already_has_receipt" });
          return null;
        }
        const [reserved] = await tx.update(receipts).set({ intentId: intent.id, status: "reserved", reason: manual?.reason ?? "exact_reference_amount_currency" }).where(eq(receipts.id, row.id)).returning();
        await tx.insert(audit).values({ receiptId, intentId: intent.id, actorId: manual?.actorId ?? "system:wise", action: manual ? "manual_reservation" : "automatic_reservation", reason: manual?.reason ?? "exact_reference_amount_currency" });
        return { receipt: reserved, intent };
      });
    },
    async reviewQueue() {
      const [queue, pending, history] = await Promise.all([
        database.select().from(receipts).where(and(sameAccount(config), inArray(receipts.status, ["review", "reserved"]))).orderBy(asc(receipts.createdAt)).limit(100),
        database.select({ intent: intents, status: paymentAttempts.status }).from(intents).innerJoin(paymentAttempts, eq(intents.id, paymentAttempts.id))
          .where(and(eq(intents.profileId, config.profileId), eq(intents.balanceId, config.balanceId), inArray(paymentAttempts.status, ["created", "requires_action", "processing"]))).limit(100),
        database.select().from(audit).orderBy(sql`${audit.createdAt} desc`).limit(100),
      ]);
      return { receipts: queue, intents: pending, audit: history };
    },
    async ignore(receiptId: string, actorId: string, reason: string) {
      if (!actorId || !reason.trim()) throw new WiseConflict();
      await database.transaction(async (tx) => {
        const [row] = await tx.select().from(receipts).where(and(sameAccount(config), eq(receipts.id, receiptId))).for("update").limit(1);
        if (!row || row.status !== "review" || row.intentId) throw new WiseConflict();
        await tx.update(receipts).set({ status: "ignored", reason }).where(eq(receipts.id, receiptId));
        await tx.insert(audit).values({ receiptId, actorId, action: "manual_ignore", reason });
      });
    },
  };
}

// Called inside the existing order/attempt/ledger transaction, after its normal order lock.
export async function consumeWiseReceipt(tx: WiseTransaction, attemptId: string, receiptId: string, digest: string,
  expected: { orderId: string; reference: string; merchantReference: string; amountCents: number; requireApplied?: boolean }) {
  const [row] = await tx.select().from(receipts).where(eq(receipts.id, receiptId)).for("update").limit(1);
  const [intent] = await tx.select().from(intents).where(eq(intents.id, attemptId)).limit(1);
  if (!row || !intent || intent.orderId !== expected.orderId || intent.reference !== expected.reference ||
    intent.merchantReference !== expected.merchantReference || intent.amountCents !== expected.amountCents || row.intentId !== attemptId || !row.eligible || row.digest !== digest ||
    row.profileId !== intent.profileId || row.balanceId !== intent.balanceId || row.currency !== "AUD" || row.amountCents !== intent.amountCents ||
    (expected.requireApplied && row.status !== "applied") || !["reserved", "applied"].includes(row.status)) throw new WiseConflict();
  if (row.status === "applied") return;
  await tx.update(receipts).set({ status: "applied", appliedAt: sql`clock_timestamp()` }).where(and(eq(receipts.id, row.id), isNull(receipts.appliedAt)));
  await tx.insert(audit).values({ receiptId: row.id, intentId: intent.id, actorId: "system:wise", action: "payment_applied", reason: "verified_reserved_receipt" });
}
