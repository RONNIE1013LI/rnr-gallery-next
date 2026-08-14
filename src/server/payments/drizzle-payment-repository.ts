import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";
import { normalizeAddress } from "@/domain/address/schema";
import type { SupportedCountry } from "@/domain/address/types";
import type { getDatabase } from "@/server/db/client";
import {
  checkoutSessions,
  orderAddresses,
  orderNotificationOutbox,
  orders,
  paymentAttempts,
  webhookEvents,
} from "@/server/db/schema";
import type {
  OrderPaymentStatus,
  PaymentAttemptStatus,
} from "@/server/db/schema";
import {
  nextOrderPaymentStatus,
  verifiedIncomingStatus,
} from "./state-machine";
import type { PaymentVerificationSource } from "./state-machine";
import type {
  AttemptClaim,
  BindProviderSessionInput,
  ConsumedReturnState,
  CreatePaymentAttemptInput,
  PaymentAttemptRecord,
  PaymentAttemptWithOrder,
  PaymentOrderAccess,
  PaymentRepository,
  ProviderIdempotencyKeyInput,
  ReconciliationCandidate,
  VerifiedEventInput,
} from "./payment-repository";
import type { PaymentOrder, VerifiedPaymentResult } from "./types";

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AttemptRow = typeof paymentAttempts.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type AddressRow = typeof orderAddresses.$inferSelect;

const NONTERMINAL_ATTEMPTS: PaymentAttemptStatus[] = [
  "created",
  "requires_action",
  "processing",
];
const RETURN_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TERMINAL_ORDERS: OrderPaymentStatus[] = ["paid", "refunded"];
const RECONCILIATION_STALE_MS = 60_000;

export class PaymentRepositoryConflictError extends Error {
  constructor(message = "Payment attempt conflicts with the current state") {
    super(message);
    this.name = "PaymentRepositoryConflictError";
  }
}

export class PaymentVerificationMismatchError extends Error {
  constructor() {
    super("Verified payment does not match the immutable order snapshot");
    this.name = "PaymentVerificationMismatchError";
  }
}

export class PaymentRepositoryFaultError extends Error {
  constructor() {
    super("Injected payment repository fault");
    this.name = "PaymentRepositoryFaultError";
  }
}

export function deriveProviderIdempotencyKey(
  input: ProviderIdempotencyKeyInput,
): string {
  return createHash("sha256")
    .update(
      `rnr-payment:v1:${input.attemptId}:${input.provider}:${input.operation}`,
      "utf8",
    )
    .digest("hex");
}

export function assertReconciliationLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Reconciliation limit must be an integer from 1 to 50");
  }
  return limit;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function attemptRecord(row: AttemptRow): PaymentAttemptRecord {
  return Object.freeze({
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    method: row.method,
    idempotencyKey: row.idempotencyKey,
    providerReference: row.providerReference,
    returnStateDigest: row.returnStateDigest,
    returnStateConsumedAt: row.returnStateConsumedAt,
    expectedAmountCents: row.expectedAmountCents,
    currency: row.currency,
    country: row.country,
    status: row.status,
    sanitizedFailureCode: row.sanitizedFailureCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function addressFor(rows: readonly AddressRow[], kind: "billing" | "delivery") {
  const matches = rows.filter((row) => row.kind === kind);
  if (matches.length !== 1) throw new Error("Invalid order address snapshot");
  const row = matches[0];
  return normalizeAddress({
    country: row.country,
    fullName: row.fullName,
    building: row.building,
    street: row.street,
    suburb: row.suburb,
    region: row.region,
    postcode: row.postcode,
    phone: row.phone,
    email: row.email,
  });
}

function paymentOrder(
  order: OrderRow,
  addressRows: readonly AddressRow[],
): PaymentOrder & Readonly<{ paymentStatus: OrderPaymentStatus }> {
  if (
    !isNonEmpty(order.orderNumber) ||
    !isNonEmpty(order.customerEmail) ||
    order.currency !== "NZD" ||
    !isPositiveMoney(order.totalInclGstCents)
  ) {
    throw new Error("Invalid order snapshot");
  }
  const billingAddress = addressFor(addressRows, "billing");
  const deliveryAddress = addressFor(addressRows, "delivery");
  return Object.freeze({
    id: order.id,
    orderNumber: order.orderNumber,
    amountCents: order.totalInclGstCents,
    currency: order.currency,
    customer: Object.freeze({
      fullName: billingAddress.fullName,
      email: billingAddress.email,
      phone: billingAddress.phone,
    }),
    billingAddress,
    deliveryAddress,
    paymentStatus: order.paymentStatus,
  });
}

async function databaseNow(transaction: Transaction): Promise<Date> {
  const result = await transaction.execute<{ now: Date }>(
    sql`select clock_timestamp() as "now"`,
  );
  const now = new Date(result.rows[0].now);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid database clock");
  return now;
}

async function loadAddresses(
  database: Database | Transaction,
  orderId: string,
): Promise<AddressRow[]> {
  return database
    .select()
    .from(orderAddresses)
    .where(eq(orderAddresses.orderId, orderId));
}

async function lockOrderThenAttempt(
  transaction: Transaction,
  attemptId: string,
): Promise<{ order: OrderRow; attempt: AttemptRow }> {
  const [unlockedAttempt] = await transaction
    .select({ orderId: paymentAttempts.orderId })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attemptId))
    .limit(1);
  if (!unlockedAttempt) throw new PaymentRepositoryConflictError();

  const [order] = await transaction
    .select()
    .from(orders)
    .where(eq(orders.id, unlockedAttempt.orderId))
    .for("update")
    .limit(1);
  if (!order) throw new PaymentRepositoryConflictError();

  const [attempt] = await transaction
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attemptId))
    .for("update")
    .limit(1);
  if (!attempt || attempt.orderId !== order.id) {
    throw new PaymentRepositoryConflictError();
  }
  return { order, attempt };
}

function assertVerifiedResult(
  order: OrderRow,
  attempt: AttemptRow,
  result: VerifiedPaymentResult,
) {
  if (
    result.providerReference !== attempt.providerReference ||
    result.amountCents !== attempt.expectedAmountCents ||
    result.amountCents !== order.totalInclGstCents ||
    result.currency !== attempt.currency ||
    result.currency !== order.currency ||
    result.orderNumber !== order.orderNumber
  ) {
    throw new PaymentVerificationMismatchError();
  }
}

async function applyLockedVerifiedResult(
  transaction: Transaction,
  input: Readonly<{
    attemptId: string;
    result: VerifiedPaymentResult;
    source: PaymentVerificationSource;
  }>,
): Promise<PaymentAttemptWithOrder> {
  const { order, attempt } = await lockOrderThenAttempt(
    transaction,
    input.attemptId,
  );
  assertVerifiedResult(order, attempt, input.result);

  if (order.paymentStatus === "refunded") {
    const addresses = await loadAddresses(transaction, order.id);
    return Object.freeze({
      attempt: attemptRecord(attempt),
      order: paymentOrder(order, addresses),
    });
  }

  const incoming = verifiedIncomingStatus(
    input.source,
    input.result.status,
  );
  if (order.paymentStatus === "paid" && incoming !== "refunded") {
    const addresses = await loadAddresses(transaction, order.id);
    return Object.freeze({
      attempt: attemptRecord(attempt),
      order: paymentOrder(order, addresses),
    });
  }
  const orderStatus = nextOrderPaymentStatus(order.paymentStatus, incoming);
  const attemptStatus = incoming === "refunded" || attempt.status === "paid"
    ? "paid"
    : incoming;
  const now = await databaseNow(transaction);

  const [updatedAttempt] = await transaction
    .update(paymentAttempts)
    .set({
      status: attemptStatus,
      sanitizedFailureCode: input.result.sanitizedFailureCode ?? null,
      providerSessionLeaseId: null,
      providerSessionLeaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(paymentAttempts.id, attempt.id))
    .returning();
  const [updatedOrder] = await transaction
    .update(orders)
    .set({ paymentStatus: orderStatus, updatedAt: now })
    .where(eq(orders.id, order.id))
    .returning();
  if (orderStatus === "paid") {
    await transaction.insert(orderNotificationOutbox).values({
      eventKey: `payment-confirmed:${order.id}`,
      kind: "payment_confirmed",
      orderId: order.id,
      recipientEmail: order.customerEmail,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: orderNotificationOutbox.eventKey });
  } else if (orderStatus === "failed") {
    await transaction.insert(orderNotificationOutbox).values({
      eventKey: `payment-failed:${attempt.id}`,
      kind: "payment_failed",
      orderId: order.id,
      recipientEmail: order.customerEmail,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: orderNotificationOutbox.eventKey });
  }
  const addresses = await loadAddresses(transaction, order.id);
  return Object.freeze({
    attempt: attemptRecord(updatedAttempt),
    order: paymentOrder(updatedOrder, addresses),
  });
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return;
  return typeof error.code === "string" ? error.code : undefined;
}

export function createDrizzlePaymentRepository(
  database: Database,
  options: Readonly<{ leaseDurationMs?: number }> = {},
): PaymentRepository {
  const leaseDurationMs = options.leaseDurationMs ?? 60_000;
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new Error("Payment lease duration must be a positive integer");
  }

  async function findPayableOrder(
    access: PaymentOrderAccess,
  ): Promise<PaymentOrder | null> {
    const ownership = access.kind === "guest"
      ? and(
          eq(orders.orderNumber, access.orderNumber),
          isNull(orders.customerId),
          eq(checkoutSessions.tokenDigest, access.tokenDigest),
          isNotNull(checkoutSessions.completedAt),
          sql`${checkoutSessions.expiresAt} > clock_timestamp()`,
        )
      : and(
          eq(orders.orderNumber, access.orderNumber),
          eq(orders.customerId, access.customerId),
        );
    const [order] = await database
      .select({ order: orders })
      .from(orders)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.id, orders.checkoutSessionId),
      )
      .where(and(ownership, notInArray(orders.paymentStatus, TERMINAL_ORDERS)))
      .limit(1);
    if (!order) return null;
    try {
      const addresses = await loadAddresses(database, order.order.id);
      const hydrated = paymentOrder(order.order, addresses);
      return Object.freeze({
        id: hydrated.id,
        orderNumber: hydrated.orderNumber,
        amountCents: hydrated.amountCents,
        currency: hydrated.currency,
        customer: hydrated.customer,
        billingAddress: hydrated.billingAddress,
        deliveryAddress: hydrated.deliveryAddress,
      });
    } catch {
      return null;
    }
  }

  async function findCurrentPayment(
    access: PaymentOrderAccess,
  ): Promise<PaymentAttemptWithOrder | null> {
    const ownership = access.kind === "guest"
      ? and(
          eq(orders.orderNumber, access.orderNumber),
          isNull(orders.customerId),
          eq(checkoutSessions.tokenDigest, access.tokenDigest),
          isNotNull(checkoutSessions.completedAt),
          sql`${checkoutSessions.expiresAt} > clock_timestamp()`,
        )
      : and(
          eq(orders.orderNumber, access.orderNumber),
          eq(orders.customerId, access.customerId),
        );
    const [row] = await database
      .select({ order: orders, attempt: paymentAttempts })
      .from(orders)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.id, orders.checkoutSessionId),
      )
      .innerJoin(paymentAttempts, eq(paymentAttempts.orderId, orders.id))
      .where(ownership)
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(1);
    if (!row) return null;
    try {
      const addresses = await loadAddresses(database, row.order.id);
      return Object.freeze({
        attempt: attemptRecord(row.attempt),
        order: paymentOrder(row.order, addresses),
      });
    } catch {
      return null;
    }
  }

  return {
    findPayableOrder,
    findCurrentPayment,

    async createOrClaimNonterminalAttempt(
      input: CreatePaymentAttemptInput,
    ): Promise<AttemptClaim> {
      return database.transaction(async (transaction) => {
        const [order] = await transaction
          .select()
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .for("update")
          .limit(1);
        if (
          !order ||
          TERMINAL_ORDERS.includes(order.paymentStatus) ||
          order.totalInclGstCents !== input.expectedAmountCents ||
          order.currency !== input.currency
        ) {
          throw new PaymentRepositoryConflictError();
        }

        let country: SupportedCountry;
        try {
          const addresses = await loadAddresses(transaction, order.id);
          country = addressFor(addresses, "delivery").country;
        } catch {
          throw new PaymentRepositoryConflictError("Invalid delivery address snapshot");
        }

        const [existing] = await transaction
          .select()
          .from(paymentAttempts)
          .where(and(
            eq(paymentAttempts.orderId, input.orderId),
            inArray(paymentAttempts.status, NONTERMINAL_ATTEMPTS),
          ))
          .for("update")
          .limit(1);
        const now = await databaseNow(transaction);

        if (existing) {
          if (existing.country !== country) {
            throw new PaymentRepositoryConflictError("Payment country does not match delivery");
          }
          if (existing.provider !== input.provider || existing.method !== input.method) {
            return Object.freeze({
              outcome: "existing_conflict" as const,
              attempt: attemptRecord(existing),
              claimId: null,
            });
          }
          const activeLease = existing.providerSessionLeaseExpiresAt &&
            existing.providerSessionLeaseExpiresAt.getTime() > now.getTime();
          if (existing.providerReference || activeLease) {
            return Object.freeze({
              outcome: "existing" as const,
              attempt: attemptRecord(existing),
              claimId: null,
            });
          }
          const claimId = randomUUID();
          const [reclaimed] = await transaction
            .update(paymentAttempts)
            .set({
              providerSessionLeaseId: claimId,
              providerSessionLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
              updatedAt: now,
            })
            .where(eq(paymentAttempts.id, existing.id))
            .returning();
          return Object.freeze({
            outcome: "claimed" as const,
            attempt: attemptRecord(reclaimed),
            claimId,
          });
        }

        const attemptId = randomUUID();
        const claimId = randomUUID();
        const [created] = await transaction
          .insert(paymentAttempts)
          .values({
            id: attemptId,
            orderId: input.orderId,
            provider: input.provider,
            method: input.method,
            idempotencyKey: deriveProviderIdempotencyKey({
              attemptId,
              provider: input.provider,
              operation: "create-session",
            }),
            providerSessionLeaseId: claimId,
            providerSessionLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
            expectedAmountCents: input.expectedAmountCents,
            currency: input.currency,
            country,
            status: "created",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return Object.freeze({
          outcome: "claimed" as const,
          attempt: attemptRecord(created),
          claimId,
        });
      });
    },

    async bindProviderSession(
      input: BindProviderSessionInput,
    ): Promise<PaymentAttemptRecord> {
      try {
        return await database.transaction(async (transaction) => {
          const { attempt } = await lockOrderThenAttempt(transaction, input.attemptId);
          if (
            attempt.providerReference === input.providerReference &&
            attempt.returnStateDigest === input.returnStateDigest &&
            attempt.status === input.status
          ) {
            return attemptRecord(attempt);
          }
          if (attempt.providerReference || attempt.returnStateDigest) {
            throw new PaymentRepositoryConflictError();
          }
          const now = await databaseNow(transaction);
          if (
            attempt.providerSessionLeaseId !== input.claimId ||
            !attempt.providerSessionLeaseExpiresAt ||
            attempt.providerSessionLeaseExpiresAt.getTime() <= now.getTime()
          ) {
            throw new PaymentRepositoryConflictError("Provider-session claim expired");
          }
          const [updated] = await transaction
            .update(paymentAttempts)
            .set({
              providerReference: input.providerReference,
              returnStateDigest: input.returnStateDigest,
              status: input.status,
              providerSessionLeaseId: null,
              providerSessionLeaseExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(paymentAttempts.id, attempt.id))
            .returning();
          return attemptRecord(updated);
        });
      } catch (error) {
        if (postgresCode(error) === "23505") {
          throw new PaymentRepositoryConflictError();
        }
        throw error;
      }
    },

    async consumeReturnState(input): Promise<ConsumedReturnState | null> {
      const [candidate] = await database
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(and(
          eq(paymentAttempts.provider, input.provider),
          eq(paymentAttempts.returnStateDigest, input.digest),
        ))
        .limit(1);
      if (!candidate) return null;

      return database.transaction(async (transaction) => {
        const { order, attempt } = await lockOrderThenAttempt(transaction, candidate.id);
        if (
          attempt.provider !== input.provider ||
          attempt.method !== input.method ||
          attempt.returnStateDigest !== input.digest ||
          attempt.providerReference !== input.providerReference ||
          order.orderNumber !== input.orderNumber
        ) {
          return null;
        }
        if (attempt.returnStateConsumedAt) {
          return Object.freeze({
            outcome: "already_consumed" as const,
            orderNumber: order.orderNumber,
          });
        }
        const now = await databaseNow(transaction);
        if (
          attempt.createdAt.getTime() + RETURN_STATE_MAX_AGE_MS <= now.getTime()
        ) return null;
        const [updated] = await transaction
          .update(paymentAttempts)
          .set({ returnStateConsumedAt: now, updatedAt: now })
          .where(and(
            eq(paymentAttempts.id, attempt.id),
            isNull(paymentAttempts.returnStateConsumedAt),
          ))
          .returning();
        if (!updated) return null;
        const addresses = await loadAddresses(transaction, order.id);
        return Object.freeze({
          outcome: "consumed" as const,
          attempt: attemptRecord(updated),
          order: paymentOrder(order, addresses),
        });
      });
    },

    async applyVerifiedResult(input): Promise<PaymentAttemptWithOrder> {
      if (
        input.source !== "browser_return" &&
        input.source !== "server_capture" &&
        input.source !== "reconciliation"
      ) {
        throw new PaymentVerificationMismatchError();
      }
      return database.transaction((transaction) =>
        applyLockedVerifiedResult(transaction, input),
      );
    },

    async applyVerifiedWebhookEventAtomically(input: VerifiedEventInput) {
      return database.transaction(async (transaction) => {
        const inserted = await transaction
          .insert(webhookEvents)
          .values({
            provider: input.provider,
            providerEventId: input.providerEventId,
            payloadSha256: input.payloadSha256,
          })
          .onConflictDoNothing()
          .returning();
        const [event] = inserted.length
          ? inserted
          : await transaction
              .select()
              .from(webhookEvents)
              .where(and(
                eq(webhookEvents.provider, input.provider),
                eq(webhookEvents.providerEventId, input.providerEventId),
              ))
              .for("update")
              .limit(1);
        if (!event) throw new PaymentRepositoryConflictError();
        if (event.payloadSha256 !== input.payloadSha256) return "hash_mismatch";
        if (event.processingResult) return "duplicate";
        if (input.faultAt === "after_event_insert") {
          throw new PaymentRepositoryFaultError();
        }

        const [candidate] = await transaction
          .select({ id: paymentAttempts.id })
          .from(paymentAttempts)
          .where(and(
            eq(paymentAttempts.provider, input.provider),
            eq(paymentAttempts.providerReference, input.result.providerReference),
          ))
          .limit(1);
        if (!candidate) throw new PaymentVerificationMismatchError();
        const locked = await lockOrderThenAttempt(transaction, candidate.id);
        if (
          locked.attempt.provider !== input.provider ||
          locked.attempt.providerReference !== input.result.providerReference ||
          (event.paymentAttemptId !== null && event.paymentAttemptId !== candidate.id)
        ) {
          throw new PaymentVerificationMismatchError();
        }
        assertVerifiedResult(locked.order, locked.attempt, input.result);

        await applyLockedVerifiedResult(
          transaction,
          {
            attemptId: candidate.id,
            result: input.result,
            source: "verified_webhook",
          },
        );
        if (input.faultAt === "after_transition") {
          throw new PaymentRepositoryFaultError();
        }
        if (input.faultAt === "before_processed_result") {
          throw new PaymentRepositoryFaultError();
        }
        const now = await databaseNow(transaction);
        await transaction
          .update(webhookEvents)
          .set({
            paymentAttemptId: candidate.id,
            processingResult: "applied",
            processedAt: now,
          })
          .where(eq(webhookEvents.id, event.id));
        return "applied";
      });
    },

    async claimReconciliationCandidates(limit) {
      assertReconciliationLimit(limit);
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        const claimId = randomUUID();
        const claimed = await transaction.execute<{ id: string }>(sql`
          with candidates as (
            select attempts.id
            from ${paymentAttempts} as attempts
            inner join ${orders} as candidate_orders
              on candidate_orders.id = attempts.order_id
            where attempts.status in ('requires_action', 'processing')
              and attempts.provider_reference is not null
              and candidate_orders.payment_status not in ('paid', 'refunded', 'failed', 'cancelled')
              and (
                attempts.provider_session_lease_id is null
                or attempts.provider_session_lease_expires_at <= ${now}
              )
              and attempts.updated_at <= ${new Date(now.getTime() - RECONCILIATION_STALE_MS)}
              and not (attempts.provider = 'zip' and attempts.currency <> 'AUD')
            order by attempts.updated_at asc, attempts.id asc
            for update of attempts skip locked
            limit ${limit}
          )
          update ${paymentAttempts} as claimed_attempts
          set provider_session_lease_id = ${claimId},
              provider_session_lease_expires_at = ${new Date(now.getTime() + leaseDurationMs)}
          from candidates
          where claimed_attempts.id = candidates.id
          returning claimed_attempts.id
        `);
        const claimedIds = claimed.rows.map((row) => row.id);
        if (claimedIds.length === 0) return Object.freeze([]);

        const rows = await transaction
          .select({ attempt: paymentAttempts, order: orders })
          .from(paymentAttempts)
          .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
          .where(inArray(paymentAttempts.id, claimedIds))
          .orderBy(asc(paymentAttempts.updatedAt), asc(paymentAttempts.id));
        const candidates: ReconciliationCandidate[] = [];
        for (const row of rows) {
          try {
            if (
              row.attempt.expectedAmountCents !== row.order.totalInclGstCents ||
              row.attempt.currency !== row.order.currency ||
              !row.attempt.providerReference
            ) continue;
            const addresses = await loadAddresses(transaction, row.order.id);
            candidates.push(Object.freeze({
              claimId,
              attempt: attemptRecord(row.attempt),
              order: paymentOrder(row.order, addresses),
            }));
          } catch {
            continue;
          }
        }
        return Object.freeze(candidates);
      });
    },

    async applyReconciliationResult(input) {
      return database.transaction(async (transaction) => {
        const { attempt } = await lockOrderThenAttempt(transaction, input.attemptId);
        const now = await databaseNow(transaction);
        if (
          attempt.providerSessionLeaseId !== input.claimId ||
          !attempt.providerSessionLeaseExpiresAt ||
          attempt.providerSessionLeaseExpiresAt.getTime() <= now.getTime()
        ) {
          throw new PaymentRepositoryConflictError("Reconciliation claim expired");
        }
        const applied = await applyLockedVerifiedResult(transaction, {
          attemptId: input.attemptId,
          result: input.result,
          source: "reconciliation",
        });
        await transaction
          .update(paymentAttempts)
          .set({
            providerSessionLeaseId: null,
            providerSessionLeaseExpiresAt: null,
          })
          .where(and(
            eq(paymentAttempts.id, input.attemptId),
            eq(paymentAttempts.providerSessionLeaseId, input.claimId),
          ));
        return applied;
      });
    },

    async recordReconciliationOutcome(input) {
      await database.transaction(async (transaction) => {
        const { order, attempt } = await lockOrderThenAttempt(transaction, input.attemptId);
        const now = await databaseNow(transaction);
        if (
          attempt.providerSessionLeaseId !== input.claimId ||
          !attempt.providerSessionLeaseExpiresAt ||
          attempt.providerSessionLeaseExpiresAt.getTime() <= now.getTime()
        ) {
          throw new PaymentRepositoryConflictError("Reconciliation claim expired");
        }
        const terminal = order.paymentStatus === "paid" || order.paymentStatus === "refunded" ||
          attempt.status === "paid";
        await transaction
          .update(paymentAttempts)
          .set({
            sanitizedFailureCode: terminal ? attempt.sanitizedFailureCode : input.code,
            providerSessionLeaseId: null,
            providerSessionLeaseExpiresAt: null,
            updatedAt: now,
          })
          .where(and(
            eq(paymentAttempts.id, input.attemptId),
            eq(paymentAttempts.providerSessionLeaseId, input.claimId),
          ));
      });
    },
  };
}
