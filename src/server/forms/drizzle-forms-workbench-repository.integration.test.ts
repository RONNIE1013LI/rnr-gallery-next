import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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
const assignedJobId = randomUUID();
const otherJobId = randomUUID();
const customFieldId = randomUUID();
const customNumberFieldId = randomUUID();
const jobIds = [assignedJobId, otherJobId];

describe("forms workbench repository", () => {
  beforeAll(async () => {
    await database.insert(user).values([
      { id: operatorId, name: "Assigned Artist", email: `artist-${suffix}@example.test`, role: "form_staff" },
      { id: otherUserId, name: "Other Artist", email: `other-${suffix}@example.test`, role: "staff" },
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
        manualStatus: "new",
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
    ]);
    await database.insert(productionJobItems).values([
      { jobId: assignedJobId, position: 0, productTitle: "Canvas", sizeLabel: "A0", quantity: 1 },
      { jobId: otherJobId, position: 0, productTitle: "Banner", sizeLabel: "85 cm × 200 cm", quantity: 1 },
    ]);
    await database.insert(productionFieldValues).values([{
      jobId: assignedJobId,
      fieldId: customFieldId,
      value: "gold campaign",
    }, {
      jobId: assignedJobId,
      fieldId: customNumberFieldId,
      value: "15.00",
    }]);
  });

  afterAll(async () => {
    await database.delete(productionFieldValues).where(inArray(productionFieldValues.fieldId, [customFieldId, customNumberFieldId]));
    await database.delete(productionJobItems).where(inArray(productionJobItems.jobId, jobIds));
    await database.delete(productionJobs).where(inArray(productionJobs.id, jobIds));
    await database.delete(productionFieldDefinitions).where(inArray(productionFieldDefinitions.id, [customFieldId, customNumberFieldId]));
    await database.delete(user).where(eq(user.id, operatorId));
    await database.delete(user).where(eq(user.id, otherUserId));
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
    expect(new Set(orResult.items.map((item) => item.id))).toEqual(new Set(jobIds));
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
});
