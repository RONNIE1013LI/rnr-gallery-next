// @vitest-environment node
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { createWebsiteAnalyticsRepository } from "./website-analytics-repository";
import { createCartSnapshotRecorder } from "./website-cart-snapshots";
import { createUserShoppingHistoryRepository } from "./user-shopping-history";

// Uses the repository's TEST_DATABASE_URL identity guard in vitest.setup.ts.
// Every run creates a unique fixture schema; no persistent application tables are touched.
const url = process.env.TEST_DATABASE_URL;
const schemaName = `user_history_fixture_${randomUUID().replaceAll("-", "")}`;
const fixtureUrl = url ? new URL(url) : null;
// pg parses URL options after Pool options: set the URL itself so it cannot override isolation.
fixtureUrl?.searchParams.set("options", `-c search_path=${schemaName}`);
const pool = fixtureUrl ? new Pool({ connectionString: fixtureUrl.toString() }) : null;
const db = pool ? drizzle(pool) : null;
const digest = "a".repeat(64);
const now = new Date("2026-11-04T00:00:00Z");
const recordPage = (sessionId: string, userId?: string, eventId = randomUUID(), pathname = "/cart", occurredAt = now) =>
  createWebsiteAnalyticsRepository(db!).record({ sessionId, userId, eventId, pathname, occurredAt, visitorDigest: digest,
    localDate: "2026-11-04", attribution: { channel: "direct", source: "direct", medium: null, utmCampaign: null, clickIdType: null }, countryCode: "NZ" });
const item = { productKey: "photo-print-canvas", productTitle: "Canvas", sizeLabel: "A4", peoplePets: 0, quantity: 1, unitPriceInclGstCents: 5000 };
const cart = (sessionId: string, userId?: string, items = [item]) => createCartSnapshotRecorder(db!)({ sessionId, userId, visitorDigest: digest,
  snapshot: { version: 1, eventId: randomUUID(), stage: "cart", currency: "NZD", totalInclGstCents: items.reduce((s, i) => s + i.quantity * i.unitPriceInclGstCents, 0), items } });

(url ? describe : describe.skip)("account history storage in an isolated fixture", () => {
  beforeAll(async () => {
    // Minimal task-owned fixture, not a formal migration.
    await pool!.query(`create schema "${schemaName}"`);
    const identity = await pool!.query('select current_schema() as schema');
    if (identity.rows[0]?.schema !== schemaName) throw new Error("Fixture schema isolation required");
    await pool!.query(`
      create table "user" (id text primary key);
      create table website_analytics_sessions (id uuid primary key, visitor_digest varchar(64) not null, started_at timestamptz not null,
        local_date date not null, channel varchar(32) not null, source varchar(255), medium varchar(100), utm_campaign varchar(100),
        click_id_type varchar(16), country_code varchar(2), is_internal boolean not null default false);
      create table website_analytics_pageviews (id uuid primary key, session_id uuid not null references website_analytics_sessions on delete cascade,
        user_id text references "user" on delete set null, occurred_at timestamptz not null, local_date date not null, pathname varchar(512) not null);
      create index on website_analytics_pageviews (user_id, occurred_at, id);
      create table website_analytics_cart_snapshots (id uuid primary key, session_id uuid not null references website_analytics_sessions on delete cascade,
        user_id text references "user" on delete set null, occurred_at timestamptz not null default now(), stage varchar(16) not null,
        currency varchar(3) not null, total_incl_gst_cents bigint not null, items jsonb not null, fingerprint varchar(64) not null);
      create index on website_analytics_cart_snapshots (user_id, occurred_at, id);
      create index on website_analytics_cart_snapshots (session_id, occurred_at, id);
      create table orders (id uuid primary key, customer_id text references "user" on delete set null, order_number text not null,
        created_at timestamptz not null, currency text not null, total_incl_gst_cents bigint not null, payment_status text not null);
    `);
  });
  beforeEach(async () => {
    await pool!.query('truncate orders, website_analytics_cart_snapshots, website_analytics_pageviews, website_analytics_sessions, "user" cascade');
    await pool!.query('insert into "user" (id) values (\'a\'), (\'b\')');
  });
  afterAll(async () => {
    try { await pool!.query(`drop schema if exists "${schemaName}" cascade`); }
    finally { await pool!.end(); }
  });

  it("keeps anonymous and other-account events separate, without rewriting retries", async () => {
    const session = randomUUID(); const eventId = randomUUID();
    await recordPage(session); await recordPage(session, "a", eventId, "/products/photo-print-canvas");
    await recordPage(session, "b", eventId); await recordPage(session, "b");
    const load = createUserShoppingHistoryRepository(db!);
    const a = await load("a", new Date(now.getTime() + 1000)); const b = await load("b", new Date(now.getTime() + 1000));
    expect(a.status).toBe("available"); expect(b.status).toBe("available");
    if (a.status !== "available" || b.status !== "available") return;
    expect(a.events).toHaveLength(1); expect(a.events[0].id).toBe(eventId); expect(b.events).toHaveLength(1);
  });
  it("preserves anonymous page records when auth cannot resolve", async () => {
    await recordPage(randomUUID());
    expect((await pool!.query('select user_id from website_analytics_pageviews')).rows).toEqual([{ user_id: null }]);
  });
  it("deduplicates same-account snapshots but saves identical carts after an account change", async () => {
    const session = randomUUID(); await recordPage(session);
    expect(await cart(session, "a")).toBe("saved"); expect(await cart(session, "a")).toBe("duplicate");
    expect(await cart(session, "b")).toBe("saved"); expect(await cart(session)).toBe("saved");
    expect(await cart(session, "a", [])).toBe("saved");
    const a = await createUserShoppingHistoryRepository(db!)("a", new Date());
    expect(a.status).toBe("available"); if (a.status !== "available") return;
    expect(a.events.filter(e => e.kind === "cart")).toHaveLength(2);
    // The cart before A's last snapshot belongs to an anonymous user: no inferred removal.
    expect(a.events.filter(e => e.kind === "cart").every(e => e.kind === "cart" && e.changes.length === 0)).toBe(true);
  });
  it("records quantity changes only across consecutive same-account snapshots", async () => {
    const session = randomUUID(); await recordPage(session, "a");
    await cart(session, "a", []); await cart(session, "a", [item]);
    await cart(session, "a", [{ ...item, quantity: 2 }]); await cart(session, "a", []);
    const result = await createUserShoppingHistoryRepository(db!)("a", new Date());
    expect(result.status).toBe("available"); if (result.status !== "available") return;
    const changes = result.events.flatMap(e => e.kind === "cart" ? e.changes : []);
    expect(changes).toContain("Added Canvas (A4) × 1");
    expect(changes).toContain("Quantity changed: Canvas (A4), 1 → 2");
    expect(changes).toContain("Removed Canvas (A4) × 2");
  });
  it("does not reassign retried cart event IDs to a different account", async () => {
    const session = randomUUID(); await recordPage(session);
    const snapshot = { version: 1 as const, eventId: randomUUID(), stage: "checkout" as const, currency: "NZD" as const, totalInclGstCents: 0, items: [] };
    const record = createCartSnapshotRecorder(db!);
    await record({ sessionId: session, visitorDigest: digest, userId: "a", snapshot });
    await record({ sessionId: session, visitorDigest: digest, userId: "b", snapshot });
    expect((await pool!.query('select user_id from website_analytics_cart_snapshots')).rows).toEqual([{ user_id: "a" }]);
  });
  it("includes only this account's submitted orders within the retained window", async () => {
    const session = randomUUID(); await recordPage(session, "a", randomUUID(), "/", new Date("2026-01-01Z"));
    for (const uid of ["a", "b"]) await pool!.query('insert into orders values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), uid, "08100", now, "NZD", 6000, "awaiting_payment"]);
    const result = await createUserShoppingHistoryRepository(db!)("a", now);
    expect(result.status).toBe("available"); if (result.status !== "available") return;
    expect(result.events).toHaveLength(1); expect(result.events[0].kind).toBe("order");
  });
  it("preserves subsecond chronology when the database returns Date objects", async () => {
    const session = randomUUID(); await recordPage(session, "a");
    await cart(session, "a", []); await cart(session, "a", [item]);
    const rows = (await pool!.query('select id from website_analytics_cart_snapshots order by occurred_at')).rows;
    await pool!.query('update website_analytics_cart_snapshots set occurred_at=$1 where id=$2', [new Date("2026-11-03T23:59:59.100Z"), rows[0].id]);
    await pool!.query('update website_analytics_cart_snapshots set occurred_at=$1 where id=$2', [new Date("2026-11-03T23:59:59.900Z"), rows[1].id]);
    const result = await createUserShoppingHistoryRepository(db!)("a", now);
    expect(result.status).toBe("available"); if (result.status !== "available") return;
    const carts = result.events.filter(e => e.kind === "cart");
    expect(carts.map(e => e.occurredAt)).toEqual(["2026-11-03T23:59:59.900Z", "2026-11-03T23:59:59.100Z"]);
  });
  it("removes identity on account deletion while preserving anonymous traffic", async () => {
    const session = randomUUID(); await recordPage(session, "a"); await cart(session, "a");
    await pool!.query('delete from "user" where id=\'a\'');
    expect((await pool!.query('select user_id from website_analytics_pageviews')).rows).toEqual([{ user_id: null }]);
    expect((await pool!.query('select user_id from website_analytics_cart_snapshots')).rows).toEqual([{ user_id: null }]);
  });
  it("returns unavailable when the additive schema has not been approved/applied", async () => {
    await pool!.query('alter table website_analytics_pageviews rename column user_id to unavailable_user_id');
    try { expect(await createUserShoppingHistoryRepository(db!)("a", now)).toEqual({ status: "unavailable" }); }
    finally { await pool!.query('alter table website_analytics_pageviews rename column unavailable_user_id to user_id'); }
  });
});
