import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: testDatabaseUrl });
const sessionIds: string[] = [];
const suffix = randomUUID();

async function createSession(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO checkout_sessions (token_digest, expires_at)
     VALUES ($1, now() + interval '1 hour') RETURNING id`,
    [`task3-${label}-${suffix}`],
  );
  const id = result.rows[0].id;
  sessionIds.push(id);
  return id;
}

async function createPickupOrder(
  sessionId: string,
  idempotencyKey: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO orders (
       order_number, checkout_session_id, checkout_session_version,
       idempotency_key, customer_email, delivery_method,
       shipping_service_code, shipping_service_name,
       product_subtotal_ex_gst_cents, product_gst_cents,
       product_total_incl_gst_cents, shipping_ex_gst_cents,
       shipping_gst_cents, shipping_total_incl_gst_cents,
       total_ex_gst_cents, total_gst_cents, total_incl_gst_cents
     ) VALUES ($1, $2, 1, $3, 'checkout@example.test', 'pickup', 'pickup', 'Pickup',
       6500, 975, 7475, 0, 0, 0, 6500, 975, 7475)
     RETURNING id`,
    [`RNR-${randomUUID()}`, sessionId, idempotencyKey],
  );
  return result.rows[0].id;
}

async function createQuote(sessionId: string, label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO shipping_quotes (
       checkout_session_id, request_digest, provider, service_code,
       service_name, amount_ex_gst_cents, gst_cents, amount_incl_gst_cents,
       provider_reference, raw_response_hash, expires_at
     ) VALUES ($1, 'digest', 'local-test', 'post', 'Test Post',
       2000, 300, 2300, $2, 'hash', now() + interval '10 minutes')
     RETURNING id`,
    [sessionId, `task3-${label}-${suffix}`],
  );
  return result.rows[0].id;
}

async function createOrderItem(sessionId: string, orderId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO order_items (
       checkout_session_id, order_id, position, client_item_id,
       product_key, product_slug, product_title, size_key, size_label,
       people_pets, photo_submission_method, design_text, notes, needed_date,
       urgent_service_confirmed, urgent_working_days, quantity,
       price_lines, upload_references, unit_subtotal_ex_gst_cents,
       unit_gst_cents, unit_total_incl_gst_cents, line_subtotal_ex_gst_cents,
       line_gst_cents, line_total_incl_gst_cents
     ) VALUES ($1, $2, 0, $3, 'photo-print-canvas', 'photo-print-canvas',
       'Photo Print Canvas', 'a4', 'A4', 0, 'later', '', '', '2026-08-10',
       false, 5, 1, '[]', '[]', 6500, 975, 7475, 6500, 975, 7475)
     RETURNING id`,
    [sessionId, orderId, randomUUID()],
  );
  return result.rows[0].id;
}

async function claimUpload(
  sessionId: string,
  orderItemId: string,
  label: string,
) {
  return pool.query(
    `INSERT INTO checkout_uploads (
       checkout_session_id, storage_key, original_name, media_type,
       size_bytes, sha256, claimed_by_order_item_id, claimed_at
     ) VALUES ($1, $2, 'photo.jpg', 'image/jpeg', 100, $3, $4, now())`,
    [sessionId, `task3-${label}-${suffix}`, `hash-${label}`, orderItemId],
  );
}

describe("checkout schema database constraints", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM checkout_uploads WHERE checkout_session_id = ANY($1::uuid[])",
      [sessionIds],
    );
    await pool.query(
      "DELETE FROM orders WHERE checkout_session_id = ANY($1::uuid[])",
      [sessionIds],
    );
    await pool.query(
      "UPDATE checkout_sessions SET selected_shipping_quote_id = NULL WHERE id = ANY($1::uuid[])",
      [sessionIds],
    );
    await pool.query(
      "DELETE FROM shipping_quotes WHERE checkout_session_id = ANY($1::uuid[])",
      [sessionIds],
    );
    await pool.query("DELETE FROM checkout_sessions WHERE id = ANY($1::uuid[])", [
      sessionIds,
    ]);
    await pool.end();
  });

  it("enforces one order per session and scopes idempotency to that session", async () => {
    const firstSession = await createSession("one-order-a");
    const secondSession = await createSession("one-order-b");
    const key = `task3-key-${suffix}`;
    await createPickupOrder(firstSession, key);

    await expect(createPickupOrder(firstSession, `${key}-other`)).rejects.toThrow(
      "orders_checkout_session_id_unique",
    );
    await expect(createPickupOrder(secondSession, key)).resolves.toEqual(
      expect.any(String),
    );
  });

  it("rejects unbalanced order money", async () => {
    const sessionId = await createSession("bad-money");
    await expect(
      pool.query(
        `INSERT INTO orders (
           order_number, checkout_session_id, checkout_session_version,
           idempotency_key, customer_email, delivery_method,
           shipping_service_code, shipping_service_name,
           product_subtotal_ex_gst_cents, product_gst_cents,
           product_total_incl_gst_cents, shipping_ex_gst_cents,
           shipping_gst_cents, shipping_total_incl_gst_cents,
           total_ex_gst_cents, total_gst_cents, total_incl_gst_cents
         ) VALUES ($1, $2, 1, $3, 'checkout@example.test', 'pickup', 'pickup', 'Pickup',
           6500, 975, 1, 0, 0, 0, 6500, 975, 7475)`,
        [`RNR-${randomUUID()}`, sessionId, `task3-bad-${suffix}`],
      ),
    ).rejects.toThrow("orders_product_amounts_balance");
  });

  it("prevents an order from selecting another session's shipping quote", async () => {
    const quoteOwner = await createSession("quote-owner");
    const orderOwner = await createSession("order-owner");
    const quote = await pool.query<{ id: string }>(
      `INSERT INTO shipping_quotes (
         checkout_session_id, request_digest, provider, service_code,
         service_name, amount_ex_gst_cents, gst_cents, amount_incl_gst_cents,
         provider_reference, raw_response_hash, expires_at
       ) VALUES ($1, 'digest', 'local-test', 'post', 'Test Post',
         2000, 300, 2300, $2, 'hash', now() + interval '10 minutes')
       RETURNING id`,
      [quoteOwner, `task3-quote-${suffix}`],
    );

    await expect(
      pool.query(
        `INSERT INTO orders (
           order_number, checkout_session_id, checkout_session_version,
           idempotency_key, customer_email, delivery_method, shipping_quote_id,
           shipping_provider, shipping_service_code, shipping_service_name,
           shipping_provider_reference, shipping_request_digest,
           product_subtotal_ex_gst_cents, product_gst_cents,
           product_total_incl_gst_cents, shipping_ex_gst_cents,
           shipping_gst_cents, shipping_total_incl_gst_cents,
           total_ex_gst_cents, total_gst_cents, total_incl_gst_cents
         ) VALUES ($1, $2, 1, $3, 'checkout@example.test', 'post', $4,
           'local-test', 'post', 'Test Post', 'provider-ref', 'digest',
           6500, 975, 7475, 2000, 300, 2300, 8500, 1275, 9775)`,
        [
          `RNR-${randomUUID()}`,
          orderOwner,
          `task3-cross-quote-${suffix}`,
          quote.rows[0].id,
        ],
      ),
    ).rejects.toThrow("orders_shipping_quote_owner_fk");
  });

  it("allows only the owning checkout session to select a shipping quote", async () => {
    const quoteOwner = await createSession("selected-quote-owner");
    const otherSession = await createSession("selected-quote-other");
    const quoteId = await createQuote(quoteOwner, "selected-quote");

    await expect(
      pool.query(
        "UPDATE checkout_sessions SET selected_shipping_quote_id = $1 WHERE id = $2",
        [quoteId, quoteOwner],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query(
        "UPDATE checkout_sessions SET selected_shipping_quote_id = $1 WHERE id = $2",
        [quoteId, otherSession],
      ),
    ).rejects.toThrow("checkout_sessions_selected_quote_owner_fk");
  });

  it("allows multiple owned uploads per item and rejects cross-session claims", async () => {
    const ownerSession = await createSession("upload-owner");
    const otherSession = await createSession("upload-other");
    const orderId = await createPickupOrder(
      ownerSession,
      `task3-upload-order-${suffix}`,
    );
    const orderItemId = await createOrderItem(ownerSession, orderId);

    await expect(claimUpload(ownerSession, orderItemId, "upload-one")).resolves
      .toMatchObject({ rowCount: 1 });
    await expect(claimUpload(ownerSession, orderItemId, "upload-two")).resolves
      .toMatchObject({ rowCount: 1 });
    await expect(claimUpload(otherSession, orderItemId, "upload-cross")).rejects
      .toThrow("checkout_uploads_claim_owner_fk");
  });
});
