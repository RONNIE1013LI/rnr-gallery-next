import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: testDatabaseUrl });
const sessionIds: string[] = [];
const orderIds: string[] = [];
const suffix = randomUUID();

async function createOrder(label: string, totalInclGstCents = 7_475) {
  const session = await pool.query<{ id: string }>(
    `INSERT INTO checkout_sessions (token_digest, expires_at)
     VALUES ($1, now() + interval '1 hour') RETURNING id`,
    [`payment-${label}-${suffix}`],
  );
  const sessionId = session.rows[0].id;
  sessionIds.push(sessionId);

  const order = await pool.query<{ id: string }>(
    `INSERT INTO orders (
       order_number, checkout_session_id, checkout_session_version,
       idempotency_key, customer_email, delivery_method,
       shipping_service_code, shipping_service_name,
       product_subtotal_ex_gst_cents, product_gst_cents,
       product_total_incl_gst_cents, shipping_ex_gst_cents,
       shipping_gst_cents, shipping_total_incl_gst_cents,
       total_ex_gst_cents, total_gst_cents, total_incl_gst_cents
     ) VALUES ($1, $2, 1, $3, 'payment@example.test', 'pickup', 'pickup', 'Pickup',
       6500, 975, 7475, 0, 0, 0, 6500, 975, $4)
     RETURNING id`,
    [
      `RNR-${randomUUID()}`,
      sessionId,
      `payment-order-${label}-${suffix}`,
      totalInclGstCents,
    ],
  );
  const orderId = order.rows[0].id;
  orderIds.push(orderId);
  return orderId;
}

async function insertAttempt(input: {
  orderId: string;
  provider: string;
  method: string;
  idempotencyKey: string;
  expectedAmountCents?: number;
  currency?: string;
  country?: string;
  status?: string;
  providerReference?: string | null;
  providerSessionLeaseId?: string | null;
  providerSessionLeaseExpiresAt?: string | null;
  returnStateDigest?: string | null;
  returnStateConsumedAt?: string | null;
}) {
  return pool.query<{ id: string }>(
    `INSERT INTO payment_attempts (
       order_id, provider, method, idempotency_key, provider_reference,
       provider_session_lease_id, provider_session_lease_expires_at,
       return_state_digest, return_state_consumed_at,
       expected_amount_cents, currency, country, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.orderId,
      input.provider,
      input.method,
      input.idempotencyKey,
      input.providerReference ?? null,
      input.providerSessionLeaseId ?? null,
      input.providerSessionLeaseExpiresAt ?? null,
      input.returnStateDigest ?? null,
      input.returnStateConsumedAt ?? null,
      input.expectedAmountCents ?? 7_475,
      input.currency ?? "NZD",
      input.country ?? "NZ",
      input.status ?? "created",
    ],
  );
}

describe("payment schema database constraints", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM webhook_events
       WHERE payment_attempt_id IN (
         SELECT id FROM payment_attempts WHERE order_id = ANY($1::uuid[])
       )`,
      [orderIds],
    );
    await pool.query("DELETE FROM payment_attempts WHERE order_id = ANY($1::uuid[])", [
      orderIds,
    ]);
    await pool.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [orderIds]);
    await pool.query("DELETE FROM checkout_sessions WHERE id = ANY($1::uuid[])", [
      sessionIds,
    ]);
    await pool.end();
  });

  it("rejects duplicate provider idempotency keys", async () => {
    const firstOrder = await createOrder("idempotency-a");
    const secondOrder = await createOrder("idempotency-b");
    const key = `payment-key-${suffix}`;

    await insertAttempt({
      orderId: firstOrder,
      provider: "stripe",
      method: "card",
      idempotencyKey: key,
      status: "failed",
    });
    await expect(
      insertAttempt({
        orderId: secondOrder,
        provider: "stripe",
        method: "card",
        idempotencyKey: key,
        status: "failed",
      }),
    ).rejects.toThrow("payment_attempts_provider_idempotency_unique");
  });

  it("binds expected money to the immutable order amount and currency", async () => {
    const orderId = await createOrder("money");

    await expect(
      insertAttempt({
        orderId,
        provider: "stripe",
        method: "card",
        idempotencyKey: `wrong-money-${suffix}`,
        expectedAmountCents: 1,
      }),
    ).rejects.toThrow("payment_attempts_expected_order_amount_fk");

    await expect(
      insertAttempt({
        orderId,
        provider: "stripe",
        method: "card",
        idempotencyKey: `wrong-currency-${suffix}`,
        currency: "AUD",
      }),
    ).rejects.toThrow("payment_attempts_expected_order_amount_fk");
  });

  it("rejects unknown statuses before they can bypass the nonterminal index", async () => {
    const orderId = await createOrder("invalid-status");
    await insertAttempt({
      orderId,
      provider: "stripe",
      method: "card",
      idempotencyKey: `valid-status-${suffix}`,
    });

    await expect(
      insertAttempt({
        orderId,
        provider: "afterpay",
        method: "afterpay",
        idempotencyKey: `invalid-status-${suffix}`,
        status: "unknown",
      }),
    ).rejects.toThrow("payment_attempts_status_valid");
  });

  it("rejects unknown providers, methods, countries and invalid pairings", async () => {
    const invalidCases = [
      ["provider", { provider: "unknown", method: "card" }, "payment_attempts_provider_valid"],
      ["method", { provider: "stripe", method: "cash" }, "payment_attempts_method_valid"],
      ["pair", { provider: "stripe", method: "afterpay" }, "payment_attempts_provider_method_valid"],
      ["country", { provider: "stripe", method: "card", country: "US" }, "payment_attempts_country_valid"],
    ] as const;

    for (const [label, values, constraint] of invalidCases) {
      const orderId = await createOrder(`invalid-${label}`);
      await expect(
        insertAttempt({
          orderId,
          provider: values.provider,
          method: values.method,
          country: "country" in values ? values.country : "NZ",
          idempotencyKey: `invalid-${label}-${suffix}`,
        }),
      ).rejects.toThrow(constraint);
    }
  });

  it.each(["card", "afterpay", "zip"])(
    "allows local-test with the %s method",
    async (method) => {
      const orderId = await createOrder(`local-test-${method}`);
      await expect(
        insertAttempt({
          orderId,
          provider: "local-test",
          method,
          idempotencyKey: `local-test-${method}-${suffix}`,
        }),
      ).resolves.toMatchObject({ rowCount: 1 });
    },
  );

  it("requires provider lease fields to be both null or both present", async () => {
    const leaseIdOnlyOrder = await createOrder("lease-id-only");
    await expect(
      insertAttempt({
        orderId: leaseIdOnlyOrder,
        provider: "stripe",
        method: "card",
        idempotencyKey: `lease-id-only-${suffix}`,
        providerSessionLeaseId: randomUUID(),
      }),
    ).rejects.toThrow("payment_attempts_lease_pair_valid");

    const leaseExpiryOnlyOrder = await createOrder("lease-expiry-only");
    await expect(
      insertAttempt({
        orderId: leaseExpiryOnlyOrder,
        provider: "stripe",
        method: "card",
        idempotencyKey: `lease-expiry-only-${suffix}`,
        providerSessionLeaseExpiresAt: "2026-08-03T00:00:00Z",
      }),
    ).rejects.toThrow("payment_attempts_lease_pair_valid");
  });

  it("validates return-state digests and requires a digest before consumption", async () => {
    const invalidDigestOrder = await createOrder("invalid-return-digest");
    await expect(
      insertAttempt({
        orderId: invalidDigestOrder,
        provider: "afterpay",
        method: "afterpay",
        idempotencyKey: `invalid-return-digest-${suffix}`,
        returnStateDigest: "not-a-sha256",
      }),
    ).rejects.toThrow("payment_attempts_return_state_digest_format");

    const consumedWithoutDigestOrder = await createOrder("consumed-without-digest");
    await expect(
      insertAttempt({
        orderId: consumedWithoutDigestOrder,
        provider: "afterpay",
        method: "afterpay",
        idempotencyKey: `consumed-without-digest-${suffix}`,
        returnStateConsumedAt: "2026-08-03T00:00:00Z",
      }),
    ).rejects.toThrow("payment_attempts_return_state_consumption_valid");
  });

  it("allows only one nonterminal attempt per order across methods", async () => {
    const orderId = await createOrder("one-nonterminal");
    const first = await insertAttempt({
      orderId,
      provider: "stripe",
      method: "card",
      idempotencyKey: `card-${suffix}`,
    });

    await expect(
      insertAttempt({
        orderId,
        provider: "afterpay",
        method: "afterpay",
        idempotencyKey: `afterpay-${suffix}`,
        status: "processing",
      }),
    ).rejects.toThrow("payment_attempts_one_nonterminal_unique");

    await pool.query("UPDATE payment_attempts SET status = 'failed' WHERE id = $1", [
      first.rows[0].id,
    ]);
    await expect(
      insertAttempt({
        orderId,
        provider: "afterpay",
        method: "afterpay",
        idempotencyKey: `afterpay-retry-${suffix}`,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("enforces unique provider references when present", async () => {
    const firstOrder = await createOrder("provider-ref-a");
    const secondOrder = await createOrder("provider-ref-b");
    const providerReference = `pi-${suffix}`;

    await insertAttempt({
      orderId: firstOrder,
      provider: "stripe",
      method: "card",
      idempotencyKey: `provider-ref-a-${suffix}`,
      providerReference,
      status: "failed",
    });
    await expect(
      insertAttempt({
        orderId: secondOrder,
        provider: "stripe",
        method: "card",
        idempotencyKey: `provider-ref-b-${suffix}`,
        providerReference,
        status: "failed",
      }),
    ).rejects.toThrow("payment_attempts_provider_reference_unique");
  });

  it("deduplicates webhook events and validates their SHA-256", async () => {
    const orderId = await createOrder("webhook");
    const attempt = await insertAttempt({
      orderId,
      provider: "stripe",
      method: "card",
      idempotencyKey: `webhook-${suffix}`,
    });
    const eventId = `evt-${suffix}`;
    const hash = "a".repeat(64);

    await pool.query(
      `INSERT INTO webhook_events (
         provider, provider_event_id, payload_sha256, payment_attempt_id
       ) VALUES ('stripe', $1, $2, $3)`,
      [eventId, hash, attempt.rows[0].id],
    );
    await expect(
      pool.query(
        `INSERT INTO webhook_events (provider, provider_event_id, payload_sha256)
         VALUES ('stripe', $1, $2)`,
        [eventId, hash],
      ),
    ).rejects.toThrow("webhook_events_provider_event_unique");
    await expect(
      pool.query(
        `INSERT INTO webhook_events (provider, provider_event_id, payload_sha256)
         VALUES ('stripe', $1, 'not-a-sha256')`,
        [`bad-${eventId}`],
      ),
    ).rejects.toThrow("webhook_events_sha256_format");
  });

  it("validates webhook providers and processing-result pairs", async () => {
    const hash = "b".repeat(64);
    await expect(
      pool.query(
        `INSERT INTO webhook_events (provider, provider_event_id, payload_sha256)
         VALUES ('unknown', $1, $2)`,
        [`unknown-provider-${suffix}`, hash],
      ),
    ).rejects.toThrow("webhook_events_provider_valid");
    await expect(
      pool.query(
        `INSERT INTO webhook_events (
           provider, provider_event_id, payload_sha256, processing_result, processed_at
         ) VALUES ('stripe', $1, $2, 'unknown', now())`,
        [`unknown-result-${suffix}`, hash],
      ),
    ).rejects.toThrow("webhook_events_processing_result_valid");
    await expect(
      pool.query(
        `INSERT INTO webhook_events (
           provider, provider_event_id, payload_sha256, processing_result
         ) VALUES ('stripe', $1, $2, 'applied')`,
        [`result-only-${suffix}`, hash],
      ),
    ).rejects.toThrow("webhook_events_processing_pair_valid");
    await expect(
      pool.query(
        `INSERT INTO webhook_events (
           provider, provider_event_id, payload_sha256, processed_at
         ) VALUES ('stripe', $1, $2, now())`,
        [`processed-at-only-${suffix}`, hash],
      ),
    ).rejects.toThrow("webhook_events_processing_pair_valid");
  });
});
