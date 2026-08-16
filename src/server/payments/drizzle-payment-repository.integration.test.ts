import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { orderNotificationOutbox, orders, paymentAttempts, webhookEvents } from "@/server/db/schema";
import {
  PaymentRepositoryConflictError,
  PaymentVerificationMismatchError,
  createDrizzlePaymentRepository,
} from "./drizzle-payment-repository";
import { createPaymentService, PaymentServiceError } from "./payment-service";
import type { PaymentProviderRegistration } from "./provider-registry";
import type { CreateProviderSessionInput, PaymentProvider, ProviderSession } from "./types";

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

const nzPricingSnapshot = {
  schemaVersion: 1,
  market: "NZ",
  currency: "NZD",
  priceBookRevision: 0,
  taxJurisdiction: "NZ_GST",
  taxRateBasisPoints: 1_500,
  items: [],
  productSubtotalExTaxCents: 6_500,
  productTaxCents: 975,
  productTotalInclTaxCents: 7_475,
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
  taxAmountCents: 975,
  finalTotalCents: 7_475,
} as const;

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
      pricing_snapshot, payment_status
    ) values ($1, $2, 1, $3, $4, 'payer@example.test', 'pickup',
      'pickup', 'Pickup', 6500, 975, 7475, 0, 0, 0, 6500, 975, 7475, $5, $6)
    returning id`,
    [
      orderNumber,
      sessionId,
      randomUUID(),
      customerId,
      JSON.stringify(nzPricingSnapshot),
      input.paymentStatus ?? "awaiting_payment",
    ],
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

function testRegistration(
  createOrReuse: (input: CreateProviderSessionInput) => ReturnType<PaymentProvider["createOrReuse"]>,
): PaymentProviderRegistration {
  return {
    method: "card",
    label: "Test card — no real payment",
    isTest: true,
    provider: {
      key: "local-test",
      method: "card",
      refundCapability: "unsupported",
      availability: async () => ({ available: true }),
      createOrReuse: vi.fn(createOrReuse),
      completeReturn: vi.fn(),
      retrieve: vi.fn(),
    },
  };
}

function paymentService(registration: PaymentProviderRegistration) {
  return createPaymentService({
    repository,
    checkoutAuthority: { findReviewedPaymentContext: vi.fn() },
    providers: [registration],
    returnBaseUrl: "http://127.0.0.1:3000",
    nodeEnv: "test",
  });
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

  it("returns the current payment only to the order owner", async () => {
    const owned = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(
      claimInput(owned.orderId),
    );
    const providerReference = `pi_${randomUUID().replaceAll("-", "")}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference,
      returnStateDigest: null,
      status: "processing",
    });

    await expect(repository.findCurrentPayment({
      kind: "guest",
      orderNumber: owned.orderNumber,
      tokenDigest: owned.tokenDigest,
    })).resolves.toMatchObject({
      attempt: {
        id: claim.attempt.id,
        providerReference,
        status: "processing",
      },
      order: { id: owned.orderId, orderNumber: owned.orderNumber },
    });
    await expect(repository.findCurrentPayment({
      kind: "guest",
      orderNumber: owned.orderNumber,
      tokenDigest: "wrong-token",
    })).resolves.toBeNull();
    await expect(repository.findCurrentPayment({
      kind: "customer",
      orderNumber: owned.orderNumber,
      customerId: "wrong-customer",
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

  it("recovers a timed-out provider session with one stable attempt, key and return state", async () => {
    const owned = await createOrder();
    const providerInputs: CreateProviderSessionInput[] = [];
    const registration = testRegistration(async (input) => {
      providerInputs.push(input);
      if (providerInputs.length === 1) throw new Error("provider timeout secret");
      return {
        kind: "test",
        provider: "local-test",
        method: "card",
        providerReference: "recovered-provider-reference",
        providerStatus: "TEST_REQUIRES_ACTION",
        url: input.returnUrl,
      };
    });
    const service = paymentService(registration);
    const owner = {
      kind: "guest" as const,
      orderNumber: owned.orderNumber,
      tokenDigest: owned.tokenDigest,
    };

    await expect(service.start(owner, "card", randomUUID()))
      .rejects.toEqual(new PaymentServiceError(
        "PAYMENT_UNAVAILABLE",
        "Payment could not be started",
      ));
    const [afterTimeout] = await database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owned.orderId));
    expect(afterTimeout).toMatchObject({
      status: "created",
      providerReference: null,
      returnStateDigest: null,
    });

    await expect(service.start(owner, "card", randomUUID())).resolves.toMatchObject({
      payment: { status: "created" },
      action: null,
    });
    expect(providerInputs).toHaveLength(1);

    await pool.query(
      "update payment_attempts set provider_session_lease_expires_at = clock_timestamp() - interval '1 second' where id = $1",
      [afterTimeout.id],
    );
    await expect(service.start(owner, "card", randomUUID())).resolves.toMatchObject({
      payment: { status: "requires_action" },
      action: { kind: "test" },
    });
    expect(providerInputs).toHaveLength(2);
    expect(providerInputs[1].attemptId).toBe(providerInputs[0].attemptId);
    expect(providerInputs[1].idempotencyKey).toBe(providerInputs[0].idempotencyKey);
    expect(providerInputs[1].returnState).toBe(providerInputs[0].returnState);
    const [recovered] = await database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.id, afterTimeout.id));
    expect(recovered).toMatchObject({
      providerReference: "recovered-provider-reference",
      returnStateDigest: createHash("sha256")
        .update(providerInputs[0].returnState)
        .digest("hex"),
    });
  });

  it.each([
    { name: "Afterpay redirect", method: "afterpay" as const, providerKey: "afterpay" as const },
    { name: "Stripe Elements", method: "card" as const, providerKey: "stripe" as const },
  ])("rehydrates a bound $name action after the first response is lost", async ({ method, providerKey }) => {
    const owned = await createOrder();
    const providerInputs: CreateProviderSessionInput[] = [];
    const providerReference = `${providerKey}-${randomUUID()}`;
    const provider: PaymentProvider = {
      key: providerKey,
      method,
      refundCapability: "unsupported",
      availability: async () => ({ available: true }),
      createOrReuse: vi.fn(async (input): Promise<ProviderSession> => {
        providerInputs.push(input);
        if (providerKey === "stripe") {
          return {
            kind: "elements",
            provider: "stripe",
            method: "card",
            providerReference,
            providerStatus: "requires_payment_method",
            clientSecret: `secret-${input.attemptId}`,
            returnUrl: input.returnUrl,
          };
        }
        return {
          kind: "redirect",
          provider: "afterpay",
          method: "afterpay",
          providerReference,
          providerStatus: "CREATED",
          redirectUrl: `https://pay.example.test/${input.attemptId}`,
        };
      }),
      completeReturn: vi.fn(),
      retrieve: vi.fn(),
    };
    const service = createPaymentService({
      repository,
      checkoutAuthority: { findReviewedPaymentContext: vi.fn() },
      providers: [{ method, label: method, isTest: false, provider }],
      returnBaseUrl: "https://shop.example.test",
      nodeEnv: "test",
    });
    const owner = {
      kind: "guest" as const,
      orderNumber: owned.orderNumber,
      tokenDigest: owned.tokenDigest,
    };
    const clientKey = randomUUID();

    const firstResponse = await service.start(owner, method, clientKey);
    const [firstAttempt] = await database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owned.orderId));
    const replayResponse = await service.start(owner, method, clientKey);
    const attempts = await database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, owned.orderId));

    expect(replayResponse).toEqual(firstResponse);
    expect(attempts).toEqual([firstAttempt]);
    expect(providerInputs).toHaveLength(2);
    expect(providerInputs[0].providerReference).toBeUndefined();
    expect(providerInputs[1]).toEqual({
      ...providerInputs[0],
      providerReference,
    });
    expect(firstAttempt).toMatchObject({
      provider: providerKey,
      method,
      providerReference,
      returnStateDigest: createHash("sha256")
        .update(providerInputs[0].returnState)
        .digest("hex"),
    });
  });

  it("starts a new attempt after failure and never claims or calls a provider for paid orders", async () => {
    const failedOrder = await createOrder();
    const providerInputs: CreateProviderSessionInput[] = [];
    const registration = testRegistration(async (input) => {
      providerInputs.push(input);
      return {
        kind: "test",
        provider: "local-test",
        method: "card",
        providerReference: `reference-${input.attemptId}`,
        providerStatus: "TEST_REQUIRES_ACTION",
        url: input.returnUrl,
      };
    });
    const service = paymentService(registration);
    const owner = {
      kind: "guest" as const,
      orderNumber: failedOrder.orderNumber,
      tokenDigest: failedOrder.tokenDigest,
    };
    await service.start(owner, "card", randomUUID());
    const [first] = await database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, failedOrder.orderId));
    await repository.applyVerifiedResult({
      attemptId: first.id,
      source: "reconciliation",
      result: {
        providerReference: first.providerReference!,
        providerStatus: "TEST_FAILED",
        amountCents: 7_475,
        currency: "NZD",
        orderNumber: failedOrder.orderNumber,
        status: "failed",
        sanitizedFailureCode: "declined",
      },
    });
    await service.start(owner, "card", randomUUID());
    const afterFailure = await database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, failedOrder.orderId));
    expect(afterFailure).toHaveLength(2);
    expect(new Set(afterFailure.map(({ id }) => id)).size).toBe(2);
    expect(providerInputs).toHaveLength(2);
    expect(providerInputs[1].attemptId).not.toBe(providerInputs[0].attemptId);
    expect(providerInputs[1].returnState).not.toBe(providerInputs[0].returnState);

    const paid = await createOrder({ paymentStatus: "paid" });
    const paidRegistration = testRegistration(async () => {
      throw new Error("must not be called");
    });
    const paidService = paymentService(paidRegistration);
    await expect(paidService.start({
      kind: "guest",
      orderNumber: paid.orderNumber,
      tokenDigest: paid.tokenDigest,
    }, "card", randomUUID())).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect(paidRegistration.provider.createOrReuse).not.toHaveBeenCalled();
    await expect(database.select().from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, paid.orderId))).resolves.toHaveLength(0);
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
    const firstReference = `afterpay-${randomUUID()}`;
    const secondReference = `afterpay-${randomUUID()}`;
    const settled = await Promise.allSettled([
      repository.bindProviderSession({
        attemptId: first.attempt.id, claimId: first.claimId!,
        providerReference: firstReference, returnStateDigest: digest,
        status: "requires_action",
      }),
      repository.bindProviderSession({
        attemptId: second.attempt.id, claimId: second.claimId!,
        providerReference: secondReference, returnStateDigest: digest,
        status: "requires_action",
      }),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);

    const winner = settled[0].status === "fulfilled"
      ? { order: firstOrder, reference: firstReference, attempt: first.attempt }
      : { order: secondOrder, reference: secondReference, attempt: second.attempt };

    for (const invalid of [
      { provider: "stripe" as const },
      { method: "card" as const },
      { digest: "c".repeat(64) },
      { orderNumber: "RNR-PAY-NOT-THIS-ORDER" },
      { providerReference: "afterpay-wrong-reference" },
    ]) {
      await expect(repository.consumeReturnState({
        provider: "afterpay",
        method: "afterpay",
        digest,
        orderNumber: winner.order.orderNumber,
        providerReference: winner.reference,
        ...invalid,
      })).resolves.toBeNull();
    }

    const consumed = await Promise.all([
      repository.consumeReturnState({
        provider: "afterpay", method: "afterpay", digest,
        orderNumber: winner.order.orderNumber,
        providerReference: winner.reference,
      }),
      repository.consumeReturnState({
        provider: "afterpay", method: "afterpay", digest,
        orderNumber: winner.order.orderNumber,
        providerReference: winner.reference,
      }),
    ]);
    expect(consumed.map((value) => value?.outcome).sort())
      .toEqual(["already_consumed", "consumed"]);
    expect(consumed.find((value) => value?.outcome === "consumed")).toMatchObject({
      attempt: {
        id: winner.attempt.id,
        providerReference: winner.reference,
        idempotencyKey: winner.attempt.idempotencyKey,
        createdAt: winner.attempt.createdAt,
      },
      order: { orderNumber: winner.order.orderNumber },
    });

    const afterRestart = createDrizzlePaymentRepository(database);
    await expect(afterRestart.consumeReturnState({
      provider: "afterpay", method: "afterpay", digest,
      orderNumber: winner.order.orderNumber,
      providerReference: winner.reference,
    })).resolves.toEqual({
      outcome: "already_consumed",
      orderNumber: winner.order.orderNumber,
    });
  });

  it("rejects an expired return state under the attempt row lock", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(
      order.orderId,
      { provider: "afterpay", method: "afterpay" },
    ));
    const digest = "7".repeat(64);
    const providerReference = `afterpay-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference,
      returnStateDigest: digest,
      status: "requires_action",
    });
    await pool.query(
      "update payment_attempts set created_at = clock_timestamp() - interval '24 hours 1 second' where id = $1",
      [claim.attempt.id],
    );

    await expect(repository.consumeReturnState({
      provider: "afterpay",
      method: "afterpay",
      digest,
      orderNumber: order.orderNumber,
      providerReference,
    })).resolves.toBeNull();
    const [{ returnStateConsumedAt }] = await database
      .select({ returnStateConsumedAt: paymentAttempts.returnStateConsumedAt })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, claim.attempt.id));
    expect(returnStateConsumedAt).toBeNull();
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
    await expect(database.select().from(orderNotificationOutbox)
      .where(eq(orderNotificationOutbox.orderId, order.orderId))).resolves.toEqual([
      expect.objectContaining({
        eventKey: `payment-confirmed:${order.orderId}`,
        kind: "payment_confirmed",
        recipientEmail: "payer@example.test",
        status: "pending",
      }),
    ]);
    const paidBefore = await paymentRows(order.orderId, claim.attempt.id);
    await repository.applyVerifiedResult({
      attemptId: claim.attempt.id,
      result: { ...result, status: "failed", sanitizedFailureCode: "stale" },
      source: "reconciliation",
    });
    await expect(paymentRows(order.orderId, claim.attempt.id)).resolves.toEqual(paidBefore);
    await expect(repository.applyVerifiedResult({
      attemptId: claim.attempt.id,
      result: { ...result, providerStatus: "refunded", status: "refunded" },
      source: "reconciliation",
    })).resolves.toMatchObject({
      order: { paymentStatus: "refunded" },
      attempt: { status: "paid" },
    });

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

  it("locates the attempt only from verified provider authority and rejects all mismatches", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    const reference = `authority-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: reference,
      returnStateDigest: null,
      status: "processing",
    });
    const baseInput = {
      provider: "stripe" as const,
      providerEventId: `authority-event-${randomUUID()}`,
      payloadSha256: "f".repeat(64),
      result: {
        providerReference: reference,
        providerStatus: "succeeded",
        amountCents: 7_475,
        currency: "NZD" as const,
        orderNumber: order.orderNumber,
        status: "paid" as const,
      },
    };

    for (const [index, mismatch] of [
      { providerReference: `missing-${randomUUID()}` },
      { amountCents: 1 },
      { currency: "AUD" as const },
      { orderNumber: "RNR-WRONG" },
    ].entries()) {
      await expect(repository.applyVerifiedWebhookEventAtomically({
        ...baseInput,
        providerEventId: `${baseInput.providerEventId}-${index}`,
        result: { ...baseInput.result, ...mismatch },
      })).rejects.toBeInstanceOf(PaymentVerificationMismatchError);
      expect(await database.select().from(webhookEvents)
        .where(eq(webhookEvents.providerEventId, `${baseInput.providerEventId}-${index}`)))
        .toHaveLength(0);
    }
    const before = await paymentRows(order.orderId, claim.attempt.id);
    await expect(repository.applyVerifiedWebhookEventAtomically({
      ...baseInput,
      provider: "afterpay",
      providerEventId: `${baseInput.providerEventId}-provider`,
    })).rejects.toBeInstanceOf(PaymentVerificationMismatchError);
    await expect(paymentRows(order.orderId, claim.attempt.id)).resolves.toEqual(before);
  });

  it("keeps a paid attempt and order paid when a later verified failure arrives", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    const reference = `monotonic-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: reference,
      returnStateDigest: null,
      status: "processing",
    });
    const input = {
      provider: "stripe" as const,
      providerEventId: `paid-${randomUUID()}`,
      payloadSha256: "1".repeat(64),
      result: {
        providerReference: reference,
        providerStatus: "succeeded",
        amountCents: 7_475,
        currency: "NZD" as const,
        orderNumber: order.orderNumber,
        status: "paid" as const,
      },
    };
    await expect(repository.applyVerifiedWebhookEventAtomically(input)).resolves.toBe("applied");
    const paid = await paymentRows(order.orderId, claim.attempt.id);

    await expect(repository.applyVerifiedWebhookEventAtomically({
      ...input,
      providerEventId: `failed-${randomUUID()}`,
      payloadSha256: "2".repeat(64),
      result: {
        ...input.result,
        providerStatus: "requires_payment_method",
        status: "failed",
        sanitizedFailureCode: "payment_method_required",
      },
    })).resolves.toBe("applied");
    await expect(paymentRows(order.orderId, claim.attempt.id)).resolves.toEqual(paid);
  });

  it("atomically claims only stale valid reconciliation candidates once", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    await repository.bindProviderSession({
      attemptId: claim.attempt.id, claimId: claim.claimId!,
      providerReference: `reconcile-${randomUUID()}`, returnStateDigest: null,
      status: "processing",
    });

    await pool.query(
      "update payment_attempts set updated_at = now() - interval '2 minutes' where id = $1",
      [claim.attempt.id],
    );
    const claimCandidates = (repository as unknown as {
      claimReconciliationCandidates(limit: number): Promise<readonly unknown[]>;
    }).claimReconciliationCandidates.bind(repository);
    const [candidates, concurrentCandidates] = await Promise.all([
      claimCandidates(50),
      claimCandidates(50),
    ]);
    const targetClaims = [candidates, concurrentCandidates].map((batch) =>
      batch.filter((candidate) => (
        candidate as { attempt?: { id?: string } }
      ).attempt?.id === claim.attempt.id)
    );
    expect(targetClaims.flat()).toEqual([
      expect.objectContaining({
        attempt: expect.objectContaining({ id: claim.attempt.id }),
        claimId: expect.any(String),
      }),
    ]);
    expect(targetClaims.map((batch) => batch.length).sort()).toEqual([0, 1]);
    await expect(claimCandidates(0)).rejects.toThrow(
      "Reconciliation limit must be an integer from 1 to 50",
    );
  });

  it("excludes terminal orders and unsupported NZD Zip attempts from reconciliation", async () => {
    const terminalOrder = await createOrder({ paymentStatus: "failed" });
    const terminalClaim = await repository.createOrClaimNonterminalAttempt(
      claimInput(terminalOrder.orderId),
    );
    await repository.bindProviderSession({
      attemptId: terminalClaim.attempt.id,
      claimId: terminalClaim.claimId!,
      providerReference: `terminal-${randomUUID()}`,
      returnStateDigest: null,
      status: "processing",
    });

    const zipOrder = await createOrder();
    const zipClaim = await repository.createOrClaimNonterminalAttempt({
      orderId: zipOrder.orderId,
      provider: "zip",
      method: "zip",
      expectedAmountCents: 7_475,
      currency: "NZD",
      clientKey: randomUUID(),
    });
    await repository.bindProviderSession({
      attemptId: zipClaim.attempt.id,
      claimId: zipClaim.claimId!,
      providerReference: `zip-${randomUUID()}`,
      returnStateDigest: null,
      status: "processing",
    });
    await pool.query(
      "update payment_attempts set updated_at = now() - interval '2 minutes' where id = any($1::uuid[])",
      [[terminalClaim.attempt.id, zipClaim.attempt.id]],
    );

    const candidates = await repository.claimReconciliationCandidates(50);

    expect(candidates.map(({ attempt: candidate }) => candidate.id))
      .not.toEqual(expect.arrayContaining([terminalClaim.attempt.id, zipClaim.attempt.id]));
  });

  it("rejects a stale reconciliation result after a webhook has already paid the order", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    const providerReference = `paid-race-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference,
      returnStateDigest: null,
      status: "processing",
    });
    await pool.query(
      "update payment_attempts set updated_at = now() - interval '2 minutes' where id = $1",
      [claim.attempt.id],
    );
    const [candidate] = await repository.claimReconciliationCandidates(50);
    expect(candidate.attempt.id).toBe(claim.attempt.id);
    const paidResult = {
      providerReference,
      providerStatus: "succeeded",
      amountCents: 7_475,
      currency: "NZD" as const,
      orderNumber: order.orderNumber,
      status: "paid" as const,
    };
    await repository.applyVerifiedWebhookEventAtomically({
      provider: "stripe",
      providerEventId: `paid-race-${randomUUID()}`,
      payloadSha256: "9".repeat(64),
      result: paidResult,
    });

    await expect(repository.applyReconciliationResult({
      attemptId: claim.attempt.id,
      claimId: candidate.claimId,
      result: {
        ...paidResult,
        providerStatus: "requires_payment_method",
        status: "failed",
        sanitizedFailureCode: "payment_method_required",
      },
    })).rejects.toThrow("Reconciliation claim expired");
    await expect(paymentRows(order.orderId, claim.attempt.id)).resolves.toMatchObject({
      order: { paymentStatus: "paid" },
      attempt: { status: "paid" },
    });
  });

  it("allows only one concurrent worker to retrieve the same claimed attempt", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt({
      ...claimInput(order.orderId),
      provider: "local-test",
      method: "card",
    });
    const providerReference = `local-reconcile-${randomUUID()}`;
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference,
      returnStateDigest: null,
      status: "processing",
    });
    await pool.query(
      "update payment_attempts set updated_at = now() - interval '2 minutes' where id = $1",
      [claim.attempt.id],
    );
    let releaseRetrieve!: () => void;
    const retrievalGate = new Promise<void>((resolve) => {
      releaseRetrieve = resolve;
    });
    const retrieve = vi.fn().mockImplementation(async () => {
      await retrievalGate;
      return {
        kind: "verified" as const,
        result: {
          providerReference,
          providerStatus: "TEST_PROCESSING",
          amountCents: 7_475,
          currency: "NZD" as const,
          orderNumber: order.orderNumber,
          status: "processing" as const,
        },
      };
    });
    const registration: PaymentProviderRegistration = {
      method: "card",
      label: "Test card — no real payment",
      isTest: true,
      provider: {
        key: "local-test",
        method: "card",
        refundCapability: "unsupported",
        availability: vi.fn().mockResolvedValue({ available: true }),
        createOrReuse: vi.fn(),
        completeReturn: vi.fn(),
        retrieve,
      },
    };
    const firstWorker = paymentService(registration).reconcilePendingPayments();
    await vi.waitFor(() => expect(retrieve).toHaveBeenCalledOnce());

    await expect(paymentService(registration).reconcilePendingPayments()).resolves.toEqual({
      processed: 0,
      applied: 0,
      retried: 0,
      pending: 0,
      failed: 0,
    });
    expect(retrieve).toHaveBeenCalledOnce();

    releaseRetrieve();
    await expect(firstWorker).resolves.toMatchObject({ processed: 1, applied: 1 });
    expect(retrieve).toHaveBeenCalledOnce();
  });

  it("releases a nonterminal reconciliation claim and backs off after a safe failure", async () => {
    const order = await createOrder();
    const claim = await repository.createOrClaimNonterminalAttempt(claimInput(order.orderId));
    await repository.bindProviderSession({
      attemptId: claim.attempt.id,
      claimId: claim.claimId!,
      providerReference: `outcome-${randomUUID()}`,
      returnStateDigest: null,
      status: "processing",
    });
    await pool.query(
      "update payment_attempts set updated_at = now() - interval '2 minutes' where id = $1",
      [claim.attempt.id],
    );
    const [candidate] = await repository.claimReconciliationCandidates(1);

    await repository.recordReconciliationOutcome({
      attemptId: claim.attempt.id,
      claimId: candidate.claimId,
      code: "reconciliation_retrieval_unavailable",
    });

    await expect(paymentRows(order.orderId, claim.attempt.id)).resolves.toMatchObject({
      attempt: {
        status: "processing",
        sanitizedFailureCode: "reconciliation_retrieval_unavailable",
        providerSessionLeaseId: null,
        providerSessionLeaseExpiresAt: null,
      },
    });
    expect((await repository.claimReconciliationCandidates(1))
      .some(({ attempt: candidateAttempt }) => candidateAttempt.id === claim.attempt.id))
      .toBe(false);
  });
});
