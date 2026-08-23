import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkoutSessions,
  orders,
  productionFieldDefinitions,
  productionFieldValues,
  productionJobItems,
  productionJobs,
  user,
} from "@/server/db/schema";
import { parseFormWorkbenchQuery } from "./forms-workbench-service";
import { listFormOrders } from "./drizzle-forms-workbench-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const database = drizzle(testDatabaseUrl);
const suffix = randomUUID();
const operatorId = `forms-operator-${suffix}`;
const otherUserId = `forms-other-${suffix}`;
const legacySubmitterId = `forms-legacy-submitter-${suffix}`;
const assignedJobId = randomUUID();
const otherJobId = randomUUID();
const refundedJobId = randomUUID();
const cancelledJobId = randomUUID();
const legacyJobId = randomUUID();
const refundedOrderId = randomUUID();
const cancelledOrderId = randomUUID();
const refundedSessionId = randomUUID();
const cancelledSessionId = randomUUID();
const customFieldId = randomUUID();
const customNumberFieldId = randomUUID();
const jobIds = [assignedJobId, otherJobId, refundedJobId, cancelledJobId, legacyJobId];
const orderIds = [refundedOrderId, cancelledOrderId];
const sessionIds = [refundedSessionId, cancelledSessionId];

describe("forms workbench repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: operatorId, name: "Assigned Artist", email: `artist-${suffix}@example.test`, role: "form_staff" },
      { id: otherUserId, name: "Other Artist", email: `other-${suffix}@example.test`, role: "staff" },
      { id: legacySubmitterId, name: "Former Operator", email: `legacy-${suffix}@example.test`, role: "staff" },
    ]);
    await database.insert(productionFieldDefinitions).values([{
      id: customFieldId,
      fieldKey: `campaign_${suffix.replaceAll("-", "").slice(0, 16)}`,
      label: "Campaign note",
      fieldType: "text",
      section: "order",
      showOnCreate: true,
    }, {
      id: customNumberFieldId,
      fieldKey: `quantity_${suffix.replaceAll("-", "").slice(0, 16)}`,
      label: "Custom quantity",
      fieldType: "number",
      section: "order",
      showOnCreate: true,
    }]);
    await database.insert(checkoutSessions).values([
      { id: refundedSessionId, tokenDigest: `refunded-${suffix}`, expiresAt: new Date("2099-01-01T00:00:00Z") },
      { id: cancelledSessionId, tokenDigest: `cancelled-${suffix}`, expiresAt: new Date("2099-01-01T00:00:00Z") },
    ]);
    const orderValues = (id: string, checkoutSessionId: string, orderNumber: string, paymentStatus: "refunded" | "cancelled") => ({
      id,
      orderNumber,
      checkoutSessionId,
      checkoutSessionVersion: 1,
      idempotencyKey: randomUUID(),
      customerEmail: `${paymentStatus}-${suffix}@example.test`,
      pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
      deliveryMethod: "pickup" as const,
      shippingServiceCode: "pickup",
      shippingServiceName: "Pickup",
      productSubtotalExGstCents: 8_696,
      productGstCents: 1_304,
      productTotalInclGstCents: 10_000,
      shippingExGstCents: 0,
      shippingGstCents: 0,
      shippingTotalInclGstCents: 0,
      totalExGstCents: 8_696,
      totalGstCents: 1_304,
      totalInclGstCents: 10_000,
      paymentStatus,
    });
    await database.insert(orders).values([
      orderValues(refundedOrderId, refundedSessionId, `RNR-REF-${suffix.slice(0, 6)}`, "refunded"),
      orderValues(cancelledOrderId, cancelledSessionId, `RNR-CAN-${suffix.slice(0, 6)}`, "cancelled"),
    ]);
    await database.insert(productionJobs).values([
      {
        id: assignedJobId,
        jobNumber: `07A-${suffix.slice(0, 6)}`,
        source: "manual",
        idempotencyKey: `forms-job-a-${suffix}`,
        requestDigest: "a".repeat(64),
        customerName: "Visible Customer",
        customerEmail: "visible@example.test",
        customerPhone: "0210000000",
        customerSource: "rnr",
        webOrderNumber: "WEB-A0",
        manualStatus: "designing",
        manualPaymentStatus: "paid",
        urgent: true,
        neededDate: "2026-08-12",
        deliveryMethod: "post",
        paymentReconciliationStatus: "Arrive",
        assignedUserId: operatorId,
        internalNotes: "Visible remark",
        amountPayableCents: 23000,
        amountPaidCents: 10000,
        artistFeeCents: 5000,
        materialCostCents: 1000,
        fileSentAt: new Date("2026-08-05T01:00:00Z"),
        createdByUserId: otherUserId,
      },
      {
        id: otherJobId,
        jobNumber: `07B-${suffix.slice(0, 6)}`,
        source: "manual",
        idempotencyKey: `forms-job-b-${suffix}`,
        requestDigest: "b".repeat(64),
        customerName: "Hidden Customer",
        customerEmail: "hidden@example.test",
        customerPhone: "0220000000",
        customerSource: "market",
        manualStatus: "on_hold",
        manualPaymentStatus: "awaiting_payment",
        urgent: false,
        neededDate: "2026-08-15",
        deliveryMethod: "pickup",
        assignedUserId: otherUserId,
        amountPayableCents: 5000,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
        createdByUserId: operatorId,
      },
      {
        id: refundedJobId,
        jobNumber: `RNR-REF-${suffix.slice(0, 6)}`,
        source: "web",
        orderId: refundedOrderId,
        customerName: "Refunded Customer",
        customerEmail: `refunded-${suffix}@example.test`,
        customerPhone: "",
        customerSource: "web",
        neededDate: "2026-08-20",
        deliveryMethod: "pickup",
        deliveredAt: new Date("2026-08-19T01:00:00Z"),
      },
      {
        id: cancelledJobId,
        jobNumber: `RNR-CAN-${suffix.slice(0, 6)}`,
        source: "web",
        orderId: cancelledOrderId,
        customerName: "Cancelled Customer",
        customerEmail: `cancelled-${suffix}@example.test`,
        customerPhone: "",
        customerSource: "web",
        neededDate: "2026-08-20",
        deliveryMethod: "pickup",
      },
      {
        id: legacyJobId,
        jobNumber: `07L-${suffix.slice(0, 6)}`,
        source: "manual",
        idempotencyKey: `legacy:rnrgallery-order-system:${suffix}`,
        requestDigest: "c".repeat(64),
        legacySource: "rnrgallery-order-system",
        legacyOrderId: suffix,
        customerName: "Legacy Customer",
        customerEmail: "",
        customerPhone: "",
        customerSource: "rnr",
        manualStatus: "completed",
        manualPaymentStatus: "paid",
        neededDate: "2026-08-21",
        deliveryMethod: "pickup",
        amountPayableCents: 0,
        amountPaidCents: 0,
        artistFeeCents: 0,
        materialCostCents: 0,
      },
    ]);
    await database.insert(productionJobItems).values([
      { jobId: assignedJobId, position: 0, productTitle: "Canvas", sizeLabel: "A0", quantity: 1 },
      { jobId: otherJobId, position: 0, productTitle: "Banner", sizeLabel: "85 cm × 200 cm", quantity: 1 },
    ]);
    const [submittedByField] = await database.select({ id: productionFieldDefinitions.id })
      .from(productionFieldDefinitions)
      .where(eq(productionFieldDefinitions.fieldKey, "submitted_by_name"));
    if (!submittedByField) throw new Error("Submitted-by fixture field is missing");
    await database.insert(productionFieldValues).values([{
      jobId: assignedJobId,
      fieldId: customFieldId,
      value: "gold campaign",
    }, {
      jobId: assignedJobId,
      fieldId: customNumberFieldId,
      value: "15.00",
    }, {
      jobId: legacyJobId,
      fieldId: submittedByField.id,
      value: "  Former Operator  ",
    }]);
  });

  afterAll(async () => {
    await database.delete(productionFieldValues).where(inArray(productionFieldValues.jobId, jobIds));
    await database.delete(productionJobItems).where(inArray(productionJobItems.jobId, jobIds));
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    await database.delete(orders).where(inArray(orders.id, orderIds));
    await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, sessionIds));
    await database.delete(productionFieldDefinitions).where(inArray(productionFieldDefinitions.id, [customFieldId, customNumberFieldId]));
    await database.delete(user).where(eq(user.id, operatorId));
    await database.delete(user).where(eq(user.id, otherUserId));
    await database.delete(user).where(eq(user.id, legacySubmitterId));
  });

  it("enforces assigned-only scope and removes protected payloads before return", async () => {
    const result = await listFormOrders(
      database,
      parseFormWorkbenchQuery({}),
      {
        actorUserId: operatorId,
        assignedOnly: true,
        canViewCustomerContact: false,
        canViewFinance: false,
      },
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: assignedJobId,
      size: "A0",
      customerEmail: null,
      customerPhone: null,
      finance: null,
      artistName: "Assigned Artist",
      submittedBy: "Other Artist",
      remark: "Visible remark",
      milestones: { fileSent: true, downloaded: false },
    });
  });

  it("projects finance and contact data only when allowed", async () => {
    const result = await listFormOrders(
      database,
      parseFormWorkbenchQuery({ q: "Visible Customer" }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: true,
        canViewFinance: true,
      },
    );

    expect(result.items[0]).toMatchObject({
      customerEmail: "visible@example.test",
      customerPhone: "0210000000",
      bankRecon: "Arrive",
      finance: {
        amountPayableCents: 23000,
        amountPaidCents: 10000,
        amountOwingCents: 13000,
        artistFeeCents: 5000,
      },
    });
  });

  it("projects auth, legacy and system submitters with the approved precedence", async () => {
    const result = await listFormOrders(
      database,
      parseFormWorkbenchQuery({ q: suffix.slice(0, 6) }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: false,
        canViewFinance: false,
      },
    );
    const submittedBy = new Map(result.items.map((item) => [item.id, item.submittedBy]));

    expect(submittedBy.get(assignedJobId)).toBe("Other Artist");
    expect(submittedBy.get(legacyJobId)).toBe("Former Operator");
    expect(submittedBy.get(refundedJobId)).toBe("System");
  });

  it("combines validated operational filters with AND or OR matching", async () => {
    const andResult = await listFormOrders(
      database,
      parseFormWorkbenchQuery({
        q: suffix.slice(0, 6),
        match: "and",
        filter: [
          "urgent~equals~true",
          "deliveryMethod~equals~post",
          "neededDate~between~2026-08-01%2C2026-08-13",
        ],
      }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: true,
        canViewFinance: true,
      },
    );
    expect(andResult.items.map((item) => item.id)).toEqual([assignedJobId]);

    const orResult = await listFormOrders(
      database,
      parseFormWorkbenchQuery({
        q: suffix.slice(0, 6),
        match: "or",
        filter: ["customerSource~equals~market", "status~equals~designing"],
      }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: false,
        canViewFinance: false,
      },
    );
    expect(new Set(orResult.items.map((item) => item.id))).toEqual(new Set([assignedJobId, otherJobId]));
  });

  it("does not treat a held order as Delivered No", async () => {
    const result = await listFormOrders(
      database,
      parseFormWorkbenchQuery({
        q: suffix.slice(0, 6),
        filter: "delivered~equals~false",
      }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: false,
        canViewFinance: false,
      },
    );

    expect(result.items.map((item) => item.id)).toContain(assignedJobId);
    expect(result.items.map((item) => item.id)).not.toContain(otherJobId);

    const delivered = await listFormOrders(
      database,
      parseFormWorkbenchQuery({
        q: suffix.slice(0, 6),
        filter: "delivered~equals~true",
      }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: false,
        canViewFinance: false,
      },
    );
    expect(delivered.items.map((item) => item.id)).toContain(refundedJobId);
    expect(delivered.items.map((item) => item.id)).not.toContain(assignedJobId);
  });

  it("filters existing manual-entry data including submitter, item size, finance, and configured values", async () => {
    const result = await listFormOrders(
      database,
      parseFormWorkbenchQuery({
        match: "and",
        filter: [
          `submittedByUserId~equals~${encodeURIComponent(otherUserId)}`,
          "customerName~contains~Visible",
          "size~contains~A0",
          "amountOwing~greaterThan~100.00",
          `custom%3A${customFieldId}~contains~gold`,
          `custom%3A${customNumberFieldId}~between~10.00%2C20.00`,
        ],
      }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: true,
        canViewFinance: true,
      },
    );

    expect(result.items.map((item) => item.id)).toEqual([assignedJobId]);
  });

  it("matches a migrated submitter name when the filter value is the current staff account", async () => {
    const result = await listFormOrders(
      database,
      parseFormWorkbenchQuery({
        filter: `submittedByUserId~equals~${encodeURIComponent(legacySubmitterId)}`,
      }),
      {
        actorUserId: operatorId,
        assignedOnly: false,
        canViewCustomerContact: false,
        canViewFinance: false,
      },
    );

    expect(result.items.map((item) => item.id)).toEqual([legacyJobId]);
  });

  it("uses the visible migrated submitter for empty and not-equals comparisons", async () => {
    const access = {
      actorUserId: operatorId,
      assignedOnly: false,
      canViewCustomerContact: false,
      canViewFinance: false,
    };
    const reference = `07L-${suffix.slice(0, 6)}`;

    const notEmpty = await listFormOrders(database, parseFormWorkbenchQuery({
      q: reference,
      filter: "submittedByUserId~isNotEmpty~",
    }), access);
    const empty = await listFormOrders(database, parseFormWorkbenchQuery({
      q: reference,
      filter: "submittedByUserId~isEmpty~",
    }), access);
    const notOtherUser = await listFormOrders(database, parseFormWorkbenchQuery({
      q: reference,
      filter: `submittedByUserId~notEquals~${encodeURIComponent(otherUserId)}`,
    }), access);

    expect(notEmpty.items.map((item) => item.id)).toEqual([legacyJobId]);
    expect(empty.items).toEqual([]);
    expect(notOtherUser.items.map((item) => item.id)).toEqual([legacyJobId]);
  });

  it("matches visible Web-prefixed references in quick and field searches", async () => {
    const visibleReference = `Web-RNR-REF-${suffix.slice(0, 6)}`;
    const access = {
      actorUserId: operatorId,
      assignedOnly: false,
      canViewCustomerContact: true,
      canViewFinance: true,
    };

    const quick = await listFormOrders(database, parseFormWorkbenchQuery({ q: visibleReference }), access);
    const filtered = await listFormOrders(database, parseFormWorkbenchQuery({
      filter: `reference~equals~${encodeURIComponent(visibleReference)}`,
    }), access);

    expect(quick.items.map((item) => item.id)).toEqual([refundedJobId]);
    expect(filtered.items.map((item) => item.id)).toEqual([refundedJobId]);
  });

  it("filters web finance using the same refunded and cancelled projection shown in the list", async () => {
    const access = {
      actorUserId: operatorId,
      assignedOnly: false,
      canViewCustomerContact: true,
      canViewFinance: true,
    };
    const refundedPaid = await listFormOrders(database, parseFormWorkbenchQuery({
      q: suffix.slice(0, 6),
      filter: "amountPaid~equals~100.00",
    }), access);
    const zeroOwing = await listFormOrders(database, parseFormWorkbenchQuery({
      q: suffix.slice(0, 6),
      filter: "amountOwing~equals~0.00",
    }), access);

    expect(refundedPaid.items.map((item) => item.id)).toContain(refundedJobId);
    expect(zeroOwing.items.map((item) => item.id)).toEqual(expect.arrayContaining([refundedJobId, cancelledJobId]));
  });
});
