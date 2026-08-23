import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { checkoutSessions, orders, productionJobItems, productionJobs, user } from "@/server/db/schema";
import { selectMigrationTarget, verifySelectedTestDatabaseIsolation, type DatabaseIdentity } from "../../../scripts/migration-safety";
import { parseFormWorkbenchQuery } from "./forms-workbench-service";
import { queryFormStatistic } from "./drizzle-forms-stats-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const database = drizzle(databaseUrl);
const suffix = randomUUID();
const actorId = `stats-actor-${suffix}`;
const otherArtistId = `stats-other-artist-${suffix}`;
const assignedJobIds = [randomUUID(), randomUUID()];
const unassignedJobId = randomUUID();
const webJobId = randomUUID();
const webOrderId = randomUUID();
const webSessionId = randomUUID();
const emptyNeededDateJobId = randomUUID();
const financeAverageManualJobId = randomUUID();
const financeAverageWebJobId = randomUUID();
const financeAverageOrderId = randomUUID();
const financeAverageSessionId = randomUUID();
const overflowJobIds = Array.from({ length: 61 }, () => randomUUID());
const emptyNeededDateMarker = randomUUID();
const financeAverageMarker = randomUUID();
const overflowMarker = randomUUID();
const jobIds = [
  ...assignedJobIds,
  unassignedJobId,
  webJobId,
  emptyNeededDateJobId,
  financeAverageManualJobId,
  financeAverageWebJobId,
  ...overflowJobIds,
];
const orderIds = [webOrderId, financeAverageOrderId];
const sessionIds = [webSessionId, financeAverageSessionId];

async function identifyDatabase(url: string): Promise<DatabaseIdentity> {
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query<{
      database: string;
      server_address: string;
      server_port: number;
      server_version: string;
      in_recovery: boolean;
    }>(`select current_database() as database,
          host(inet_server_addr()) as server_address,
          inet_server_port() as server_port,
          version() as server_version,
          pg_is_in_recovery() as in_recovery`);
    const identity = rows[0];
    if (!identity) throw new Error("Test database identity query returned no row");
    return {
      database: identity.database,
      serverAddress: identity.server_address,
      serverPort: identity.server_port,
      serverVersion: identity.server_version,
      inRecovery: identity.in_recovery,
    };
  } finally {
    await pool.end();
  }
}

async function verifyFixtureDatabase(
  env: Readonly<Record<string, string | undefined>>,
  identify: (url: string) => Promise<DatabaseIdentity> = identifyDatabase,
) {
  const target = selectMigrationTarget({ environment: "test", env });
  const safeIdentity = await verifySelectedTestDatabaseIsolation({
    target,
    env,
    identifyDatabase: identify,
  });
  return { database: safeIdentity.database, serverPort: safeIdentity.serverPort };
}

type FixtureLifecycleState =
  | "unverified"
  | "guard_verified"
  | "setup_started"
  | "setup_completed"
  | "cleanup_started";

function createFixtureLifecycle() {
  let state: FixtureLifecycleState = "unverified";

  return {
    async setup<T>(
      verify: () => Promise<T>,
      setupFixtures: () => Promise<void>,
    ): Promise<T> {
      const verified = await verify();
      state = "guard_verified";
      state = "setup_started";
      await setupFixtures();
      state = "setup_completed";
      return verified;
    },
    async cleanup(cleanupFixtures: () => Promise<void>) {
      if (state !== "setup_started" && state !== "setup_completed") return;
      state = "cleanup_started";
      await cleanupFixtures();
    },
  };
}

describe("forms stats fixture guard", () => {
  it("rejects protected application targets before test fixture identity lookup", async () => {
    const guardTestUrl =
      "postgresql://tester@127.0.0.1:55448/rnr_forms_stats_guard_test";
    const identify = vi.fn(async () => {
      throw new Error(
        "identity lookup must not run for an equal protected URL",
      );
    });

    await expect(
      verifyFixtureDatabase(
        {
          TEST_DATABASE_URL: guardTestUrl,
          DATABASE_URL: guardTestUrl,
        },
        identify,
      ),
    ).rejects.toThrow(
      "The test database must differ from application and production databases",
    );
    expect(identify).not.toHaveBeenCalled();
  });

  it("compares protected target aliases through physical identity verification", async () => {
    const guardTestUrl =
      "postgresql://tester@127.0.0.1:55448/rnr_forms_stats_guard_test";
    const protectedAlias =
      "postgresql://application@localhost:55448/rnr_forms_stats_guard_test";
    const identify = vi.fn(async (): Promise<DatabaseIdentity> => ({
      database: "rnr_forms_stats_guard_test",
      serverAddress: "127.0.0.1",
      serverPort: 5432,
      serverVersion: "PostgreSQL test",
      inRecovery: false,
    }));

    await expect(
      verifyFixtureDatabase(
        {
          TEST_DATABASE_URL: guardTestUrl,
          PRODUCTION_DATABASE_URL: protectedAlias,
        },
        identify,
      ),
    ).rejects.toThrow(
      "The test database must differ from every protected physical database",
    );
    expect(identify).toHaveBeenCalledWith(guardTestUrl);
    expect(identify).toHaveBeenCalledWith(protectedAlias);
  });

  it("rejects non-loopback test URLs before fixture identity lookup", async () => {
    const guardTestUrl =
      "postgresql://tester@127.0.0.1:55448/rnr_forms_stats_guard_test";
    const identify = vi.fn(async (): Promise<DatabaseIdentity> => ({
      database: "rnr_forms_stats_guard_test",
      serverAddress: "127.0.0.1",
      serverPort: 5432,
      serverVersion: "PostgreSQL test",
      inRecovery: false,
    }));

    await expect(
      verifyFixtureDatabase(
        {
          TEST_DATABASE_URL: guardTestUrl.replace("127.0.0.1", "203.0.113.10"),
        },
        identify,
      ),
    ).rejects.toThrow("TEST_DATABASE_URL must use a loopback host");
    expect(identify).not.toHaveBeenCalled();
  });

  it("rejects mismatched physical database names and ports before fixture writes", async () => {
    const guardTestUrl =
      "postgresql://tester@127.0.0.1:55448/rnr_forms_stats_guard_test";
    const nameMismatch = vi.fn(async (): Promise<DatabaseIdentity> => ({
      database: "wrong_test_database",
      serverAddress: "127.0.0.1",
      serverPort: 5432,
      serverVersion: "PostgreSQL test",
      inRecovery: false,
    }));
    await expect(
      verifyFixtureDatabase({ TEST_DATABASE_URL: guardTestUrl }, nameMismatch),
    ).rejects.toThrow("Database identity mismatch; migration refused");

    const portMismatch = vi.fn(async (): Promise<DatabaseIdentity> => ({
      database: "rnr_forms_stats_guard_test",
      serverAddress: "127.0.0.1",
      serverPort: 0,
      serverVersion: "PostgreSQL test",
      inRecovery: false,
    }));
    await expect(
      verifyFixtureDatabase({ TEST_DATABASE_URL: guardTestUrl }, portMismatch),
    ).rejects.toThrow("Database identity mismatch; migration refused");
  });

  it("rejects recovery-state targets before fixture writes", async () => {
    const guardTestUrl =
      "postgresql://tester@127.0.0.1:55448/rnr_forms_stats_guard_test";
    const recoveryTarget = vi.fn(async (): Promise<DatabaseIdentity> => ({
      database: "rnr_forms_stats_guard_test",
      serverAddress: "127.0.0.1",
      serverPort: 5432,
      serverVersion: "PostgreSQL test",
      inRecovery: true,
    }));

    await expect(
      verifyFixtureDatabase(
        { TEST_DATABASE_URL: guardTestUrl },
        recoveryTarget,
      ),
    ).rejects.toThrow("Database identity mismatch; migration refused");
  });

  it("does not start fixture setup or cleanup after a guard failure", async () => {
    const lifecycle = createFixtureLifecycle();
    const guard = vi.fn(async () => {
      throw new Error("guard rejected");
    });
    const setup = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await expect(lifecycle.setup(guard, setup)).rejects.toThrow(
      "guard rejected",
    );
    await lifecycle.cleanup(cleanup);

    expect(setup).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("cleans an exact-ID partial setup only after the guard has succeeded", async () => {
    const lifecycle = createFixtureLifecycle();
    const guard = vi.fn(async () => undefined);
    const setup = vi.fn(async () => {
      throw new Error("fixture insert failed");
    });
    const cleanup = vi.fn(async () => undefined);

    await expect(lifecycle.setup(guard, setup)).rejects.toThrow(
      "fixture insert failed",
    );
    await lifecycle.cleanup(cleanup);

    expect(guard).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("forms stats repository", () => {
  const fixtureLifecycle = createFixtureLifecycle();

  beforeAll(async () => {
    await fixtureLifecycle.setup(
      () => verifyFixtureDatabase(process.env),
      async () => {
    await database.insert(user).values([
      { id: actorId, name: "Stats Artist", email: `stats-${suffix}@example.test`, role: "form_staff" },
      { id: otherArtistId, name: "Other Stats Artist", email: `stats-other-${suffix}@example.test`, role: "form_staff" },
    ]);
    await database.insert(checkoutSessions).values([
      {
        id: webSessionId,
        tokenDigest: `stats-session-${suffix}`,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        completedAt: new Date("2026-08-24T00:00:00Z"),
      },
      {
        id: financeAverageSessionId,
        tokenDigest: `stats-finance-session-${suffix}`,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        completedAt: new Date("2026-08-24T00:00:00Z"),
      },
    ]);
    await database.insert(orders).values([
      {
        id: webOrderId,
        orderNumber: `RNR-STATS-${suffix.slice(0, 10)}`,
        checkoutSessionId: webSessionId,
        checkoutSessionVersion: 1,
        idempotencyKey: `stats-order-${suffix}`,
        customerEmail: `stats-web-${suffix}@example.test`,
        pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
        deliveryMethod: "pickup",
        shippingServiceCode: "pickup",
        shippingServiceName: "Pickup",
        productSubtotalExGstCents: 14_783,
        productGstCents: 2_217,
        productTotalInclGstCents: 17_000,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        shippingTotalInclGstCents: 0,
        totalExGstCents: 14_783,
        totalGstCents: 2_217,
        totalInclGstCents: 17_000,
        paymentStatus: "paid",
      },
      {
        id: financeAverageOrderId,
        orderNumber: `RNR-FINANCE-${financeAverageMarker}`,
        checkoutSessionId: financeAverageSessionId,
        checkoutSessionVersion: 1,
        idempotencyKey: `stats-finance-order-${suffix}`,
        customerEmail: "finance-average-web@example.test",
        pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
        deliveryMethod: "pickup",
        shippingServiceCode: "pickup",
        shippingServiceName: "Pickup",
        productSubtotalExGstCents: 10_000,
        productGstCents: 0,
        productTotalInclGstCents: 10_000,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        shippingTotalInclGstCents: 0,
        totalExGstCents: 10_000,
        totalGstCents: 0,
        totalInclGstCents: 10_000,
        paymentStatus: "paid",
      },
    ]);
    await database.insert(productionJobs).values([
      {
        id: assignedJobIds[0],
        jobNumber: `STATS-${suffix.slice(0, 6)}-0`,
        source: "manual",
        idempotencyKey: `stats-${suffix}-0`,
        requestDigest: "1".repeat(64),
        customerName: "Stats 0",
        customerEmail: `stats0-${suffix}@example.test`,
        customerPhone: "0210000000",
        customerSource: "rnr",
        manualStatus: "new",
        manualPaymentStatus: "processing",
        urgent: true,
        neededDate: "2026-08-20",
        deliveryMethod: "post",
        assignedUserId: actorId,
        amountPayableCents: 23_000,
        amountPaidCents: 10_000,
        artistFeeCents: 3_500,
        materialCostCents: 2_500,
        deliveredAt: new Date("2026-08-18T00:00:00Z"),
        createdAt: new Date("2026-08-16T12:30:00Z"),
      },
      {
        id: assignedJobIds[1],
        jobNumber: `STATS-${suffix.slice(0, 6)}-1`,
        source: "manual",
        idempotencyKey: `stats-${suffix}-1`,
        requestDigest: "2".repeat(64),
        customerName: "Stats 1",
        customerEmail: `stats1-${suffix}@example.test`,
        customerPhone: "0210000000",
        customerSource: "market",
        manualStatus: "new",
        manualPaymentStatus: "processing",
        urgent: false,
        neededDate: "2026-08-21",
        deliveryMethod: "pickup",
        assignedUserId: actorId,
        amountPayableCents: 5_000,
        amountPaidCents: 0,
        artistFeeCents: 500,
        materialCostCents: 500,
        createdAt: new Date("2026-08-23T11:30:00Z"),
      },
      {
        id: unassignedJobId,
        jobNumber: `STATS-${suffix.slice(0, 6)}-2`,
        source: "manual",
        idempotencyKey: `stats-${suffix}-2`,
        requestDigest: "3".repeat(64),
        customerName: "Stats 2",
        customerEmail: `stats2-${suffix}@example.test`,
        customerPhone: "0210000000",
        customerSource: "market",
        manualStatus: "completed",
        manualPaymentStatus: "paid",
        urgent: false,
        neededDate: "2026-08-24",
        deliveryMethod: "courier",
        assignedUserId: null,
        amountPayableCents: 9_000,
        amountPaidCents: 9_000,
        artistFeeCents: 0,
        materialCostCents: 0,
        createdAt: new Date("2026-08-24T12:00:00Z"),
      },
      {
        id: webJobId,
        jobNumber: `STATS-${suffix.slice(0, 6)}-3`,
        source: "web",
        orderId: webOrderId,
        customerName: "Stats Web",
        customerEmail: `stats-web-${suffix}@example.test`,
        customerPhone: "0210000000",
        customerSource: "web",
        webOrderNumber: `RNR-STATS-${suffix.slice(0, 10)}`,
        urgent: false,
        neededDate: "2026-08-25",
        deliveryMethod: "pickup",
        assignedUserId: otherArtistId,
        createdAt: new Date("2026-08-24T12:30:00Z"),
      },
      {
        id: emptyNeededDateJobId,
        jobNumber: `EMPTY-DATE-${emptyNeededDateMarker}`,
        source: "manual",
        idempotencyKey: `stats-empty-date-${suffix}`,
        requestDigest: "4".repeat(64),
        legacySource: "rnrgallery-order-system",
        legacyOrderId: emptyNeededDateMarker,
        customerName: "Empty delivery date",
        customerEmail: "empty-date@example.test",
        customerPhone: "0210000000",
        customerSource: "market",
        manualStatus: "new",
        manualPaymentStatus: "processing",
        urgent: false,
        neededDate: "",
        deliveryMethod: "courier",
        assignedUserId: actorId,
        amountPayableCents: 0,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
        createdAt: new Date("2026-08-24T12:45:00Z"),
      },
      {
        id: financeAverageManualJobId,
        jobNumber: `FINANCE-MANUAL-${financeAverageMarker}`,
        source: "manual",
        idempotencyKey: `stats-finance-manual-${suffix}`,
        requestDigest: "5".repeat(64),
        customerName: "Finance average manual",
        customerEmail: "finance-average-manual@example.test",
        customerPhone: "0210000000",
        customerSource: "market",
        manualStatus: "new",
        manualPaymentStatus: "paid",
        urgent: false,
        neededDate: "2026-08-25",
        deliveryMethod: "courier",
        assignedUserId: actorId,
        amountPayableCents: 10_000,
        amountPaidCents: 10_000,
        artistFeeCents: 2_000,
        materialCostCents: 1_000,
        createdAt: new Date("2026-08-24T13:00:00Z"),
      },
      {
        id: financeAverageWebJobId,
        jobNumber: `FINANCE-WEB-${financeAverageMarker}`,
        source: "web",
        orderId: financeAverageOrderId,
        customerName: "Finance average web",
        customerEmail: "finance-average-web@example.test",
        customerPhone: "0210000000",
        customerSource: "web",
        webOrderNumber: `RNR-FINANCE-${financeAverageMarker}`,
        urgent: false,
        neededDate: "2026-08-25",
        deliveryMethod: "pickup",
        assignedUserId: otherArtistId,
        createdAt: new Date("2026-08-24T13:15:00Z"),
      },
      ...overflowJobIds.map((id, index) => ({
        id,
        jobNumber: `OVERFLOW-${overflowMarker}-${index}`,
        source: "manual" as const,
        idempotencyKey: `stats-overflow-${suffix}-${index}`,
        requestDigest: String(index).padStart(64, "0"),
        customerName: "Overflow bucket",
        customerEmail: "overflow@example.test",
        customerPhone: "0210000000",
        customerSource: "market" as const,
        manualStatus: "new" as const,
        manualPaymentStatus: "processing" as const,
        urgent: false,
        neededDate: "2026-08-25",
        deliveryMethod: "courier" as const,
        assignedUserId: actorId,
        amountPayableCents: 0,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
        createdAt: new Date(Date.UTC(2025, 0, 6 + (index * 7), 12)),
      })),
    ]);
    await database.insert(productionJobItems).values([
      { jobId: assignedJobIds[0], position: 0, productTitle: "Stats Canvas", sizeLabel: "40x50", quantity: 1 },
      { jobId: assignedJobIds[1], position: 0, productTitle: "Stats Canvas", sizeLabel: "50x60", quantity: 1 },
    ]);
      },
    );
  });

  afterAll(async () => {
    await fixtureLifecycle.cleanup(async () => {
    await database.delete(productionJobItems).where(inArray(productionJobItems.jobId, jobIds));
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    await database.delete(orders).where(inArray(orders.id, orderIds));
    await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds));
    await database.delete(user).where(inArray(user.id, [actorId, otherArtistId]));
    await expect(database.select({ id: productionJobs.id }).from(productionJobs).where(inArray(productionJobs.id, jobIds))).resolves.toEqual([]);
    await expect(database.select({ id: orders.id }).from(orders).where(inArray(orders.id, orderIds))).resolves.toEqual([]);
    await expect(database.select({ id: checkoutSessions.id }).from(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds))).resolves.toEqual([]);
    });
  });

  it("applies workbench scope to count, categories and finance totals", async () => {
    const query = parseFormWorkbenchQuery({ q: suffix.slice(0, 6) });
    const access = { actorUserId: actorId, assignedOnly: true, canViewCustomerContact: false, canViewFinance: true };
    await expect(queryFormStatistic(database, query, access, "job_count")).resolves.toMatchObject({ value: 2 });
    await expect(queryFormStatistic(database, query, access, "urgent_count")).resolves.toMatchObject({ value: 1 });
    await expect(queryFormStatistic(database, query, access, "delivery_method")).resolves.toMatchObject({ rows: expect.arrayContaining([{ label: "post", value: 1 }, { label: "pickup", value: 1 }]) });
    await expect(queryFormStatistic(database, query, access, "amount_owing_total")).resolves.toMatchObject({ value: 18000 });
  });

  it("groups the assigned scope in Auckland day, week, month, and product buckets", async () => {
    const query = parseFormWorkbenchQuery({ q: suffix.slice(0, 6) });
    const access = { actorUserId: actorId, assignedOnly: true, canViewCustomerContact: false, canViewFinance: true };
    const weekRequest = {
      dimension: "submitted_at" as const,
      timeUnit: "week" as const,
      measure: "amount_payable" as const,
      aggregation: "sum" as const,
      sort: "default" as const,
    };

    await expect(queryFormStatistic(database, query, access, weekRequest)).resolves.toMatchObject({
      query: weekRequest,
      rows: [{ label: "2026 W34", value: 28_000 }],
    });
    await expect(queryFormStatistic(database, query, access, {
      dimension: "submitted_at", timeUnit: "day", measure: "amount_payable", aggregation: "sum", sort: "default",
    })).resolves.toMatchObject({ rows: [{ label: "2026-08-17", value: 23_000 }, { label: "2026-08-23", value: 5_000 }] });
    await expect(queryFormStatistic(database, query, access, {
      dimension: "submitted_at", timeUnit: "month", measure: "amount_payable", aggregation: "sum", sort: "default",
    })).resolves.toMatchObject({ rows: [{ label: "2026-08", value: 28_000 }] });
    await expect(queryFormStatistic(database, query, access, {
      dimension: "size", measure: "order_count", aggregation: "count", sort: "label_asc",
    })).resolves.toMatchObject({ rows: [{ label: "40x50", value: 1 }, { label: "50x60", value: 1 }] });
  });

  it("aggregates finance cents and preserves web payable semantics", async () => {
    const query = parseFormWorkbenchQuery({ q: suffix.slice(0, 6) });
    const assignedAccess = { actorUserId: actorId, assignedOnly: true, canViewCustomerContact: false, canViewFinance: true };
    const allAccess = { ...assignedAccess, assignedOnly: false };

    await expect(queryFormStatistic(database, query, assignedAccess, {
      measure: "amount_payable", aggregation: "average", sort: "default",
    })).resolves.toMatchObject({ value: 14_000 });
    await expect(queryFormStatistic(database, query, assignedAccess, {
      measure: "actual_profit", aggregation: "sum", sort: "default",
    })).resolves.toMatchObject({ value: 3_000 });
    await expect(queryFormStatistic(database, query, allAccess, {
      dimension: "delivery_method", measure: "amount_payable", aggregation: "sum", sort: "label_asc",
    })).resolves.toMatchObject({ rows: [
      { label: "courier", value: 9_000 },
      { label: "pickup", value: 22_000 },
      { label: "post", value: 23_000 },
    ] });
  });

  it("uses deterministic labels, post-aggregation value sorting, and empty statistics", async () => {
    const query = parseFormWorkbenchQuery({ q: suffix.slice(0, 6) });
    const assignedAccess = { actorUserId: actorId, assignedOnly: true, canViewCustomerContact: false, canViewFinance: true };
    const allAccess = { ...assignedAccess, assignedOnly: false };

    await expect(queryFormStatistic(database, query, assignedAccess, {
      dimension: "delivery_method", measure: "order_count", aggregation: "count", sort: "label_asc",
    })).resolves.toMatchObject({ rows: [{ label: "pickup", value: 1 }, { label: "post", value: 1 }] });
    await expect(queryFormStatistic(database, query, allAccess, {
      dimension: "artist", measure: "order_count", aggregation: "count", sort: "label_asc",
    })).resolves.toMatchObject({ rows: expect.arrayContaining([{ label: "Unspecified", value: 1 }]) });
    await expect(queryFormStatistic(database, query, allAccess, {
      dimension: "delivery_method", measure: "order_count", aggregation: "count", sort: "value_desc",
    })).resolves.toMatchObject({ rows: [
      { label: "pickup", value: 2 },
      { label: "courier", value: 1 },
      { label: "post", value: 1 },
    ] });
    const emptyQuery = parseFormWorkbenchQuery({ q: `missing-${suffix}` });
    await expect(queryFormStatistic(database, emptyQuery, assignedAccess, {
      dimension: "delivered", measure: "order_count", aggregation: "count", sort: "default",
    })).resolves.toMatchObject({ rows: [] });
    await expect(queryFormStatistic(database, emptyQuery, assignedAccess, {
      measure: "amount_payable", aggregation: "sum", sort: "default",
    })).resolves.toMatchObject({ value: 0 });
  });

  it("keeps needed dates as Auckland calendar buckets and labels empty values", async () => {
    const access = { actorUserId: actorId, assignedOnly: false, canViewCustomerContact: false, canViewFinance: true };
    const utcPool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await utcPool.query("set time zone 'UTC'");
      await expect(queryFormStatistic(drizzle(utcPool), parseFormWorkbenchQuery({ q: `STATS-${suffix.slice(0, 6)}-0` }), access, {
        dimension: "needed_date", timeUnit: "day", measure: "order_count", aggregation: "count", sort: "default",
      })).resolves.toMatchObject({ rows: [{ label: "2026-08-20", value: 1 }] });
    } finally {
      await utcPool.end();
    }
    await expect(queryFormStatistic(database, parseFormWorkbenchQuery({ q: `STATS-${suffix.slice(0, 6)}-0` }), access, {
      dimension: "needed_date", timeUnit: "day", measure: "order_count", aggregation: "count", sort: "default",
    })).resolves.toMatchObject({ rows: [{ label: "2026-08-20", value: 1 }] });
    await expect(queryFormStatistic(database, parseFormWorkbenchQuery({ q: emptyNeededDateMarker }), access, {
      dimension: "needed_date", timeUnit: "day", measure: "order_count", aggregation: "count", sort: "default",
    })).resolves.toMatchObject({ rows: [{ label: "Unspecified", value: 1 }] });
  });

  it("selects the newest default time buckets while presenting them chronologically", async () => {
    const query = parseFormWorkbenchQuery({ q: overflowMarker });
    const access = { actorUserId: actorId, assignedOnly: true, canViewCustomerContact: false, canViewFinance: true };
    const statistic = await queryFormStatistic(database, query, access, {
      dimension: "submitted_at", timeUnit: "week", measure: "order_count", aggregation: "count", sort: "default",
    });
    expect(statistic.rows).toHaveLength(60);
    expect(statistic.rows?.[0]).toEqual({ label: "2025 W03", value: 1 });
    expect(statistic.rows?.at(-1)).toEqual({ label: "2026 W10", value: 1 });
  });

  it("excludes unavailable web production finance values from averages", async () => {
    const query = parseFormWorkbenchQuery({ q: financeAverageMarker });
    const access = { actorUserId: actorId, assignedOnly: false, canViewCustomerContact: false, canViewFinance: true };
    await expect(queryFormStatistic(database, query, access, {
      measure: "artist_fee", aggregation: "average", sort: "default",
    })).resolves.toMatchObject({ value: 2_000 });
    await expect(queryFormStatistic(database, query, access, {
      measure: "material_cost", aggregation: "average", sort: "default",
    })).resolves.toMatchObject({ value: 1_000 });
    await expect(queryFormStatistic(database, query, access, {
      measure: "actual_profit", aggregation: "average", sort: "default",
    })).resolves.toMatchObject({ value: 7_000 });
  });
});
