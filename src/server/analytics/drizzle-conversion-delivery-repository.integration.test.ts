import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { analyticsConversionDeliveries } from "@/server/db/schema";
import {
  createDrizzleConversionDeliveryRepository,
  enqueueConversionDeliveries,
} from "./drizzle-conversion-delivery-repository";
import { assertIsolatedTestDatabaseUrl } from "../../../scripts/migration-safety";

const databaseUrl = assertIsolatedTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  process.env,
).url;
const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const jobId = randomUUID();
const transactionId = `manual-order:${jobId}`;
const createdIds: string[] = [];
const now = new Date("2026-08-28T01:00:00.000Z");
const candidate = {
  platform: "google" as const,
  transactionId,
  jobId,
  eventType: "purchase" as const,
  eventOccurredAt: now,
  eventSource: "WEB" as const,
  currency: "NZD" as const,
  valueMinor: 20_000,
  consentSnapshot: {
    version: 1 as const,
    decision: "granted" as const,
    recordedAt: now.toISOString(),
    evidenceSource: "manual_order_field" as const,
    adUserData: "CONSENT_GRANTED" as const,
    adPersonalization: "CONSENT_DENIED" as const,
  },
  attributionSnapshot: { version: 1 as const, source: "google" as const, gclid: "gclid-test" },
  userDataSnapshot: { version: 1 as const, hashedEmail: "a".repeat(64) },
  nextAttemptAt: now,
};

async function insert(platform: "google" | "meta" = "google") {
  const transaction = `manual-order:${randomUUID()}`;
  const [row] = await database.insert(analyticsConversionDeliveries).values({
    ...candidate,
    platform,
    transactionId: transaction,
    attributionSnapshot: platform === "google"
      ? candidate.attributionSnapshot
      : { version: 1, source: "meta", fbp: "fb.1.1720000000000.123456" },
  }).returning();
  createdIds.push(row.id);
  return row;
}

describe("drizzle conversion delivery repository", () => {
  afterEach(async () => {
    if (createdIds.length) {
      await database.delete(analyticsConversionDeliveries)
        .where(inArray(analyticsConversionDeliveries.id, createdIds));
      createdIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enqueues Google and Meta independently and enforces platform transaction uniqueness", async () => {
    await database.transaction(async (tx) => {
      expect(await enqueueConversionDeliveries(tx, [candidate, { ...candidate, platform: "meta", attributionSnapshot: { version: 1, source: "meta" } }])).toBe(2);
    });
    const rows = await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.transactionId, transactionId));
    createdIds.push(...rows.map(({ id }) => id));
    expect(rows.map(({ platform }) => platform).sort()).toEqual(["google", "meta"]);
    await database.transaction(async (tx) => {
      expect(await enqueueConversionDeliveries(tx, [candidate])).toBe(0);
    });
    await database.delete(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.transactionId, transactionId));
  });

  it("claims a due row atomically with a lease", async () => {
    const row = await insert("meta");
    const repository = createDrizzleConversionDeliveryRepository(database);
    const lease = randomUUID();
    const [first, second] = await Promise.all([
      repository.claimNext({ platform: "meta", now, leaseToken: lease, leaseDurationMs: 60_000 }),
      repository.claimNext({ platform: "meta", now, leaseToken: randomUUID(), leaseDurationMs: 60_000 }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first ?? second).toMatchObject({ id: row.id, leaseToken: expect.any(String), work: "ingest", attemptCount: 1 });
  });

  it("recovers stale ingest and status-poll leases", async () => {
    const repository = createDrizzleConversionDeliveryRepository(database);
    const ingest = await insert("meta");
    const poll = await insert("google");
    await database.update(analyticsConversionDeliveries).set({
      status: "sending", leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() - 1),
    }).where(eq(analyticsConversionDeliveries.id, ingest.id));
    await database.update(analyticsConversionDeliveries).set({
      status: "sending", requestId: "request-poll", leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() - 1),
    }).where(eq(analyticsConversionDeliveries.id, poll.id));
    expect(await repository.recoverStaleClaims(now)).toBeGreaterThanOrEqual(2);
    const rows = await database.select().from(analyticsConversionDeliveries).where(inArray(
      analyticsConversionDeliveries.id, [ingest.id, poll.id],
    ));
    expect(rows.find(({ id }) => id === ingest.id)?.status).toBe("pending");
    expect(rows.find(({ id }) => id === poll.id)?.status).toBe("accepted");
  });

  it("stores accepted Google request IDs and resumes as poll work without re-ingest", async () => {
    const row = await insert("google");
    const repository = createDrizzleConversionDeliveryRepository(database);
    const lease = randomUUID();
    expect(await repository.claimNext({ platform: "google", now, leaseToken: lease, leaseDurationMs: 60_000 })).toMatchObject({ id: row.id, work: "ingest" });
    const firstPoll = new Date(now.getTime() + 30 * 60_000);
    expect(await repository.markAccepted({ id: row.id, leaseToken: lease, requestId: "request-accepted", now, nextAttemptAt: firstPoll })).toBe(true);
    expect(await repository.claimNext({ platform: "google", now, leaseToken: randomUUID(), leaseDurationMs: 60_000 })).toBeNull();
    expect(await repository.claimNext({ platform: "google", now: firstPoll, leaseToken: randomUUID(), leaseDurationMs: 60_000 })).toMatchObject({ id: row.id, work: "poll", requestId: "request-accepted" });
  });

  it("uses lease-token compare-and-set for processing, retry, success and permanent failure", async () => {
    const repository = createDrizzleConversionDeliveryRepository(database);
    const row = await insert("meta");
    const lease = randomUUID();
    await repository.claimNext({ platform: "meta", now, leaseToken: lease, leaseDurationMs: 60_000 });
    expect(await repository.markSucceeded({ id: row.id, leaseToken: randomUUID(), now })).toBe(false);
    expect(await repository.markRetryableFailed({
      id: row.id, leaseToken: lease, now, nextAttemptAt: new Date(now.getTime() + 5_000), errorCode: "timeout", errorCategory: "transport",
    })).toBe(true);
    const retryLease = randomUUID();
    await repository.claimNext({ platform: "meta", now: new Date(now.getTime() + 5_000), leaseToken: retryLease, leaseDurationMs: 60_000 });
    expect(await repository.markSucceeded({ id: row.id, leaseToken: retryLease, now: new Date(now.getTime() + 5_001) })).toBe(true);
  });

  it("keeps processing nonterminal and supports dead-letter state", async () => {
    const repository = createDrizzleConversionDeliveryRepository(database);
    const processing = await insert("google");
    const lease = randomUUID();
    await repository.claimNext({ platform: "google", now, leaseToken: lease, leaseDurationMs: 60_000 });
    await repository.markAccepted({ id: processing.id, leaseToken: lease, requestId: "request-processing", now, nextAttemptAt: now });
    const pollLease = randomUUID();
    await repository.claimNext({ platform: "google", now, leaseToken: pollLease, leaseDurationMs: 60_000 });
    const diagnostics = {
      version: 1 as const,
      requestStatus: "PROCESSING" as const,
      destinations: [{
        requestStatus: "PROCESSING" as const,
        recordCount: "1",
        errors: [],
        warnings: [{ reason: "DELAYED", recordCount: "1" }],
      }],
    };
    expect(await repository.markProcessing({
      id: processing.id,
      leaseToken: pollLease,
      now,
      nextAttemptAt: new Date(now.getTime() + 40 * 60_000),
      diagnostics,
    })).toBe(true);
    const [stored] = await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.id, processing.id));
    expect(stored.providerDiagnostics).toEqual(diagnostics);
    const dead = await insert("meta");
    const deadLease = randomUUID();
    await repository.claimNext({ platform: "meta", now, leaseToken: deadLease, leaseDurationMs: 60_000 });
    expect(await repository.markDeadLetter({ id: dead.id, leaseToken: deadLease, now, errorCode: "attempts_exhausted", errorCategory: "transport" })).toBe(true);
  });

  it("allows only one-way sensitive snapshot cleanup and rejects identity edits", async () => {
    const row = await insert("meta");
    const repository = createDrizzleConversionDeliveryRepository(database);
    const lease = randomUUID();
    await repository.claimNext({ platform: "meta", now, leaseToken: lease, leaseDurationMs: 60_000 });
    await repository.markSucceeded({ id: row.id, leaseToken: lease, now: new Date("2026-01-01T00:00:00.000Z") });
    expect(await repository.redactExpiredSnapshots(new Date("2026-05-01T00:00:00.000Z"))).toBeGreaterThanOrEqual(1);
    const [redacted] = await database.select().from(analyticsConversionDeliveries).where(eq(analyticsConversionDeliveries.id, row.id));
    expect(redacted.consentSnapshot).toEqual({ version: 1, redacted: true });
    await expect(database.update(analyticsConversionDeliveries).set({ valueMinor: 1 }).where(eq(analyticsConversionDeliveries.id, row.id))).rejects.toThrow(/failed query/i);
  });

  it("does not redact sensitive snapshots before the retention window expires", async () => {
    const row = await insert("meta");
    const repository = createDrizzleConversionDeliveryRepository(database);
    const lease = randomUUID();
    await repository.claimNext({ platform: "meta", now, leaseToken: lease, leaseDurationMs: 60_000 });
    await repository.markSucceeded({ id: row.id, leaseToken: lease, now });

    expect(await repository.redactExpiredSnapshots(
      new Date(now.getTime() + 89 * 24 * 60 * 60_000),
    )).toBe(0);
    const [retained] = await database.select().from(analyticsConversionDeliveries)
      .where(eq(analyticsConversionDeliveries.id, row.id));
    expect(retained.consentSnapshot).toEqual(candidate.consentSnapshot);
  });

  it("enforces constraints and indexes in PostgreSQL", async () => {
    const constraints = await pool.query<{ conname: string }>("select conname from pg_constraint where conrelid = 'analytics_conversion_deliveries'::regclass");
    const indexes = await pool.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'analytics_conversion_deliveries'");
    expect(constraints.rows.map(({ conname }) => conname)).toEqual(expect.arrayContaining([
      "analytics_conversion_deliveries_platform_valid",
      "analytics_conversion_deliveries_lease_shape_valid",
    ]));
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(expect.arrayContaining([
      "analytics_conversion_deliveries_platform_transaction_unique",
      "analytics_conversion_deliveries_status_next_attempt_idx",
      "analytics_conversion_deliveries_job_idx",
    ]));
    const trigger = await pool.query("select 1 from pg_trigger where tgname = 'analytics_conversion_deliveries_immutable_trigger' and not tgisinternal");
    expect(trigger.rowCount).toBe(1);
  });
});
