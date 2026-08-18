import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkoutSessions,
  orderAddresses,
  orders,
  paymentAttempts,
  paymentLedgerEntries,
  paymentRequests,
  user,
  webhookEvents,
} from "@/server/db/schema";
import {
  PaymentRequestConflictError,
  createDrizzlePaymentRequestRepository,
} from "./drizzle-payment-request-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: testDatabaseUrl });
const database = drizzle(pool);
const repository = createDrizzlePaymentRequestRepository(database, {
  leaseDurationMs: 30_000,
});
const suffix = randomUUID();
const actorId = `payment-request-admin-${suffix}`;
const orderIds: string[] = [];
const sessionIds: string[] = [];
const requestIds: string[] = [];
const webhookEventIds: string[] = [];

async function createOrder(totalCents = 40_000) {
  const [session] = await database.insert(checkoutSessions).values({
    tokenDigest: `payment-request-session-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
    completedAt: new Date(),
  }).returning();
  sessionIds.push(session.id);
  const [order] = await database.insert(orders).values({
    orderNumber: `RNR-PR-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    checkoutSessionId: session.id,
    checkoutSessionVersion: 1,
    idempotencyKey: randomUUID(),
    customerEmail: "payer@example.test",
    market: "NZ",
    currency: "NZD",
    taxJurisdiction: "NZ_GST",
    taxRateBasisPoints: 0,
    pricingSnapshot: {
      schemaVersion: 1,
      market: "NZ",
      currency: "NZD",
      priceBookRevision: 0,
      taxJurisdiction: "NZ_GST",
      taxRateBasisPoints: 0,
      items: [],
      productSubtotalExTaxCents: totalCents,
      productTaxCents: 0,
      productTotalInclTaxCents: totalCents,
      designSurchargeCents: 0,
      discountCents: 0,
      shipping: {
        method: "pickup",
        serviceCode: "pickup",
        currency: "NZD",
        amountExTaxCents: 0,
        taxCents: 0,
        amountInclTaxCents: 0,
      },
      taxAmountCents: 0,
      finalTotalCents: totalCents,
    },
    deliveryMethod: "pickup",
    shippingServiceCode: "pickup",
    shippingServiceName: "Pickup",
    productSubtotalExGstCents: totalCents,
    productGstCents: 0,
    productTotalInclGstCents: totalCents,
    shippingExGstCents: 0,
    shippingGstCents: 0,
    shippingTotalInclGstCents: 0,
    totalExGstCents: totalCents,
    totalGstCents: 0,
    totalInclGstCents: totalCents,
  }).returning();
  orderIds.push(order.id);
  await database.insert(orderAddresses).values([
    {
      orderId: order.id,
      kind: "billing",
      country: "NZ",
      fullName: "Payment Customer",
      building: "",
      street: "1 Test Street",
      suburb: "Test Suburb",
      region: "Auckland",
      postcode: "1010",
      phone: "+64210000000",
      email: "payer@example.test",
    },
    {
      orderId: order.id,
      kind: "delivery",
      country: "NZ",
      fullName: "Payment Customer",
      building: "",
      street: "1 Test Street",
      suburb: "Test Suburb",
      region: "Auckland",
      postcode: "1010",
      phone: "+64210000000",
      email: "payer@example.test",
    },
  ]);
  return order;
}

let numberCounter = 0;
function orderRequest(orderId: string, amountCents: number) {
  numberCounter += 1;
  return {
    kind: "order_balance" as const,
    orderId,
    requestNumber: `PAY-${suffix.slice(0, 8)}-${numberCounter}`,
    publicTokenDigest: numberCounter.toString(16).padStart(64, "a").slice(-64),
    description: "Outstanding balance",
    currency: "NZD" as const,
    amountCents,
    enabledPaymentMethods: ["card", "afterpay"] as const,
    expiresAt: null,
    internalNote: null,
    customerName: null,
    customerEmail: null,
    createdBy: actorId,
    idempotencyKey: `request-create-${numberCounter}`,
  };
}

async function remember(
  promise: ReturnType<typeof repository.createRequest>,
) {
  const { request: record } = await promise;
  requestIds.push(record.id);
  return record;
}

describe("payment request balance transactions", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: actorId,
      name: "Payment Request Admin",
      email: `${actorId}@example.test`,
      role: "admin",
    });
  });

  afterAll(async () => {
    if (webhookEventIds.length) {
      await database.delete(webhookEvents).where(
        inArray(webhookEvents.providerEventId, webhookEventIds),
      );
    }
    if (requestIds.length) {
      await database.delete(paymentLedgerEntries).where(
        inArray(paymentLedgerEntries.paymentRequestId, requestIds),
      );
      await database.delete(paymentAttempts).where(
        inArray(paymentAttempts.paymentRequestId, requestIds),
      );
    }
    if (orderIds.length) {
      await database.delete(paymentLedgerEntries).where(
        inArray(paymentLedgerEntries.orderId, orderIds),
      );
      await database.delete(paymentAttempts).where(inArray(paymentAttempts.orderId, orderIds));
    }
    if (requestIds.length) {
      await database.delete(paymentRequests).where(inArray(paymentRequests.id, requestIds));
    }
    if (orderIds.length) {
      await database.delete(orderAddresses).where(inArray(orderAddresses.orderId, orderIds));
      await database.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (sessionIds.length) {
      await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds));
    }
    await database.delete(user).where(eq(user.id, actorId));
    await pool.end();
  });

  it("serializes concurrent request creation so reservations cannot exceed outstanding", async () => {
    const order = await createOrder();
    const [first, second] = await Promise.allSettled([
      remember(repository.createRequest(orderRequest(order.id, 30_000))),
      remember(repository.createRequest(orderRequest(order.id, 30_000))),
    ]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const active = await database.select({ amount: paymentRequests.amountCents })
      .from(paymentRequests)
      .where(and(eq(paymentRequests.orderId, order.id), eq(paymentRequests.status, "pending")));
    expect(active.reduce((sum, item) => sum + item.amount, 0)).toBe(30_000);
  });

  it("replays identical request creation once and rejects key reuse with another payload", async () => {
    const input = {
      ...orderRequest(randomUUID(), 20_000),
      kind: "standalone" as const,
      orderId: null,
      idempotencyKey: `request-replay-${randomUUID()}`,
    };
    const first = await repository.createRequest(input);
    requestIds.push(first.request.id);
    const replay = await repository.createRequest({
      ...input,
      requestNumber: `${input.requestNumber}-retry`,
      publicTokenDigest: "f".repeat(64),
    });

    expect(first).toMatchObject({ outcome: "created" });
    expect(replay).toMatchObject({ outcome: "existing", request: { id: first.request.id } });
    await expect(repository.createRequest({
      ...input,
      requestNumber: `${input.requestNumber}-conflict`,
      publicTokenDigest: "e".repeat(64),
      amountCents: 19_999,
    })).rejects.toBeInstanceOf(PaymentRequestConflictError);
  });

  it("replays identical bank credits and reversals without duplicate ledger entries", async () => {
    const order = await createOrder();
    const bankInput = {
      orderId: order.id,
      amountCents: 10_000,
      receivedAt: new Date("2026-08-18T05:00:00.000Z"),
      reference: "BANK-IDEMPOTENT",
      payerName: null,
      note: null,
      createdBy: actorId,
      idempotencyKey: `bank-${randomUUID()}`,
    };
    const credit = await repository.recordBankTransfer(bankInput);
    const replayedCredit = await repository.recordBankTransfer(bankInput);
    expect(replayedCredit.id).toBe(credit.id);
    await expect(repository.recordBankTransfer({
      ...bankInput,
      amountCents: 9_999,
    })).rejects.toBeInstanceOf(PaymentRequestConflictError);

    const reversalInput = {
      entryId: credit.id,
      reason: "Wrong order",
      createdBy: actorId,
      idempotencyKey: `reversal-${randomUUID()}`,
    };
    const reversal = await repository.reverseBankTransfer(reversalInput);
    const replayedReversal = await repository.reverseBankTransfer(reversalInput);
    expect(replayedReversal.id).toBe(reversal.id);
    const ledger = await database.select().from(paymentLedgerEntries)
      .where(eq(paymentLedgerEntries.orderId, order.id));
    expect(ledger).toHaveLength(2);
  });

  it("invalidates pending requests deterministically after a bank credit", async () => {
    const order = await createOrder();
    const first = await remember(repository.createRequest(orderRequest(order.id, 25_000)));
    const second = await remember(repository.createRequest(orderRequest(order.id, 15_000)));

    const entry = await repository.recordBankTransfer({
      orderId: order.id,
      amountCents: 20_000,
      receivedAt: new Date("2026-08-18T05:00:00.000Z"),
      reference: "BANK-1",
      payerName: null,
      note: null,
      createdBy: actorId,
      idempotencyKey: `bank-credit-${randomUUID()}`,
    });

    expect(entry.amountCents).toBe(20_000);
    const rows = await database.select({ id: paymentRequests.id, status: paymentRequests.status })
      .from(paymentRequests)
      .where(inArray(paymentRequests.id, [first.id, second.id]));
    expect(new Map(rows.map((row) => [row.id, row.status]))).toEqual(
      new Map([[first.id, "invalidated"], [second.id, "pending"]]),
    );
    await expect(repository.getOrderSummary(order.id)).resolves.toMatchObject({
      totalCents: 40_000,
      netPaidCents: 20_000,
      outstandingCents: 20_000,
      reservedCents: 15_000,
    });
  });

  it("rechecks balance before an attempt and blocks a conflicting bank credit", async () => {
    const order = await createOrder();
    const request = await remember(repository.createRequest(orderRequest(order.id, 25_000)));
    const claim = await repository.preflightAndClaimAttempt({
      publicTokenDigest: request.publicTokenDigest,
      provider: "stripe",
      method: "card",
      payerSnapshot: null,
    });
    expect(claim).toMatchObject({ outcome: "claimed", request: { id: request.id } });

    await expect(repository.recordBankTransfer({
      orderId: order.id,
      amountCents: 20_000,
      receivedAt: new Date(),
      reference: "CONFLICT",
      payerName: null,
      note: null,
      createdBy: actorId,
      idempotencyKey: `bank-conflict-${randomUUID()}`,
    })).rejects.toBeInstanceOf(PaymentRequestConflictError);

    await expect(repository.recordBankTransfer({
      orderId: order.id,
      amountCents: 15_000,
      receivedAt: new Date(),
      reference: "SAFE",
      payerName: null,
      note: null,
      createdBy: actorId,
      idempotencyKey: `bank-safe-${randomUUID()}`,
    })).resolves.toMatchObject({ amountCents: 15_000 });
  });

  it("invalidates a request when a fresh preflight sees a lower balance", async () => {
    const order = await createOrder();
    const request = await remember(repository.createRequest(orderRequest(order.id, 30_000)));
    await database.insert(paymentLedgerEntries).values({
      orderId: order.id,
      entryType: "bank_transfer",
      direction: "credit",
      amountCents: 20_000,
      currency: "NZD",
      receivedAt: new Date(),
      reference: "CONCURRENT-CREDIT",
      createdBy: actorId,
      idempotencyKey: `bank-reversal-again-${randomUUID()}`,
    });

    await expect(repository.preflightAndClaimAttempt({
      publicTokenDigest: request.publicTokenDigest,
      provider: "stripe",
      method: "card",
      payerSnapshot: null,
    })).rejects.toBeInstanceOf(PaymentRequestConflictError);
    const [current] = await database.select({ status: paymentRequests.status })
      .from(paymentRequests).where(eq(paymentRequests.id, request.id));
    expect(current.status).toBe("invalidated");
  });

  it("records an exact reversal without editing the original credit", async () => {
    const order = await createOrder();
    const credit = await repository.recordBankTransfer({
      orderId: order.id,
      amountCents: 10_000,
      receivedAt: new Date(),
      reference: "BANK-REV",
      payerName: null,
      note: null,
      createdBy: actorId,
      idempotencyKey: `bank-reversal-source-${randomUUID()}`,
    });
    const reversal = await repository.reverseBankTransfer({
      entryId: credit.id,
      reason: "Wrong order",
      createdBy: actorId,
      idempotencyKey: `bank-reversal-${randomUUID()}`,
    });
    expect(reversal).toMatchObject({
      entryType: "reversal",
      direction: "debit",
      amountCents: 10_000,
      reversesEntryId: credit.id,
    });
    await expect(repository.reverseBankTransfer({
      entryId: credit.id,
      reason: "Again",
      createdBy: actorId,
      idempotencyKey: `bank-reversal-again-${randomUUID()}`,
    })).rejects.toBeInstanceOf(PaymentRequestConflictError);
    await expect(repository.getOrderSummary(order.id)).resolves.toMatchObject({
      netPaidCents: 0,
      outstandingCents: 40_000,
    });
  });

  it("creates and claims a standalone request without an Order", async () => {
    const created = await remember(repository.createRequest({
      ...orderRequest(randomUUID(), 20_000),
      kind: "standalone",
      orderId: null,
      currency: "AUD",
      customerName: "Internal Name",
      customerEmail: "internal@example.test",
      enabledPaymentMethods: ["card", "zip"],
    }));
    expect(created.orderId).toBeNull();
    await expect(repository.preflightAndClaimAttempt({
      publicTokenDigest: created.publicTokenDigest,
      provider: "stripe",
      method: "card",
      payerSnapshot: {
        fullName: "Public Payer",
        email: "payer@example.test",
        phone: "",
      },
    })).resolves.toMatchObject({
      outcome: "claimed",
      request: { id: created.id, amountCents: 20_000, currency: "AUD" },
    });
  });

  it("rotates only a pending token without a nonterminal attempt", async () => {
    const request = await remember(repository.createRequest({
      ...orderRequest(randomUUID(), 20_000),
      kind: "standalone",
      orderId: null,
    }));
    const replacementDigest = "d".repeat(64);
    await expect(repository.rotateToken({
      requestId: request.id,
      publicTokenDigest: replacementDigest,
      actorId,
    })).resolves.toMatchObject({ publicTokenDigest: replacementDigest });
    await expect(repository.findPublicByDigest(request.publicTokenDigest)).resolves.toBeNull();
    await expect(repository.findPublicByDigest(replacementDigest)).resolves.toMatchObject({
      id: request.id,
    });

    await repository.preflightAndClaimAttempt({
      publicTokenDigest: replacementDigest,
      provider: "stripe",
      method: "card",
      payerSnapshot: { fullName: "Payer", email: "payer@example.test", phone: "" },
    });
    await expect(repository.rotateToken({
      requestId: request.id,
      publicTokenDigest: "e".repeat(64),
      actorId,
    })).rejects.toBeInstanceOf(PaymentRequestConflictError);
  });

  it("binds and applies one verified online payment ledger entry idempotently", async () => {
    const order = await createOrder();
    const request = await remember(repository.createRequest(orderRequest(order.id, 20_000)));
    const claim = await repository.preflightAndClaimAttempt({
      publicTokenDigest: request.publicTokenDigest,
      provider: "stripe",
      method: "card",
      payerSnapshot: null,
    });
    expect(claim.claimId).toBeTruthy();
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: "pi_payment_request_123",
      returnStateDigest: "b".repeat(64),
      status: "processing",
    });

    const verified = {
      providerReference: "pi_payment_request_123",
      providerStatus: "succeeded",
      amountCents: 20_000,
      currency: "NZD" as const,
      merchantReference: request.requestNumber,
      status: "paid" as const,
    };
    await expect(repository.applyVerifiedResult({
      attemptId: claim.attempt.id,
      result: verified,
      source: "verified_webhook",
    })).resolves.toMatchObject({ request: { id: request.id, status: "paid" } });
    await expect(repository.applyVerifiedResult({
      attemptId: claim.attempt.id,
      result: verified,
      source: "reconciliation",
    })).resolves.toMatchObject({ request: { id: request.id, status: "paid" } });

    const ledger = await database.select().from(paymentLedgerEntries)
      .where(eq(paymentLedgerEntries.paymentAttemptId, claim.attempt.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      entryType: "online_payment",
      direction: "credit",
      amountCents: 20_000,
      currency: "NZD",
      orderId: order.id,
      paymentRequestId: request.id,
    });
    await expect(repository.getOrderSummary(order.id)).resolves.toMatchObject({
      netPaidCents: 20_000,
      outstandingCents: 20_000,
      reservedCents: 0,
    });
  });

  it("applies a verified Payment Request webhook atomically and deduplicates it", async () => {
    const request = await remember(repository.createRequest({
      ...orderRequest(randomUUID(), 20_000),
      kind: "standalone",
      orderId: null,
    }));
    const claim = await repository.preflightAndClaimAttempt({
      publicTokenDigest: request.publicTokenDigest,
      provider: "stripe",
      method: "card",
      payerSnapshot: { fullName: "Payer", email: "payer@example.test", phone: "" },
    });
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: "pi_payment_request_webhook",
      returnStateDigest: "c".repeat(64),
      status: "processing",
    });
    const providerEventId = `evt_request_${randomUUID().replaceAll("-", "")}`;
    webhookEventIds.push(providerEventId);
    const input = {
      provider: "stripe" as const,
      providerEventId,
      payloadSha256: "d".repeat(64),
      result: {
        providerReference: "pi_payment_request_webhook",
        providerStatus: "succeeded",
        amountCents: 20_000,
        currency: "NZD" as const,
        merchantReference: request.requestNumber,
        status: "paid" as const,
      },
    };

    await expect(repository.applyVerifiedWebhookEventAtomically(input))
      .resolves.toBe("applied");
    await expect(repository.applyVerifiedWebhookEventAtomically(input))
      .resolves.toBe("duplicate");
    await expect(repository.applyVerifiedWebhookEventAtomically({
      ...input,
      payloadSha256: "e".repeat(64),
    })).resolves.toBe("hash_mismatch");
    const ledger = await database.select().from(paymentLedgerEntries)
      .where(eq(paymentLedgerEntries.paymentAttemptId, claim.attempt.id));
    expect(ledger).toHaveLength(1);
  });
});
