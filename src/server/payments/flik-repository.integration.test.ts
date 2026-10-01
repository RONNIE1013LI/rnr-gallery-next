import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { flikCheckoutSessions } from "@/server/db/schema/flik";
import { createDrizzleFlikRepository, type FlikSessionSnapshot } from "./flik-repository";
import type { VerifiedPaymentResult } from "./types";
import { createDrizzlePaymentRepository } from "./drizzle-payment-repository";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const target = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/rnr_gallery_test_flik(?:_|$)/.test(target.pathname)) {
  throw new Error("Flik integration tests require their own disposable local database");
}
const pool = new Pool({ connectionString: url });
const database = drizzle(pool);
const repository = createDrizzleFlikRepository(database);
const payments = createDrizzlePaymentRepository(database, { websiteAnalyticsV2Enabled: true, onNewInvoiceOrder: () => {} });
afterAll(() => pool.end());
function snapshot(): FlikSessionSnapshot {
  const id = randomUUID();
  return { id, paymentAttemptId: null, orderId: null, merchantReference: `TEST-${id}`, adminUserId: "fixture-admin",
    testMode: true, market: "NZ", billingCountry: "NZ", deliveryCountry: "NZ", currency: "NZD", expectedAmountCents: 100,
    idempotencyKey: id, returnUrl: `https://test.example.test/admin/payment?sessionId=${id}&state=${randomBytes(32).toString("hex")}`,
    webhookUrl: "https://test.example.test/api/payments/webhooks/flik" };
}
async function bind(input = snapshot()) {
  await repository.createOrGetSession(input);
  const claim = await repository.claimSessionCreation(input.id);
  expect(claim.claimId).toBeTruthy();
  return repository.bindSession({ id: input.id, claimId: claim.claimId!, providerReference: `cs_${randomUUID()}`,
    hostedUrl: `https://app.flik.co.nz/pay/${randomUUID()}`, expiresAt: new Date(Date.now() + 86_400_000) });
}
async function orderFixture(market = "NZ", currency = "NZD", country = "NZ") {
  const sessionId = randomUUID(), orderId = randomUUID(), reference = `RNR-PENDING-${randomUUID()}`;
  await pool.query(`INSERT INTO checkout_sessions (id,token_digest,expires_at,completed_at) VALUES ($1,$2,now()+interval '1 day',now())`, [sessionId, randomUUID()]);
  await pool.query(`INSERT INTO orders (id,order_number,payment_reference,checkout_session_id,checkout_session_version,idempotency_key,customer_email,
    market,currency,delivery_method,shipping_service_code,shipping_service_name,
    product_subtotal_ex_gst_cents,product_gst_cents,product_total_incl_gst_cents,shipping_ex_gst_cents,shipping_gst_cents,shipping_total_incl_gst_cents,
    total_ex_gst_cents,total_gst_cents,total_incl_gst_cents,pricing_snapshot)
    VALUES ($1,$2,$2,$3,1,$4,'fixture@example.test',$5,$6,'pickup','pickup','Pickup',100,0,100,0,0,0,100,0,100,'{}'::jsonb)`,
  [orderId, reference, sessionId, randomUUID(), market, currency]);
  for (const kind of ["billing", "delivery"]) await pool.query(`INSERT INTO order_addresses (order_id,kind,country,full_name,building,street,suburb,region,postcode,phone,email)
    VALUES ($1,$2,$3,'Fixture','','1 Test Street','Test',$4,$5,$6,'fixture@example.test')`,
  [orderId, kind, country, country === "NZ" ? "Auckland" : "NSW", country === "NZ" ? "1010" : "2000", country === "NZ" ? "+64210000000" : "+61400000000"]);
  await pool.query(`INSERT INTO order_items (checkout_session_id,order_id,position,client_item_id,product_key,product_slug,product_title,
    size_key,size_label,orientation,people_pets,photo_submission_method,design_text,notes,needed_date,urgent_service_confirmed,urgent_working_days,
    quantity,price_lines,upload_references,unit_subtotal_ex_gst_cents,unit_gst_cents,unit_total_incl_gst_cents,line_subtotal_ex_gst_cents,line_gst_cents,line_total_incl_gst_cents)
    VALUES ($1,$2,0,$3,'photo-print-canvas','photo-print-canvas','Fixture Canvas','a4','A4','landscape',0,'later','Test','','2026-10-31',false,10,1,'[]'::jsonb,'[]'::jsonb,100,0,100,100,0,100)`,
  [sessionId, orderId, randomUUID()]);
  return { orderId, reference };
}
async function sideEffectCounts() {
  const { rows } = await pool.query(`SELECT (SELECT count(*) FROM orders)::text AS orders,
    (SELECT count(*) FROM payment_attempts)::text AS attempts,
    (SELECT count(*) FROM production_jobs)::text AS jobs,
    (SELECT count(*) FROM order_notification_outbox)::text AS notifications,
    (SELECT count(*) FROM payment_ledger_entries)::text AS revenue,
    (SELECT current_value::text FROM business_number_counter WHERE key='order_job') AS counter`);
  return rows[0];
}

describe("Flik repository against disposable PostgreSQL", () => {
  it("atomically deduplicates concurrent creation and grants one creation lease", async () => {
    const input = snapshot();
    const rows = await Promise.all(Array.from({ length: 8 }, () => repository.createOrGetSession(input)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    const claims = await Promise.all(Array.from({ length: 8 }, () => repository.claimSessionCreation(input.id)));
    expect(claims.filter((claim) => claim.claimId)).toHaveLength(1);
    await expect(repository.createOrGetSession({ ...input, expectedAmountCents: 101 })).rejects.toThrow();
  });
  it("durably deduplicates concurrent callbacks and rejects hash conflicts", async () => {
    const row = await bind();
    const event = { transactionId: randomUUID(), checkoutSessionId: row.providerReference!, foreignTransactionId: row.id, payloadSha256: "a".repeat(64) };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => repository.receiveWebhook(event)));
    expect(outcomes.filter((outcome) => outcome === "accepted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "duplicate")).toHaveLength(7);
    await expect(repository.receiveWebhook({ ...event, payloadSha256: "b".repeat(64) })).resolves.toBe("conflict");
    expect((await repository.listPendingWebhooks(50)).some((pending) => pending.transactionId === event.transactionId)).toBe(true);
    await repository.markWebhookProcessed(event.transactionId);
    expect((await repository.listPendingWebhooks(50)).some((pending) => pending.transactionId === event.transactionId)).toBe(false);
  });
  it.each([{ market: "AU" }, { currency: "AUD" }, { billingCountry: "AU" }, { deliveryCountry: "AU" }, { expectedAmountCents: 0 }, { orderId: randomUUID() }, { paymentAttemptId: randomUUID() }])(
    "database constraints reject an unsafe test snapshot even when application validation is bypassed: %j", async (override) => {
      await expect(database.insert(flikCheckoutSessions).values({ ...snapshot(), ...override })).rejects.toThrow();
    },
  );
  it("test completion changes no commerce rows, fulfilment, notices, revenue or formal counter", async () => {
    const before = await sideEffectCounts();
    const row = await bind();
    await repository.updateVerifiedSession(row.id, row.providerReference!, "completed");
    await repository.markSessionApplied(row.id, row.providerReference!);
    await expect(repository.recoverLiveAttemptBinding(row.id)).rejects.toThrow();
    expect(await sideEffectCounts()).toEqual(before);
  });
  it("retains completed work for recovery until applied and never downgrades completion", async () => {
    const row = await bind();
    await repository.updateVerifiedSession(row.id, row.providerReference!, "completed");
    await repository.updateVerifiedSession(row.id, row.providerReference!, "failed");
    expect((await repository.findSession(row.id))?.providerStatus).toBe("completed");
    expect((await repository.listPendingSessions(50)).some((pending) => pending.id === row.id)).toBe(true);
    await repository.markSessionApplied(row.id, row.providerReference!);
    expect((await repository.listPendingSessions(50)).some((pending) => pending.id === row.id)).toBe(false);
  });
  it("accepts NZ/NZD and recovers a bound live session without marking the order paid", async () => {
    const order = await orderFixture();
    const claim = await payments.createOrClaimNonterminalAttempt({ orderId: order.orderId, provider: "flik", method: "flik", expectedAmountCents: 100, currency: "NZD" });
    const input = { ...snapshot(), id: claim.attempt.id, paymentAttemptId: claim.attempt.id, orderId: order.orderId,
      merchantReference: order.reference, adminUserId: null, testMode: false, idempotencyKey: claim.attempt.id };
    await expect(database.insert(flikCheckoutSessions).values({ ...input, expectedAmountCents: 101 })).rejects.toMatchObject({
      cause: { code: "23503", constraint: "flik_checkout_sessions_expected_order_amount_fk" },
    });
    const row = await bind(input);
    await repository.recoverLiveAttemptBinding(row.id);
    await repository.recoverLiveAttemptBinding(row.id);
    const { rows } = await pool.query(`SELECT p.provider_reference,p.status,o.payment_status,o.order_number FROM payment_attempts p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [row.id]);
    expect(rows[0]).toMatchObject({ provider_reference: row.providerReference, status: "requires_action", payment_status: "awaiting_payment", order_number: order.reference });
    const verified: VerifiedPaymentResult = {
      providerReference: row.providerReference!, providerStatus: "completed", amountCents: 100, currency: "NZD", orderNumber: order.reference,
      foreignTransactionId: row.id, testMode: false, status: "paid",
    };
    for (const mismatch of [{ testMode: true }, { foreignTransactionId: randomUUID() }, { amountCents: 101 }, { currency: "AUD" }, { orderNumber: "another-order" }] as Partial<VerifiedPaymentResult>[]) {
      await expect(payments.applyVerifiedResult({ attemptId: row.id, source: "reconciliation", result: { ...verified, ...mismatch } })).rejects.toThrow();
    }
  });
  it("concurrent live confirmations allocate one formal number, receipt, job and customer notification", async () => {
    const before = BigInt((await pool.query("SELECT current_value FROM business_number_counter WHERE key='order_job'")).rows[0].current_value);
    const order = await orderFixture();
    const claim = await payments.createOrClaimNonterminalAttempt({ orderId: order.orderId, provider: "flik", method: "flik", expectedAmountCents: 100, currency: "NZD" });
    const row = await bind({ ...snapshot(), id: claim.attempt.id, paymentAttemptId: claim.attempt.id, orderId: order.orderId,
      merchantReference: order.reference, adminUserId: null, testMode: false, idempotencyKey: claim.attempt.id });
    await repository.recoverLiveAttemptBinding(row.id);
    const result: VerifiedPaymentResult = { providerReference: row.providerReference!, providerStatus: "completed", amountCents: 100,
      currency: "NZD", orderNumber: order.reference, foreignTransactionId: row.id, testMode: false, status: "paid" };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => payments.applyVerifiedResult({ attemptId: row.id, source: "reconciliation", result })));
    expect(new Set(outcomes.map((outcome) => outcome.order.orderNumber)).size).toBe(1);
    const counts = await pool.query(`SELECT (SELECT count(*) FROM payment_ledger_entries WHERE order_id=$1 AND entry_type='online_payment')::int AS receipts,
      (SELECT count(*) FROM production_jobs WHERE order_id=$1)::int AS jobs,
      (SELECT count(*) FROM order_notification_outbox WHERE order_id=$1 AND kind='payment_confirmed')::int AS notices,
      (SELECT current_value FROM business_number_counter WHERE key='order_job') AS counter`, [order.orderId]);
    expect(counts.rows[0]).toMatchObject({ receipts: 1, jobs: 1, notices: 1 });
    expect(BigInt(counts.rows[0].counter)).toBe(before + BigInt(1));
  });
  it("recovers a new active attempt when a previous expired attempt left the order cancelled", async () => {
    const order = await orderFixture();
    const previous = await payments.createOrClaimNonterminalAttempt({ orderId: order.orderId, provider: "flik", method: "flik", expectedAmountCents: 100, currency: "NZD" });
    await pool.query("UPDATE payment_attempts SET status='cancelled' WHERE id=$1", [previous.attempt.id]);
    await pool.query("UPDATE orders SET payment_status='cancelled' WHERE id=$1", [order.orderId]);
    const next = await payments.createOrClaimNonterminalAttempt({ orderId: order.orderId, provider: "flik", method: "flik", expectedAmountCents: 100, currency: "NZD" });
    expect(next.attempt.id).not.toBe(previous.attempt.id);
    const row = await bind({ ...snapshot(), id: next.attempt.id, paymentAttemptId: next.attempt.id, orderId: order.orderId,
      merchantReference: order.reference, adminUserId: null, testMode: false, idempotencyKey: next.attempt.id });
    await repository.recoverLiveAttemptBinding(row.id);
    const result = await pool.query("SELECT provider_reference,status FROM payment_attempts WHERE id=$1", [row.id]);
    expect(result.rows[0]).toMatchObject({ provider_reference: row.providerReference, status: "requires_action" });
  });
  it.each([["AU", "AUD", "AU"], ["AU", "NZD", "NZ"], ["NZ", "AUD", "NZ"], ["NZ", "NZD", "AU"]])(
    "database or server rejects conflicting order market/currency/country %s/%s/%s", async (market, currency, country) => {
      if ((market === "NZ") !== (currency === "NZD")) {
        await expect(orderFixture(market, currency, country)).rejects.toMatchObject({ code: "23514", constraint: "orders_market_currency_match" });
        return;
      }
      const order = await orderFixture(market, currency, country);
      await expect(payments.createOrClaimNonterminalAttempt({ orderId: order.orderId, provider: "flik", method: "flik", expectedAmountCents: 100, currency: currency as "NZD" | "AUD" })).rejects.toThrow();
    },
  );
  it("leaves Flik to its dedicated worker while generic reconciliation still claims Stripe and Afterpay", async () => {
    const ids = new Map<string, string>();
    for (const [provider, method] of [["flik", "flik"], ["stripe", "card"], ["afterpay", "afterpay"]] as const) {
      const order = await orderFixture();
      const claim = await payments.createOrClaimNonterminalAttempt({ orderId: order.orderId, provider, method, expectedAmountCents: 100, currency: "NZD" });
      await payments.bindProviderSession({ attemptId: claim.attempt.id, claimId: claim.claimId!,
        providerReference: `${provider}_${randomUUID()}`, returnStateDigest: randomBytes(32).toString("hex"), status: "requires_action" });
      ids.set(provider, claim.attempt.id);
    }
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '2 minutes' WHERE id=ANY($1::uuid[])", [[...ids.values()]]);
    const candidates = await payments.claimReconciliationCandidates(50);
    const claimed = candidates.map((candidate) => candidate.attempt.id);
    expect(claimed).toContain(ids.get("stripe"));
    expect(claimed).toContain(ids.get("afterpay"));
    expect(claimed).not.toContain(ids.get("flik"));
    expect(candidates.every((candidate) => candidate.attempt.provider !== "flik")).toBe(true);
    const { rows } = await pool.query("SELECT status,sanitized_failure_code,provider_session_lease_id FROM payment_attempts WHERE id=$1", [ids.get("flik")]);
    expect(rows[0]).toEqual({ status: "requires_action", sanitized_failure_code: null, provider_session_lease_id: null });
  });
  it("database refuses AU Flik attempts independently of service validation", async () => {
    const order = await orderFixture("AU", "AUD", "AU");
    await expect(pool.query(`INSERT INTO payment_attempts (order_id,provider,method,idempotency_key,expected_amount_cents,currency,country,status)
      VALUES ($1,'flik','flik',$2,100,'AUD','AU','created')`, [order.orderId, randomUUID()])).rejects.toThrow();
  });
});
