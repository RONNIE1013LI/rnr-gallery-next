import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createWisePayIdRepository } from "./wise-payid-repository";
import { createDrizzlePaymentRepository } from "./drizzle-payment-repository";
import { createWisePayIdWorker, wiseVerifiedResult } from "./wise-payid-reconciliation";
import type { WiseCredit } from "./wise-payid-matching";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const target = new URL(url);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/rnr_gallery_test_release_gate_[0-9a-f]{8}_wisepreflight_integration$/.test(target.pathname) ||
  ["host", "hostaddr", "service"].some((key) => target.searchParams.has(key))) throw new Error("Wise integration requires its own disposable local database");
const pool = new Pool({ connectionString: url, max: 16 });
const database = drizzle(pool);
const payments = createDrizzlePaymentRepository(database, { websiteAnalyticsV2Enabled: false, onNewInvoiceOrder: () => {} });
afterAll(() => pool.end());
let profile = Number.parseInt(randomUUID().slice(0, 8), 16);
async function fixture(account = { profileId: ++profile, balanceId: 222 }) {
  const sessionId = randomUUID(), orderId = randomUUID(), reference = `RNR-PENDING-${randomUUID()}`;
  await pool.query(`INSERT INTO checkout_sessions (id,token_digest,expires_at,completed_at) VALUES ($1,$2,now()+interval '1 day',now())`, [sessionId, randomUUID()]);
  await pool.query(`INSERT INTO orders (id,order_number,payment_reference,checkout_session_id,checkout_session_version,idempotency_key,customer_email,
    market,currency,delivery_method,shipping_service_code,shipping_service_name,
    product_subtotal_ex_gst_cents,product_gst_cents,product_total_incl_gst_cents,shipping_ex_gst_cents,shipping_gst_cents,shipping_total_incl_gst_cents,
    total_ex_gst_cents,total_gst_cents,total_incl_gst_cents,pricing_snapshot)
    VALUES ($1,$2,$2,$3,1,$4,'fixture@example.test','AU','AUD','pickup','pickup','Pickup',100,0,100,0,0,0,100,0,100,'{}'::jsonb)`,
  [orderId, reference, sessionId, randomUUID()]);
  for (const kind of ["billing", "delivery"]) await pool.query(`INSERT INTO order_addresses (order_id,kind,country,full_name,building,street,suburb,region,postcode,phone,email)
    VALUES ($1,$2,'AU','Fixture','','1 Test Street','Test','NSW','2000','+61400000000','fixture@example.test')`, [orderId, kind]);
  await pool.query(`INSERT INTO order_items (checkout_session_id,order_id,position,client_item_id,product_key,product_slug,product_title,
    size_key,size_label,orientation,people_pets,photo_submission_method,design_text,notes,needed_date,urgent_service_confirmed,urgent_working_days,
    quantity,price_lines,upload_references,unit_subtotal_ex_gst_cents,unit_gst_cents,unit_total_incl_gst_cents,line_subtotal_ex_gst_cents,line_gst_cents,line_total_incl_gst_cents)
    VALUES ($1,$2,0,$3,'photo-print-canvas','photo-print-canvas','Fixture Canvas','a4','A4','landscape',0,'later','Test','','2026-12-31',false,10,1,'[]'::jsonb,'[]'::jsonb,100,0,100,100,0,100)`, [sessionId, orderId, randomUUID()]);
  const claim = await payments.createOrClaimNonterminalAttempt({ orderId, provider: "wise", method: "payid", expectedAmountCents: 100, currency: "AUD" });
  const repository = createWisePayIdRepository(database, account);
  const input = { id: claim.attempt.id, orderId, amountCents: 100, merchantReference: reference };
  const intent = await repository.createIntent(input);
  await payments.bindProviderSession({ attemptId: claim.attempt.id, claimId: claim.claimId!, providerReference: intent.reference, returnStateDigest: createHash("sha256").update(randomUUID()).digest("hex"), status: "requires_action" });
  return { account, orderId, reference, repository, intent, input };
}
function credit(reference: string | null, change: Partial<WiseCredit> = {}): WiseCredit {
  const row = { transactionId: `TRANSFER-${randomUUID()}`, amountCents: 100, currency: "AUD", reference, payerName: "Fixture payer", receivedAt: new Date(), eligible: true, isCredit: true, ...change };
  return { ...row, digest: createHash("sha256").update(JSON.stringify(row)).digest("hex") };
}
async function imported(f: Awaited<ReturnType<typeof fixture>>, incoming = credit(f.intent.reference)) {
  await f.repository.ingest([incoming]);
  const result = await pool.query("select * from wise_payid_receipts where profile_id=$1 and balance_id=$2 and transaction_id=$3", [f.account.profileId, f.account.balanceId, incoming.transactionId]);
  return result.rows[0] as { id: string; digest: string };
}
async function effects(orderId: string) {
  const { rows } = await pool.query(`SELECT (SELECT payment_status FROM orders WHERE id=$1) AS status,
    (SELECT order_number FROM orders WHERE id=$1) AS number,
    (SELECT count(*) FROM payment_ledger_entries WHERE order_id=$1 AND entry_type='online_payment')::int AS ledger,
    (SELECT count(*) FROM production_jobs WHERE order_id=$1)::int AS jobs,
    (SELECT count(*) FROM order_notification_outbox WHERE order_id=$1 AND kind='payment_confirmed')::int AS notices`, [orderId]);
  return rows[0];
}
async function counter() { return BigInt((await pool.query("select current_value from business_number_counter where key='order_job'")).rows[0].current_value); }
async function binding(f: Awaited<ReturnType<typeof fixture>>) {
  const row = await imported(f);
  const result = await f.repository.reserve(row.id);
  if (!result) throw new Error("Fixture reservation failed");
  return result;
}

describe("Wise AUD PayID against disposable PostgreSQL", () => {
  it("deduplicates concurrent intent creation without admitting unpaid orders", async () => {
    const f = await fixture();
    const rows = await Promise.all(Array.from({ length: 12 }, () => f.repository.createIntent(f.input)));
    expect(new Set(rows.map((r) => r.reference)).size).toBe(1);
    expect((await pool.query("select count(*)::int as count from wise_payid_audit where intent_id=$1 and action='intent_created'", [f.intent.id])).rows[0].count).toBe(1);
    expect(await effects(f.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0, jobs: 0, notices: 0 });
  });
  it("deduplicates concurrent imports and grants one cross-worker poll slot", async () => {
    const f = await fixture(), incoming = credit(f.intent.reference);
    await Promise.all(Array.from({ length: 12 }, () => f.repository.ingest([incoming])));
    expect((await pool.query("select count(*)::int as count from wise_payid_receipts where profile_id=$1", [f.account.profileId])).rows[0].count).toBe(1);
    const slots = await Promise.all(Array.from({ length: 12 }, () => f.repository.claimPoll()));
    expect(slots.filter(Boolean)).toHaveLength(1);
    expect(await f.repository.claimPoll()).toBe(false);
  });
  it("lets a manual sync bypass the hourly schedule while blocking rapid duplicate clicks", async () => {
    const f = await fixture();
    expect(await f.repository.claimPoll()).toBe(true);
    expect(await f.repository.claimPoll()).toBe(false);
    await pool.query("update wise_payid_poll_state set last_started_at=clock_timestamp()-interval '31 seconds' where key=$1", [`${f.account.profileId}:${f.account.balanceId}`]);
    expect(await f.repository.claimPoll(true)).toBe(true);
    expect(await f.repository.claimPoll(true)).toBe(false);
  });
  it("confirms concurrent duplicate receipts exactly once with one formal number, ledger, job and notice", async () => {
    const f = await fixture(), saved = await binding(f), before = await counter();
    const results = await Promise.all(Array.from({ length: 12 }, () => payments.applyVerifiedResult(wiseVerifiedResult(saved))));
    expect(new Set(results.map((r) => r.order.orderNumber)).size).toBe(1);
    expect(await effects(f.orderId)).toMatchObject({ status: "paid", ledger: 1, jobs: 1, notices: 1 });
    expect(await counter()).toBe(before + BigInt(1));
    expect((await pool.query("select count(*)::int as count from wise_payid_audit where receipt_id=$1 and action='payment_applied'", [saved.receipt.id])).rows[0].count).toBe(1);
  });
  it("allocates distinct formal numbers for different orders confirmed concurrently", async () => {
    const fixtures = await Promise.all(Array.from({ length: 8 }, () => fixture()));
    const bindings = await Promise.all(fixtures.map(binding)), before = await counter();
    const results = await Promise.all(bindings.map((saved) => payments.applyVerifiedResult(wiseVerifiedResult(saved))));
    expect(new Set(results.map((r) => r.order.orderNumber)).size).toBe(8);
    expect(results.every((r) => /^\d{5,}$/.test(r.order.orderNumber))).toBe(true);
    expect(await counter()).toBe(before + BigInt(8));
  });
  it("holds both receipts when two transactions reuse an order reference", async () => {
    const f = await fixture();
    await f.repository.ingest([credit(f.intent.reference), credit(f.intent.reference)]);
    for (const row of await f.repository.candidates()) expect(await f.repository.reserve(row.id)).toBeNull();
    expect((await f.repository.reviewQueue()).receipts).toHaveLength(2);
    expect(await effects(f.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0, jobs: 0 });
  });
  it.each([{ amountCents: 101 }, { currency: "NZD" }, { reference: null }, { reference: "UNRECOGNISED" }, { receivedAt: new Date("2020-01-01T00:00:00Z") }])("keeps mismatched receipt %j unpaid and visible for review", async (change) => {
    const f = await fixture(), row = await imported(f, credit(f.intent.reference, change));
    expect(await f.repository.reserve(row.id)).toBeNull();
    expect((await f.repository.reviewQueue()).receipts.some((r) => r.id === row.id)).toBe(true);
    expect(await effects(f.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0, jobs: 0 });
  });
  it("prevents one allocated receipt from being reassigned to a second order", async () => {
    const f = await fixture(), other = await fixture(f.account), saved = await binding(f);
    await expect(f.repository.reserve(saved.receipt.id, { intentId: other.intent.id, actorId: "fixture-admin", reason: "Wrong order cannot be selected", expectedDigest: saved.receipt.digest })).rejects.toThrow();
    expect(await effects(other.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0 });
  });
  it("rejects a changed body for the same bank transaction without overwriting its evidence", async () => {
    const f = await fixture(), incoming = credit(f.intent.reference), row = await imported(f, incoming);
    await expect(f.repository.ingest([{ ...incoming, amountCents: 101, digest: "b".repeat(64) }])).rejects.toThrow();
    expect((await pool.query("select amount_cents,digest from wise_payid_receipts where id=$1", [row.id])).rows[0]).toMatchObject({ amount_cents: "100", digest: incoming.digest });
  });
  it("atomically rolls back receipt, number and order effects after a ledger failure, then safely retries", async () => {
    const f = await fixture(), saved = await binding(f), before = await counter();
    await pool.query(`CREATE FUNCTION wise_fixture_fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id = '${f.orderId}'::uuid THEN RAISE EXCEPTION 'wise_fixture_fault'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER wise_fixture_fail_ledger BEFORE INSERT ON payment_ledger_entries FOR EACH ROW EXECUTE FUNCTION wise_fixture_fail_ledger()");
    try {
      await expect(payments.applyVerifiedResult(wiseVerifiedResult(saved))).rejects.toThrow();
      expect(await effects(f.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0, jobs: 0, notices: 0, number: f.reference });
      expect(await counter()).toBe(before);
      expect((await pool.query("select status,applied_at from wise_payid_receipts where id=$1", [saved.receipt.id])).rows[0]).toEqual({ status: "reserved", applied_at: null });
    } finally {
      await pool.query("DROP TRIGGER wise_fixture_fail_ledger ON payment_ledger_entries");
      await pool.query("DROP FUNCTION wise_fixture_fail_ledger()");
    }
    await payments.applyVerifiedResult(wiseVerifiedResult(saved));
    expect(await effects(f.orderId)).toMatchObject({ status: "paid", ledger: 1, jobs: 1, notices: 1 });
    expect(await counter()).toBe(before + BigInt(1));
  });
  it("resumes an interrupted manual approval while new automatic matching remains disabled", async () => {
    const f = await fixture(), row = await imported(f, credit(null));
    expect(await f.repository.reserve(row.id)).toBeNull();
    await f.repository.reserve(row.id, { intentId: f.intent.id, actorId: "fixture-admin", reason: "Verified missing reference manually", expectedDigest: row.digest });
    expect((await f.repository.reviewQueue()).receipts.some((r) => r.status === "reserved")).toBe(true);
    const worker = createWisePayIdWorker({ config: { ...f.account, token: "fixture-unused", autoMatch: false }, repository: f.repository,
      client: { statement: async () => ({ query: { profileId: f.account.profileId, currency: "AUD" }, transactions: [] }) },
      apply: (input) => payments.applyVerifiedResult(input) });
    expect(await worker.run()).toMatchObject({ applied: 1, autoMatch: false });
    expect(await effects(f.orderId)).toMatchObject({ status: "paid", ledger: 1, jobs: 1, notices: 1 });
  });
  it("does not automatically reserve a matching receipt when auto matching is off", async () => {
    const f = await fixture(); await imported(f);
    const worker = createWisePayIdWorker({ config: { ...f.account, token: "fixture-unused", autoMatch: false }, repository: f.repository,
      client: { statement: async () => ({ query: { profileId: f.account.profileId, currency: "AUD" }, transactions: [] }) },
      apply: (input) => payments.applyVerifiedResult(input) });
    expect(await worker.run()).toMatchObject({ applied: 0, autoMatch: false });
    expect((await f.repository.reviewQueue()).receipts[0]).toMatchObject({ status: "review", reason: "automatic_confirmation_disabled", intentId: null });
    expect(await effects(f.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0 });
  });
  it.each(["cancelled_attempt", "cancelled_fulfilment", "manual_paid"])("rejects reserved receipt after %s changes before confirmation", async (change) => {
    const f = await fixture(), saved = await binding(f);
    if (change === "cancelled_attempt") await pool.query("update payment_attempts set status='cancelled' where id=$1", [f.intent.id]);
    if (change === "cancelled_fulfilment") await pool.query("update orders set fulfilment_status='cancelled' where id=$1", [f.orderId]);
    if (change === "manual_paid") await pool.query("update orders set payment_status='paid' where id=$1", [f.orderId]);
    await expect(payments.applyVerifiedResult(wiseVerifiedResult(saved))).rejects.toThrow();
    expect((await pool.query("select status from wise_payid_receipts where id=$1", [saved.receipt.id])).rows[0].status).toBe("reserved");
    expect(await effects(f.orderId)).toMatchObject({ ledger: 0, jobs: 0, notices: 0 });
  });
  it("automatically processes a JSON statement through the real order transaction without losing checkout data", async () => {
    const f = await fixture();
    const photos = [{ fileId: "synthetic-photo", url: "https://example.test/photo.jpg", originalName: "fixture.jpg" }];
    await pool.query("update order_items set upload_references=$2::jsonb,design_text='Keep original design',notes='Synthetic instructions' where order_id=$1", [f.orderId, JSON.stringify(photos)]);
    const beforeItems = (await pool.query("select * from order_items where order_id=$1", [f.orderId])).rows;
    const beforeAddresses = (await pool.query("select * from order_addresses where order_id=$1 order by kind", [f.orderId])).rows;
    const payload = { query: { profileId: f.account.profileId, currency: "AUD" }, transactions: [{ type: "CREDIT", date: new Date().toISOString(),
      amount: { value: 1, currency: "AUD" }, totalFees: { value: 0, currency: "AUD" }, exchangeDetails: null,
      referenceNumber: `TRANSFER-${randomUUID()}`, details: { type: "DEPOSIT", paymentReference: f.intent.reference, senderName: "Synthetic payer" } }] };
    const worker = createWisePayIdWorker({ config: { ...f.account, token: "unused-fixture", autoMatch: true }, repository: f.repository,
      client: { statement: async () => payload }, apply: (input) => payments.applyVerifiedResult(input) });
    expect(await worker.run()).toMatchObject({ applied: 1 });
    expect(await worker.run()).toMatchObject({ skipped: "no_pending" });
    expect(await effects(f.orderId)).toMatchObject({ status: "paid", ledger: 1, jobs: 1, notices: 1 });
    expect((await pool.query("select * from order_items where order_id=$1", [f.orderId])).rows).toEqual(beforeItems);
    expect((await pool.query("select * from order_addresses where order_id=$1 order by kind", [f.orderId])).rows).toEqual(beforeAddresses);
  });

  it("holds a full checkout receipt when a manual deposit already changed the amount due", async () => {
    const f = await fixture(), saved = await binding(f);
    await pool.query("insert into payment_ledger_entries(order_id,entry_type,direction,amount_cents,currency,received_at) values($1,'bank_transfer','credit',50,'AUD',now())", [f.orderId]);
    await expect(payments.applyVerifiedResult(wiseVerifiedResult(saved))).rejects.toThrow();
    expect(await effects(f.orderId)).toMatchObject({ status: "awaiting_payment", ledger: 0, jobs: 0, notices: 0 });
  });

  it("quarantines a cancelled reservation and processes the next valid receipt", async () => {
    const first = await fixture(); const saved = await binding(first);
    const next = await fixture(first.account); await imported(next);
    await pool.query("update payment_attempts set status='cancelled' where id=$1", [first.intent.id]);
    const worker = createWisePayIdWorker({ config: { ...first.account, token: "unused", autoMatch: true }, repository: first.repository,
      client: { statement: async () => ({ query: { profileId: first.account.profileId, currency: "AUD" }, transactions: [] }) },
      apply: (input) => payments.applyVerifiedResult(input) });
    expect(await worker.run()).toMatchObject({ applied: 1 });
    expect((await pool.query("select status,intent_id from wise_payid_receipts where id=$1", [saved.receipt.id])).rows[0]).toEqual({ status: "review", intent_id: first.intent.id });
    expect(await effects(next.orderId)).toMatchObject({ status: "paid", ledger: 1, jobs: 1, notices: 1 });
  });

});
