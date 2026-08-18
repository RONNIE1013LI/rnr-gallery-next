import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { getDatabase } from "@/server/db/client";
import {
  orders,
  paymentAttempts,
  paymentLedgerEntries,
  paymentRequests,
} from "@/server/db/schema";
import type {
  OrderPaymentStatus,
  PaymentAttemptStatus,
} from "@/server/db/schema";
import { deriveProviderIdempotencyKey } from "@/server/payments/drizzle-payment-repository";
import { calculateLedgerBalance, validateLedgerReversal } from "./ledger";
import type {
  CreatePaymentRequestRecordInput,
  OrderPaymentSummary,
  PaymentLedgerEntryRecord,
  PaymentRequestRecord,
  PaymentRequestRepository,
  RequestAttemptClaim,
} from "./payment-request-repository";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OrderRow = typeof orders.$inferSelect;
type RequestRow = typeof paymentRequests.$inferSelect;
type LedgerRow = typeof paymentLedgerEntries.$inferSelect;
type AttemptRow = typeof paymentAttempts.$inferSelect;

const nonterminalAttempts: PaymentAttemptStatus[] = [
  "created",
  "requires_action",
  "processing",
];
const protectedOrderStatuses: OrderPaymentStatus[] = ["cancelled", "refunded"];

export class PaymentRequestConflictError extends Error {
  constructor(message = "Payment request conflicts with the current balance") {
    super(message);
    this.name = "PaymentRequestConflictError";
  }
}

export class PaymentRequestNotFoundError extends Error {
  constructor() {
    super("Payment request is unavailable");
    this.name = "PaymentRequestNotFoundError";
  }
}

function requestRecord(row: RequestRow, orderNumber: string | null): PaymentRequestRecord {
  return Object.freeze({
    id: row.id,
    requestNumber: row.requestNumber,
    publicTokenDigest: row.publicTokenDigest,
    kind: row.kind,
    orderId: row.orderId,
    orderNumber,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    description: row.description,
    currency: row.currency,
    amountCents: row.amountCents,
    enabledPaymentMethods: Object.freeze([...row.enabledPaymentMethods]),
    status: row.status,
    statusReason: row.statusReason,
    expiresAt: row.expiresAt,
    internalNote: row.internalNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function ledgerRecord(row: LedgerRow): PaymentLedgerEntryRecord {
  return Object.freeze({
    id: row.id,
    orderId: row.orderId,
    paymentRequestId: row.paymentRequestId,
    paymentAttemptId: row.paymentAttemptId,
    entryType: row.entryType,
    direction: row.direction,
    amountCents: row.amountCents,
    currency: row.currency,
    receivedAt: row.receivedAt,
    reference: row.reference,
    payerName: row.payerName,
    note: row.note,
    reversesEntryId: row.reversesEntryId,
    createdAt: row.createdAt,
  });
}

async function databaseNow(transaction: Transaction): Promise<Date> {
  const result = await transaction.execute<{ now: Date }>(
    sql`select clock_timestamp() as now`,
  );
  const value = result.rows[0]?.now;
  if (!value) throw new PaymentRequestConflictError();
  return new Date(value);
}

async function lockOrder(transaction: Transaction, orderId: string): Promise<OrderRow> {
  const [order] = await transaction.select().from(orders)
    .where(eq(orders.id, orderId)).for("update").limit(1);
  if (!order || protectedOrderStatuses.includes(order.paymentStatus)) {
    throw new PaymentRequestConflictError("Order cannot accept payment");
  }
  return order;
}

async function expireStaleRequests(
  transaction: Transaction,
  now: Date,
  orderId?: string,
) {
  await transaction.execute(sql`
    update ${paymentRequests} as request
    set status = 'expired', status_reason = 'expired', updated_at = ${now}
    where request.status = 'pending'
      and request.expires_at is not null
      and request.expires_at <= ${now}
      ${orderId ? sql`and request.order_id = ${orderId}` : sql``}
      and not exists (
        select 1 from ${paymentAttempts} as attempt
        where attempt.payment_request_id = request.id
          and attempt.status in ('created', 'requires_action', 'processing')
      )
  `);
}

async function ledgerRowsForOrder(transaction: Transaction, orderId: string) {
  return transaction.select().from(paymentLedgerEntries)
    .where(eq(paymentLedgerEntries.orderId, orderId))
    .orderBy(asc(paymentLedgerEntries.receivedAt), asc(paymentLedgerEntries.id));
}

async function orderBalance(transaction: Transaction, order: OrderRow) {
  const ledger = await ledgerRowsForOrder(transaction, order.id);
  return {
    ledger,
    ...calculateLedgerBalance(order.totalInclGstCents, ledger),
  };
}

async function activeRequestAttemptIds(transaction: Transaction, orderId: string) {
  const rows = await transaction.select({ requestId: paymentAttempts.paymentRequestId })
    .from(paymentAttempts)
    .innerJoin(paymentRequests, eq(paymentRequests.id, paymentAttempts.paymentRequestId))
    .where(and(
      eq(paymentRequests.orderId, orderId),
      inArray(paymentAttempts.status, nonterminalAttempts),
    ));
  return new Set(rows.flatMap(({ requestId }) => requestId ? [requestId] : []));
}

async function directAttemptReservation(transaction: Transaction, orderId: string) {
  const rows = await transaction.select({ amountCents: paymentAttempts.expectedAmountCents })
    .from(paymentAttempts)
    .where(and(
      eq(paymentAttempts.orderId, orderId),
      isNull(paymentAttempts.paymentRequestId),
      inArray(paymentAttempts.status, nonterminalAttempts),
    ));
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

async function reconcileOrderRequests(
  transaction: Transaction,
  order: OrderRow,
  now: Date,
) {
  await expireStaleRequests(transaction, now, order.id);
  const { outstandingCents } = await orderBalance(transaction, order);
  const pending = await transaction.select().from(paymentRequests)
    .where(and(
      eq(paymentRequests.orderId, order.id),
      eq(paymentRequests.status, "pending"),
    ))
    .orderBy(asc(paymentRequests.createdAt), asc(paymentRequests.id));
  const activeIds = await activeRequestAttemptIds(transaction, order.id);
  let reservedCents = pending
    .filter((request) => activeIds.has(request.id))
    .reduce((sum, request) => sum + request.amountCents, 0);
  if (reservedCents > outstandingCents) {
    throw new PaymentRequestConflictError("In-flight payment exceeds outstanding balance");
  }
  const invalidatedIds: string[] = [];
  for (const request of pending) {
    if (activeIds.has(request.id)) continue;
    if (reservedCents + request.amountCents <= outstandingCents) {
      reservedCents += request.amountCents;
    } else {
      invalidatedIds.push(request.id);
    }
  }
  if (invalidatedIds.length) {
    await transaction.update(paymentRequests).set({
      status: "invalidated",
      statusReason: "outstanding_balance_reduced",
      invalidatedAt: now,
      updatedAt: now,
    }).where(inArray(paymentRequests.id, invalidatedIds));
  }
  return { outstandingCents, reservedCents, activeIds };
}

async function updateOrderPaymentStatus(
  transaction: Transaction,
  order: OrderRow,
  now: Date,
) {
  const { outstandingCents } = await orderBalance(transaction, order);
  const requestInFlight = await activeRequestAttemptIds(transaction, order.id);
  const directReserved = await directAttemptReservation(transaction, order.id);
  const paymentStatus: OrderPaymentStatus = outstandingCents === 0
    ? "paid"
    : requestInFlight.size > 0 || directReserved > 0
      ? "processing"
      : "awaiting_payment";
  await transaction.update(orders).set({ paymentStatus, updatedAt: now })
    .where(eq(orders.id, order.id));
}

function attemptClaimRecord(
  outcome: RequestAttemptClaim["outcome"],
  request: PaymentRequestRecord,
  attempt: AttemptRow,
  claimId: string | null,
): RequestAttemptClaim {
  return Object.freeze({
    outcome,
    request,
    attempt: Object.freeze({
      id: attempt.id,
      provider: attempt.provider,
      method: attempt.method,
      status: attempt.status,
      providerReference: attempt.providerReference,
      idempotencyKey: attempt.idempotencyKey,
    }),
    claimId,
  });
}

export function createDrizzlePaymentRequestRepository(
  database: Database,
  options: Readonly<{ leaseDurationMs?: number }> = {},
): PaymentRequestRepository {
  const leaseDurationMs = options.leaseDurationMs ?? 60_000;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new Error("Payment request lease must be positive");
  }

  const repository: PaymentRequestRepository = {
    async createRequest(input: CreatePaymentRequestRecordInput) {
      return database.transaction(async (transaction) => {
        let orderNumber: string | null = null;
        if (input.kind === "order_balance") {
          if (!input.orderId) throw new PaymentRequestConflictError();
          const order = await lockOrder(transaction, input.orderId);
          const now = await databaseNow(transaction);
          const balance = await reconcileOrderRequests(transaction, order, now);
          const directReserved = await directAttemptReservation(transaction, order.id);
          if (
            input.currency !== order.currency ||
            input.amountCents > balance.outstandingCents - balance.reservedCents - directReserved
          ) {
            throw new PaymentRequestConflictError();
          }
          orderNumber = order.orderNumber;
        } else if (input.orderId !== null) {
          throw new PaymentRequestConflictError();
        }
        const [created] = await transaction.insert(paymentRequests).values({
          requestNumber: input.requestNumber,
          publicTokenDigest: input.publicTokenDigest,
          kind: input.kind,
          orderId: input.orderId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          description: input.description,
          currency: input.currency,
          amountCents: input.amountCents,
          enabledPaymentMethods: input.enabledPaymentMethods,
          expiresAt: input.expiresAt,
          internalNote: input.internalNote,
          createdBy: input.createdBy,
        }).returning();
        return requestRecord(created, orderNumber);
      });
    },

    async findPublicByDigest(digest) {
      return database.transaction(async (transaction) => {
        const [candidate] = await transaction.select({
          request: paymentRequests,
          orderNumber: orders.orderNumber,
        }).from(paymentRequests)
          .leftJoin(orders, eq(orders.id, paymentRequests.orderId))
          .where(eq(paymentRequests.publicTokenDigest, digest))
          .limit(1);
        if (!candidate) return null;
        const now = await databaseNow(transaction);
        await expireStaleRequests(transaction, now, candidate.request.orderId ?? undefined);
        const [current] = await transaction.select({
          request: paymentRequests,
          orderNumber: orders.orderNumber,
        }).from(paymentRequests)
          .leftJoin(orders, eq(orders.id, paymentRequests.orderId))
          .where(eq(paymentRequests.id, candidate.request.id))
          .limit(1);
        return current ? requestRecord(current.request, current.orderNumber) : null;
      });
    },

    async rotateToken(input) {
      if (!input.actorId) throw new PaymentRequestConflictError();
      const [candidate] = await database.select({
        id: paymentRequests.id,
        orderId: paymentRequests.orderId,
      }).from(paymentRequests).where(eq(paymentRequests.id, input.requestId)).limit(1);
      if (!candidate) throw new PaymentRequestNotFoundError();
      return database.transaction(async (transaction) => {
        if (candidate.orderId) await lockOrder(transaction, candidate.orderId);
        const [request] = await transaction.select().from(paymentRequests)
          .where(eq(paymentRequests.id, candidate.id)).for("update").limit(1);
        if (!request) throw new PaymentRequestNotFoundError();
        const now = await databaseNow(transaction);
        await expireStaleRequests(transaction, now, request.orderId ?? undefined);
        const [activeAttempt] = await transaction.select({ id: paymentAttempts.id })
          .from(paymentAttempts)
          .where(and(
            eq(paymentAttempts.paymentRequestId, request.id),
            inArray(paymentAttempts.status, nonterminalAttempts),
          )).limit(1);
        const [current] = await transaction.select().from(paymentRequests)
          .where(eq(paymentRequests.id, request.id)).for("update").limit(1);
        if (!current || current.status !== "pending" || activeAttempt) {
          throw new PaymentRequestConflictError("Payment token cannot be rotated");
        }
        const [updated] = await transaction.update(paymentRequests).set({
          publicTokenDigest: input.publicTokenDigest,
          tokenRotatedAt: now,
          updatedAt: now,
        }).where(eq(paymentRequests.id, current.id)).returning();
        const orderNumber = candidate.orderId
          ? (await transaction.select({ orderNumber: orders.orderNumber })
              .from(orders).where(eq(orders.id, candidate.orderId)).limit(1))[0]?.orderNumber ?? null
          : null;
        return requestRecord(updated, orderNumber);
      });
    },

    async cancel(input) {
      if (!input.actorId) throw new PaymentRequestConflictError();
      const [candidate] = await database.select({
        id: paymentRequests.id,
        orderId: paymentRequests.orderId,
      }).from(paymentRequests).where(eq(paymentRequests.id, input.requestId)).limit(1);
      if (!candidate) throw new PaymentRequestNotFoundError();
      return database.transaction(async (transaction) => {
        let orderNumber: string | null = null;
        if (candidate.orderId) {
          orderNumber = (await lockOrder(transaction, candidate.orderId)).orderNumber;
        }
        const [request] = await transaction.select().from(paymentRequests)
          .where(eq(paymentRequests.id, candidate.id)).for("update").limit(1);
        if (!request) throw new PaymentRequestNotFoundError();
        const [activeAttempt] = await transaction.select({ id: paymentAttempts.id })
          .from(paymentAttempts)
          .where(and(
            eq(paymentAttempts.paymentRequestId, request.id),
            inArray(paymentAttempts.status, nonterminalAttempts),
          )).limit(1);
        if (request.status !== "pending" || activeAttempt) {
          throw new PaymentRequestConflictError("Payment request cannot be cancelled");
        }
        const now = await databaseNow(transaction);
        const [updated] = await transaction.update(paymentRequests).set({
          status: "cancelled",
          statusReason: "cancelled_by_admin",
          cancelledBy: input.actorId,
          cancelledAt: now,
          updatedAt: now,
        }).where(eq(paymentRequests.id, request.id)).returning();
        return requestRecord(updated, orderNumber);
      });
    },

    async getOrderSummary(orderId): Promise<OrderPaymentSummary> {
      return database.transaction(async (transaction) => {
        const order = await lockOrder(transaction, orderId);
        const now = await databaseNow(transaction);
        const { outstandingCents, reservedCents } = await reconcileOrderRequests(
          transaction,
          order,
          now,
        );
        const { ledger, netPaidCents } = await orderBalance(transaction, order);
        return Object.freeze({
          orderId: order.id,
          orderNumber: order.orderNumber,
          currency: order.currency,
          totalCents: order.totalInclGstCents,
          netPaidCents,
          outstandingCents,
          reservedCents,
          ledger: Object.freeze(ledger.map(ledgerRecord)),
        });
      });
    },

    async recordBankTransfer(input) {
      return database.transaction(async (transaction) => {
        const order = await lockOrder(transaction, input.orderId);
        const now = await databaseNow(transaction);
        const balance = await reconcileOrderRequests(transaction, order, now);
        const requestActiveIds = balance.activeIds;
        const activeRequests = requestActiveIds.size
          ? await transaction.select({ amountCents: paymentRequests.amountCents })
              .from(paymentRequests)
              .where(inArray(paymentRequests.id, [...requestActiveIds]))
          : [];
        const inFlightCents = activeRequests.reduce((sum, row) => sum + row.amountCents, 0)
          + await directAttemptReservation(transaction, order.id);
        if (
          !Number.isSafeInteger(input.amountCents) ||
          input.amountCents <= 0 ||
          input.amountCents > balance.outstandingCents ||
          input.amountCents + inFlightCents > balance.outstandingCents
        ) {
          throw new PaymentRequestConflictError("Bank transfer could cause overpayment");
        }
        const [created] = await transaction.insert(paymentLedgerEntries).values({
          orderId: order.id,
          paymentRequestId: null,
          paymentAttemptId: null,
          entryType: "bank_transfer",
          direction: "credit",
          amountCents: input.amountCents,
          currency: order.currency,
          receivedAt: input.receivedAt,
          reference: input.reference,
          payerName: input.payerName,
          note: input.note,
          createdBy: input.createdBy,
        }).returning();
        await updateOrderPaymentStatus(transaction, order, now);
        await reconcileOrderRequests(transaction, order, now);
        return ledgerRecord(created);
      });
    },

    async reverseBankTransfer(input) {
      const [candidate] = await database.select({ orderId: paymentLedgerEntries.orderId })
        .from(paymentLedgerEntries).where(eq(paymentLedgerEntries.id, input.entryId)).limit(1);
      if (!candidate?.orderId) throw new PaymentRequestNotFoundError();
      return database.transaction(async (transaction) => {
        const order = await lockOrder(transaction, candidate.orderId!);
        const [entry] = await transaction.select().from(paymentLedgerEntries)
          .where(eq(paymentLedgerEntries.id, input.entryId)).for("update").limit(1);
        if (!entry) throw new PaymentRequestNotFoundError();
        const [existing] = await transaction.select({ id: paymentLedgerEntries.id })
          .from(paymentLedgerEntries)
          .where(eq(paymentLedgerEntries.reversesEntryId, entry.id))
          .limit(1);
        let reversal;
        try {
          reversal = validateLedgerReversal(ledgerRecord(entry), Boolean(existing));
        } catch (error) {
          throw new PaymentRequestConflictError(
            error instanceof Error ? error.message : undefined,
          );
        }
        const now = await databaseNow(transaction);
        const [created] = await transaction.insert(paymentLedgerEntries).values({
          orderId: reversal.orderId,
          paymentRequestId: null,
          paymentAttemptId: null,
          entryType: "reversal",
          direction: "debit",
          amountCents: reversal.amountCents,
          currency: reversal.currency,
          receivedAt: now,
          note: input.reason,
          reversesEntryId: reversal.reversesEntryId,
          createdBy: input.createdBy,
        }).returning();
        await updateOrderPaymentStatus(transaction, order, now);
        await reconcileOrderRequests(transaction, order, now);
        return ledgerRecord(created);
      });
    },

    async preflightAndClaimAttempt(input) {
      const [candidate] = await database.select({
        id: paymentRequests.id,
        orderId: paymentRequests.orderId,
      }).from(paymentRequests)
        .where(eq(paymentRequests.publicTokenDigest, input.publicTokenDigest))
        .limit(1);
      if (!candidate) throw new PaymentRequestNotFoundError();
      const result = await database.transaction(async (transaction) => {
        let order: OrderRow | null = null;
        if (candidate.orderId) order = await lockOrder(transaction, candidate.orderId);
        const [request] = await transaction.select().from(paymentRequests)
          .where(eq(paymentRequests.id, candidate.id)).for("update").limit(1);
        if (!request || request.publicTokenDigest !== input.publicTokenDigest) {
          throw new PaymentRequestNotFoundError();
        }
        const now = await databaseNow(transaction);
        await expireStaleRequests(transaction, now, request.orderId ?? undefined);
        const [current] = await transaction.select().from(paymentRequests)
          .where(eq(paymentRequests.id, request.id)).for("update").limit(1);
        if (!current || current.status !== "pending") return null;
        if (!current.enabledPaymentMethods.includes(input.method)) {
          throw new PaymentRequestConflictError("Payment method is unavailable");
        }
        if (order) {
          await reconcileOrderRequests(transaction, order, now);
          const [rechecked] = await transaction.select().from(paymentRequests)
            .where(eq(paymentRequests.id, current.id)).for("update").limit(1);
          const { outstandingCents } = await orderBalance(transaction, order);
          if (!rechecked || rechecked.status !== "pending" || rechecked.amountCents > outstandingCents) {
            return null;
          }
        }
        const [existing] = await transaction.select().from(paymentAttempts)
          .where(and(
            eq(paymentAttempts.paymentRequestId, current.id),
            inArray(paymentAttempts.status, nonterminalAttempts),
          )).for("update").limit(1);
        const orderNumber = order?.orderNumber ?? null;
        const record = requestRecord(current, orderNumber);
        if (existing) {
          if (existing.provider !== input.provider || existing.method !== input.method) {
            throw new PaymentRequestConflictError("Another payment method is in progress");
          }
          const activeLease = existing.providerSessionLeaseExpiresAt
            && existing.providerSessionLeaseExpiresAt > now;
          if (existing.providerReference || activeLease) {
            return attemptClaimRecord("existing", record, existing, null);
          }
          const claimId = randomUUID();
          const [reclaimed] = await transaction.update(paymentAttempts).set({
            providerSessionLeaseId: claimId,
            providerSessionLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
            payerSnapshot: input.payerSnapshot,
            updatedAt: now,
          }).where(eq(paymentAttempts.id, existing.id)).returning();
          return attemptClaimRecord("claimed", record, reclaimed, claimId);
        }
        const attemptId = randomUUID();
        const claimId = randomUUID();
        const country = current.currency === "AUD" ? "AU" : "NZ";
        if (input.payerSnapshot?.address?.country && input.payerSnapshot.address.country !== country) {
          throw new PaymentRequestConflictError("Payer country does not match currency");
        }
        const [created] = await transaction.insert(paymentAttempts).values({
          id: attemptId,
          orderId: null,
          paymentRequestId: current.id,
          provider: input.provider,
          method: input.method,
          idempotencyKey: deriveProviderIdempotencyKey({
            attemptId,
            provider: input.provider,
            operation: "create-session",
          }),
          providerSessionLeaseId: claimId,
          providerSessionLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
          expectedAmountCents: current.amountCents,
          currency: current.currency,
          country,
          payerSnapshot: input.payerSnapshot,
          status: "created",
          createdAt: now,
          updatedAt: now,
        }).returning();
        return attemptClaimRecord("claimed", record, created, claimId);
      });
      if (!result) throw new PaymentRequestConflictError("Payment request is not payable");
      return result;
    },
  };
  return Object.freeze(repository);
}
