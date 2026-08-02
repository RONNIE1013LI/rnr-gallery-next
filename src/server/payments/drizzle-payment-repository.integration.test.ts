import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orders, paymentAttempts, webhookEvents } from "@/server/db/schema";
import {
  PaymentRepositoryConflictError,
  PaymentVerificationMismatchError,
  createDrizzlePaymentRepository,
} from "./drizzle-payment-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const repository = createDrizzlePaymentRepository(database, {
  leaseDurationMs: 30_000,
});
const suffix = randomUUID();
const orderIds: string[] = [];
const sessionIds: string[] = [];
const customerIds: string[] = [];

async function createOrder(input: {
  owner?: "guest" | "customer";
  billingCountry?: "NZ" | "AU";
  deliveryCountry?: "NZ" | "AU";
  paymentStatus?: "awaiting_payment" | "processing" | "paid" | "failed" | "cancelled";
} = {}) {
  const owner = input.owner ?? "guest";
  const tokenDigest = `payment-owner-${randomUUID()}-${suffix}`;
  const customerId = owner === "customer" ? `payment-customer-${randomUUID()}` : null;
  if (customerId) {
    customerIds.push(customerId);
    await pool.query(
      "insert into \"user\" (id, name, email) values ($1, 'Payment Customer', $2)",
      [customerId, `${customerId}@example.test`],
    );
  }
  const session = await pool.query<{ id: string }>(
    `insert into checkout_sessions
      (token_digest, customer_id, expires_at, completed_at)
     values ($1, $2, now() + interval '1 day', now()) returning id`,
    [tokenDigest, customerId],
  );
  const sessionId = session.rows[0].id;
  sessionIds.push(sessionId);
  const orderNumber = `RNR-PAY-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const order = await pool.query<{ id: string }>(
    `insert into orders (
      order_number, checkout_session_id, checkout_session_version,
      idempotency_key, customer_id, customer_email, delivery_method,
      shipping_service_code, shipping_service_name,
      product_subtotal_ex_gst_cents, product_gst_cents,
      product_total_incl_gst_cents, shipping_ex_gst_cents,
      shipping_gst_cents, shipping_total_incl_gst_cents,
      total_ex_gst_cents, total_gst_cents, total_incl_gst_cents,
      payment_status
    ) values ($1, $2, 1, $3, $4, 'payer@example.test', 'pickup',
      'pickup', 'Pickup', 6500, 975, 7475, 0, 0, 0, 6500, 975, 7475, $5)
    returning id`,
    [orderNumber, sessionId, randomUUID(), customerId, input.paymentStatus ?? "awaiting_payment"],
  );
  const orderId = order.rows[0].id;
  orderIds.push(orderId);
  for (const [kind, country] of [
    ["billing", input.billingCountry ?? "NZ"],
    ["delivery", input.deliveryCountry ?? input.billingCountry ?? "NZ"],
  ] as const) {
    await pool.query(
      `insert into order_addresses
        (order_id, kind, country, full_name, building, street, suburb,
         region, postcode, phone, email)
       values ($1, $2, $3, 'Payment Customer', '', '1 Test Street',
         'Test Suburb', $4, $5, $6, 'payer@example.test')`,
      [
        orderId,
        kind,
        country,
        country === "NZ" ? "Auckland" : "NSW",
        country === "NZ" ? "1010" : "2000",
        country === "NZ" ? "+64210000000" : "+61400000000",
      ],
    );
  }
  return { orderId, orderNumber, tokenDigest, customerId };
}

function claimInput(
  orderId: string,
  override: Partial<{
    provider: "stripe" | "afterpay";
    method: "card" | "afterpay";
    clientKey: string;
  }> = {},
) {
  return {
    orderId,
    provider: override.provider ?? ("stripe" as const),
    method: override.method ?? ("card" as const),
    expectedAmountCents: 7_475,
    currency: "NZD" as const,
    clientKey: override.clientKey ?? randomUUID(),
  };
}

async function paymentRows(orderId: string, attemptId: string) {
  const [order] = await database.select().from(orders).where(eq(orders.id, orderId));
  const [attempt] = await database
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, attemptId));
  return { order, attempt };
}

describe("Drizzle payment repository", () => {
  beforeAll(async () => {
    await pool.query("select 1");
  });

  afterAll(async () => {
    await pool.query(
      "delete from webhook_events where payment_attempt_id in (select id from payment_attempts where order_id = any($1::uuid[]))",
      [orderIds],
    );
    await pool.query("delete from payment_attempts where order_id = any($1::uuid[])", [orderIds]);
    await pool.query("delete from orders where id = any($1::uuid[])", [orderIds]);
    await pool.query("delete from checkout_sessions where id = any($1::uuid[])", [sessionIds]);
    if (customerIds.length) {
      await pool.query("delete from \"user\" where id = any($1::text[])", [customerIds]);
    }
    await pool.end();
  });

  it("hydrates only the owning guest or customer and fails closed on damaged addresses", async () => {
    const guest = await createOrder();
    const customer = await createOrder({ owner: "customer", billingCountry: "AU" });

    await expect(repository.findPayableOrder({
      kind: "guest",
      orderNumber: guest.orderNumber,
      tokenDigest: guest.tokenDigest,
    })).resolves.toMatchObject({
      id: guest.orderId,
      billingAddress: { country: "NZ" },
      deliveryAddress: { country: "NZ" },
    });
    await expect(repository.findPayableOrder({
      kind: "guest",
      orderNumber: guest.orderNumber,
      tokenDigest: "wrong-token",
    })).resolves.toBeNull();
    await expect(repository.findPayableOrder({
      kind: "customer",
      orderNumber: customer.orderNumber,
      customerId: customer.customerId!,
    })).resolves.toMatchObject({ billingAddress: { country: "AU" } });
    await expect(repository.findPayableOrder({
      kind: "customer",
      orderNumber: customer.orderNumber,
      customerId: "wrong-customer",
    })).resolves.toBeNull();

    await pool.query(
      "update order_addresses set postcode = '' where order_id = $1 and kind = 'billing'",
      [guest.orderId],
    );
    await expect(repository.findPayableOrder({
      kind: "guest",
      orderNumber: guest.orderNumber,
      tokenDigest: guest.tokenDigest,
    })).resolves.toBeNull();

    const corruptOrder = await createOrder();
    await pool.query("update orders set customer_email = '' where id = $1", [
      corruptOrder.orderId,
    ]);
    await expect(repository.findPayableOrder({
      kind: "guest",
      orderNumber: corruptOrder.orderNumber,
      tokenDigest: corruptOrder.tokenDigest,
    })).resolves.toBeNull();

    const incomplete = await createOrder();
    await pool.query("update checkout_sessions set completed_at = null where id = $1", [
      sessionIds.at(-1),
    ]);
    await expect(repository.findPayableOrder({
      kind: "guest",
      orderNumber: incomplete.orderNumber,
      tokenDigest: incomplete.tokenDigest,
    })).resolves.toBeNull();

    const expired = await createOrder();
    await pool.query(
      "update checkout_sessions set expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [sessionIds.at(-1)],
    );
    await expect(repository.findPayableOrder({
      kind: "guest",
      orderNumber: expired.orderNumber,
      tokenDigest: expired.tokenDigest,
    })).resolves.toBeNull();
  });

  it("derives country from one valid delivery snapshot and rejects damaged snapshots", async () => {
    const australian = await createOrder({
      billingCountry: "AU",
      deliveryCountry: "AU",
    });
    const forged = { ...claimInput(australian.orderId), country: "NZ" as const };
    await expect(repository.createOrClaimNonterminalAttempt(forged)).resolves.toMatchObject({
      attempt: { country: "AU" },
    });

    const missing = await createOrder();
    await pool.query(
      "delete from order_addresses where order_id = $1 and kind = 'delivery'",
      [missing.orderId],
    );
    await expect(repository.createOrClaimNonterminalAttempt(claimInput(missing.orderId)))
      .rejects.toBeInstanceOf(PaymentRepositoryConflictError);
    await expect(database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, missing.orderId))).resolves.toHaveLength(0);

    const mismatch = await createOrder();
    const first = await repository.createOrClaimNonterminalAttempt(claimInput(mismatch.orderId));
    await pool.query(
      "update payment_attempts set country = 'AU', provider_session_lease_expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [first.attempt.id],
    );
    const before = await paymentRows(mismatch.orderId, first.attempt.id);
    await expect(repository.createOrClaimNonterminalAttempt(claimInput(mismatch.orderId)))
      .rejects.toBeInstanceOf(PaymentRepositoryConflictError);
    await expect(paymentRows(mismatch.orderId, first.attempt.id)).resolves.toEqual(before);
  });

  it("creates one attempt and one claim for same-method and cross-method concurrency", async () => {
    const same = await createOrder();
    const sameResults = await Promise.all([
      repository.createOrClaimNonterminalAttempt(claimInput(same.orderId)),
      repository.createOrClaimNonterminalAttempt(claimInput(same.orderId)),
    ]);
    expect(new Set(sameResults.map(({ attempt }) => attempt.id)).size).toBe(1);
    expect(sameResults.filter(({ claimId }) => claimId).length).toBe(1);
    expect(sameResults.map(({ outcome }) => outcome).sort()).toEqual(["claimed", "existing"]);

    const conflict = await createOrder();
    const results = await Promise.all([
      repository.createOrClaimNonterminalAttempt(claimInput(conflict.orderId, {
        provider: "stripe", method: "card", clientKey: randomUUID(),
      })),
      repository.createOrClaimNonterminalAttempt(claimInput(conflict.orderId, {
        provider: "afterpay", method: "afterpay", clientKey: randomUUID(),
      })),
    ]);
    expect(new Set(results.map(({ attempt }) => attempt.id)).size).toBe(1);
    expect(results.filter(({ claimId }) => claimId).length).toBe(1);
    expect(results.map(({ outcome }) => outcome).sort()).toEqual([
      "claimed",
      "existing_conflict",
    ]);
  });

  it("reclaims an expired lease on the same attempt with the same server key", async () => {
    const order = await createOrder();
    const first = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    await pool.query(
      "update payment_attempts set provider_session_lease_expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [first.attempt.id],
    );
    const reclaimed = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));

    expect(reclaimed).toMatchObject({ outcome: "claimed", attempt: { id: first.attempt.id } });
    expect(reclaimed.claimId).not.toBe(first.claimId);
    expect(reclaimed.attempt.idempotencyKey).toBe(first.attempt.idempotencyKey);
  });

  it("binds only the active claim, permits exact replay and rejects overwrite", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    const digest = "a".repeat(64);
    const input = {
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: `pi-${randomUUID()}`,
      returnStateDigest: digest,
      status: "requires_action" as const,
    };

    await expect(repository.bindProviderSession(input)).resolves.toMatchObject({
      providerReference: input.providerReference,
      returnStateDigest: digest,
    });
    await expect(repository.bindProviderSession(input)).resolves.toMatchObject({
      providerReference: input.providerReference,
    });
    await expect(repository.bindProviderSession({
      ...input,
      providerReference: "different-reference",
    })).rejects.toBeInstanceOf(PaymentRepositoryConflictError);
    await expect(repository.bindProviderSession({
      ...input,
      status: "processing",
    })).rejects.toBeInstanceOf(PaymentRepositoryConflictError);

    const guardedOrder = await createOrder();
    const guarded = await repository.createOrClaimNonterminalAttempt(
      claimInput(guardedOrder.orderId),
    );
    const wrongClaimBefore = await paymentRows(guardedOrder.orderId, guarded.attempt.id);
    await expect(repository.bindProviderSession({
      attemptId: guarded.attempt.id,
      claimId: randomUUID(),
      providerReference: `wrong-${randomUUID()}`,
      returnStateDigest: null,
      status: "processing",
    })).rejects.toBeInstanceOf(PaymentRepositoryConflictError);
    await expect(paymentRows(guardedOrder.orderId, guarded.attempt.id))
      .resolves.toEqual(wrongClaimBefore);

    await pool.query(
      "update payment_attempts set provider_session_lease_expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [guarded.attempt.id],
    );
    const expiredBefore = await paymentRows(guardedOrder.orderId, guarded.attempt.id);
    await expect(repository.bindProviderSession({
      attemptId: guarded.attempt.id,
      claimId: guarded.claimId!,
      providerReference: `expired-${randomUUID()}`,
      returnStateDigest: null,
      status: "processing",
    })).rejects.toBeInstanceOf(PaymentRepositoryConflictError);
    await expect(paymentRows(guardedOrder.orderId, guarded.attempt.id))
      .resolves.toEqual(expiredBefore);
  });

  it("enforces unique return state during concurrent binds and consumes it once", async () => {
    const firstOrder = await createOrder();
    const secondOrder = await createOrder();
    const [first, second] = await Promise.all([
      repository.createOrClaimNonterminalAttempt(claimInput(firstOrder.orderId, {
        provider: "afterpay", method: "afterpay",
      })),
      repository.createOrClaimNonterminalAttempt(claimInput(secondOrder.orderId, {
        provider: "afterpay", method: "afterpay",
      })),
    ]);
    const digest = "b".repeat(64);
    const settled = await Promise.allSettled([
      repository.bindProviderSession({
        attemptId: first.attempt.id, claimId: first.claimId!,
        providerReference: `afterpay-${randomUUID()}`, returnStateDigest: digest,
        status: "requires_action",
      }),
      repository.bindProviderSession({
        attemptId: second.attempt.id, claimId: second.claimId!,
        providerReference: `afterpay-${randomUUID()}`, returnStateDigest: digest,
        status: "requires_action",
      }),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);

    const consumed = await Promise.all([
      repository.consumeReturnState("afterpay", digest),
      repository.consumeReturnState("afterpay", digest),
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
  });

  it("applies verified money atomically and preserves terminal state exactly", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    const reference = `verified-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id, claimId: claim.claimId!, providerReference: reference,
      returnStateDigest: null, status: "processing",
    });
    const result = {
      providerReference: reference, providerStatus: "CAPTURED",
      amountCents: 7_475, currency: "NZD" as const,
      orderNumber: order.orderNumber, status: "paid" as const,
    };
    await expect(repository.applyVerifiedResult({
      attemptId: claim.attempt.id,
      result,
      source: "server_capture",
    })).resolves.toMatchObject({
      order: { paymentStatus: "paid" },
      attempt: { status: "paid" },
    });
    const paidBefore = await paymentRows(order.orderId, claim.attempt.id);
    await repository.applyVerifiedResult({
      attemptId: claim.attempt.id,
      result: { ...result, status: "failed", sanitizedFailureCode: "stale" },
      source: "reconciliation",
    });
    await expect(paymentRows(order.orderId, claim.attempt.id)).resolves.toEqual(paidBefore);

    const freshOrder = await createOrder();
    const freshClaim = await repository.createOrClaimNonterminalAttempt(
      claimInput(freshOrder.orderId),
    );
    const freshReference = `fresh-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: freshClaim.attempt.id,
      claimId: freshClaim.claimId!,
      providerReference: freshReference,
      returnStateDigest: null,
      status: "processing",
    });
    const freshBefore = await paymentRows(freshOrder.orderId, freshClaim.attempt.id);
    for (const mismatch of [
      { amountCents: 1 },
      { currency: "AUD" as const },
      { orderNumber: "wrong-order" },
      { providerReference: "wrong-reference" },
    ]) {
      await expect(repository.applyVerifiedResult({
        attemptId: freshClaim.attempt.id,
        result: {
          ...result,
          providerReference: freshReference,
          orderNumber: freshOrder.orderNumber,
          ...mismatch,
        },
        source: "server_capture",
      })).rejects.toBeInstanceOf(PaymentVerificationMismatchError);
      await expect(paymentRows(freshOrder.orderId, freshClaim.attempt.id))
        .resolves.toEqual(freshBefore);
    }

    const cancelledOrder = await createOrder({ paymentStatus: "cancelled" });
    const cancelledClaim = await repository.createOrClaimNonterminalAttempt(
      claimInput(cancelledOrder.orderId),
    );
    const cancelledReference = `cancelled-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: cancelledClaim.attempt.id,
      claimId: cancelledClaim.claimId!,
      providerReference: cancelledReference,
      returnStateDigest: null,
      status: "processing",
    });
    await expect(repository.applyVerifiedResult({
      attemptId: cancelledClaim.attempt.id,
      result: {
        ...result,
        providerReference: cancelledReference,
        orderNumber: cancelledOrder.orderNumber,
      },
      source: "reconciliation",
    })).resolves.toMatchObject({
      order: { paymentStatus: "paid" },
      attempt: { status: "paid" },
    });

    const refundedOrder = await createOrder({ paymentStatus: "processing" });
    const refundedClaim = await repository.createOrClaimNonterminalAttempt(
      claimInput(refundedOrder.orderId),
    );
    const refundedReference = `refunded-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: refundedClaim.attempt.id,
      claimId: refundedClaim.claimId!,
      providerReference: refundedReference,
      returnStateDigest: null,
      status: "processing",
    });
    await pool.query("update orders set payment_status = 'refunded' where id = $1", [
      refundedOrder.orderId,
    ]);
    const refundedBefore = await paymentRows(refundedOrder.orderId, refundedClaim.attempt.id);
    await repository.applyVerifiedResult({
      attemptId: refundedClaim.attempt.id,
      result: {
        ...result,
        providerReference: refundedReference,
        orderNumber: refundedOrder.orderNumber,
        status: "failed",
        sanitizedFailureCode: "stale-refund-failure",
      },
      source: "reconciliation",
    });
    await expect(paymentRows(refundedOrder.orderId, refundedClaim.attempt.id))
      .resolves.toEqual(refundedBefore);

    const sourceOrder = await createOrder();
    const sourceClaim = await repository.createOrClaimNonterminalAttempt(
      claimInput(sourceOrder.orderId),
    );
    const sourceReference = `source-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: sourceClaim.attempt.id,
      claimId: sourceClaim.claimId!,
      providerReference: sourceReference,
      returnStateDigest: null,
      status: "processing",
    });
    const sourceBefore = await paymentRows(sourceOrder.orderId, sourceClaim.attempt.id);
    await expect(repository.applyVerifiedResult({
      attemptId: sourceClaim.attempt.id,
      result: {
        ...result,
        providerReference: sourceReference,
        orderNumber: sourceOrder.orderNumber,
      },
    } as Parameters<typeof repository.applyVerifiedResult>[0]))
      .rejects.toBeInstanceOf(PaymentVerificationMismatchError);
    await expect(paymentRows(sourceOrder.orderId, sourceClaim.attempt.id))
      .resolves.toEqual(sourceBefore);
  });

  it.each(["after_event_insert", "after_transition", "before_processed_result"] as const)(
    "rolls back webhook fault at %s and permits replay",
    async (faultAt) => {
      const order = await createOrder();
      const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
      const reference = `webhook-${randomUUID()}`;
      await repository.bindProviderSession({
        attemptId: claim.attempt.id, claimId: claim.claimId!, providerReference: reference,
        returnStateDigest: null, status: "processing",
      });
      const input = {
        provider: "stripe" as const,
        providerEventId: `evt-${randomUUID()}`,
        payloadSha256: "c".repeat(64),
        attemptId: claim.attempt.id,
        result: {
          providerReference: reference, providerStatus: "CAPTURED",
          amountCents: 7_475, currency: "NZD" as const,
          orderNumber: order.orderNumber, status: "paid" as const,
        },
      };
      await expect(repository.applyVerifiedWebhookEventAtomically({ ...input, faultAt }))
        .rejects.toThrow("Injected payment repository fault");
      expect(await database.select().from(webhookEvents)
        .where(eq(webhookEvents.providerEventId, input.providerEventId))).toHaveLength(0);
      await expect(repository.applyVerifiedWebhookEventAtomically(input)).resolves.toBe("applied");
      await expect(repository.applyVerifiedWebhookEventAtomically(input)).resolves.toBe("duplicate");
      await expect(repository.applyVerifiedWebhookEventAtomically({
        ...input, payloadSha256: "d".repeat(64),
      })).resolves.toBe("hash_mismatch");
    },
  );

  it("recovers a committed duplicate-unprocessed webhook exactly once", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    const reference = `recover-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: reference,
      returnStateDigest: null,
      status: "processing",
    });
    const providerEventId = `recover-event-${randomUUID()}`;
    const payloadSha256 = "e".repeat(64);
    await database.insert(webhookEvents).values({
      provider: "stripe",
      providerEventId,
      payloadSha256,
      paymentAttemptId: claim.attempt.id,
    });
    const input = {
      provider: "stripe" as const,
      providerEventId,
      payloadSha256,
      attemptId: claim.attempt.id,
      result: {
        providerReference: reference,
        providerStatus: "CAPTURED",
        amountCents: 7_475,
        currency: "NZD" as const,
        orderNumber: order.orderNumber,
        status: "paid" as const,
      },
    };

    const outcomes = await Promise.all([
      repository.applyVerifiedWebhookEventAtomically(input),
      repository.applyVerifiedWebhookEventAtomically(input),
    ]);
    expect(outcomes.sort()).toEqual(["applied", "duplicate"]);

    const persisted = await paymentRows(order.orderId, claim.attempt.id);
    expect(persisted.order).toMatchObject({ paymentStatus: "paid" });
    expect(persisted.attempt).toMatchObject({
      status: "paid",
      providerReference: reference,
      sanitizedFailureCode: null,
      providerSessionLeaseId: null,
      providerSessionLeaseExpiresAt: null,
    });
    const [event] = await database
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, providerEventId));
    expect(event).toMatchObject({
      processingResult: "applied",
      paymentAttemptId: claim.attempt.id,
    });
    expect(event.processedAt).toBeInstanceOf(Date);
  });

  it("lists only stable valid reconciliation candidates within the bounded limit", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    await repository.bindProviderSession({
      attemptId: claim.attempt.id, claimId: claim.claimId!,
      providerReference: `reconcile-${randomUUID()}`, returnStateDigest: null,
      status: "processing",
    });

    const candidates = await repository.listReconciliationCandidates(50);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempt: expect.objectContaining({ id: claim.attempt.id }) }),
    ]));
    await expect(repository.listReconciliationCandidates(1)).resolves.toHaveLength(1);
    await expect(repository.listReconciliationCandidates(0)).rejects.toThrow(
      "Reconciliation limit must be an integer from 1 to 50",
    );
  });
});
