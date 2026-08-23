import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkoutSessions, orders, productionJobItems, productionJobs, user } from "@/server/db/schema";
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
const jobIds = [...assignedJobIds, unassignedJobId, webJobId];

describe("forms stats repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: actorId, name: "Stats Artist", email: `stats-${suffix}@example.test`, role: "form_staff" },
      { id: otherArtistId, name: "Other Stats Artist", email: `stats-other-${suffix}@example.test`, role: "form_staff" },
    ]);
    await database.insert(checkoutSessions).values({
      id: webSessionId,
      tokenDigest: `stats-session-${suffix}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      completedAt: new Date("2026-08-24T00:00:00Z"),
    });
    await database.insert(orders).values({
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
    });
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
    ]);
    await database.insert(productionJobItems).values([
      { jobId: assignedJobIds[0], position: 0, productTitle: "Stats Canvas", sizeLabel: "40x50", quantity: 1 },
      { jobId: assignedJobIds[1], position: 0, productTitle: "Stats Canvas", sizeLabel: "50x60", quantity: 1 },
    ]);
  });

  afterAll(async () => {
    await database.delete(productionJobItems).where(inArray(productionJobItems.jobId, jobIds));
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    await database.delete(orders).where(eq(orders.id, webOrderId));
    await database.delete(checkoutSessions).where(eq(checkoutSessions.id, webSessionId));
    await database.delete(user).where(inArray(user.id, [actorId, otherArtistId]));
    await expect(database.select({ id: productionJobs.id }).from(productionJobs).where(inArray(productionJobs.id, jobIds))).resolves.toEqual([]);
    await expect(database.select({ id: orders.id }).from(orders).where(eq(orders.id, webOrderId))).resolves.toEqual([]);
    await expect(database.select({ id: checkoutSessions.id }).from(checkoutSessions).where(eq(checkoutSessions.id, webSessionId))).resolves.toEqual([]);
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
});
