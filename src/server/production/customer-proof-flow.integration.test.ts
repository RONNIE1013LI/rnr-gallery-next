import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLogs,
  checkoutSessions,
  customerNotificationOutbox,
  internalNotificationOutbox,
  internalNotificationRecipients,
  internalNotificationSubscriptions,
  orders,
  orderStatusHistory,
  productionJobFiles,
  productionJobs,
  productionProofReviews,
  user,
} from "@/server/db/schema";
import { createDrizzleProductionProofRepository } from "./drizzle-production-proof-repository";
import { createProductionProofService } from "./production-proof-service";
import { createDrizzleCustomerNotificationRepository } from "@/server/notifications/drizzle-customer-notification-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const suffix = randomUUID().replaceAll("-", "").toUpperCase();
const actorId = `proof-actor-${suffix}`;
const customerId = `proof-customer-${suffix}`;
const checkoutSessionId = randomUUID();
const orderId = randomUUID();
const jobId = randomUUID();
const orderNumber = `RNR-2026-${suffix.slice(0, 12)}`;
const unpaidCheckoutSessionId = randomUUID();
const unpaidOrderId = randomUUID();
const unpaidJobId = randomUUID();
const unpaidOrderNumber = `RNR-2026-U${suffix.slice(0, 11)}`;
const tokenDigest = "a".repeat(64);
const actorEmail = `proof-actor-${suffix}@example.test`;
const customerEmail = `proof-customer-${suffix}@example.test`;
const notificationRecipientId = randomUUID();
const notificationRecipientEmail = `proof-notifications-${suffix.toLowerCase()}@example.test`;

describe("customer proof flow", () => {
  beforeAll(async () => {
    const createdAt = new Date("2026-08-05T00:00:00.000Z");
    await database.insert(user).values([
      { id: actorId, name: "Proof Manager", email: actorEmail, role: "admin" },
      { id: customerId, name: "Proof Customer", email: customerEmail, role: "customer" },
    ]);
    await database.insert(internalNotificationRecipients).values({
      id: notificationRecipientId,
      email: notificationRecipientEmail,
      status: "active",
      verifiedAt: createdAt,
      createdByUserId: actorId,
      createdAt,
      updatedAt: createdAt,
    });
    await database.insert(internalNotificationSubscriptions).values([
      {
        recipientId: notificationRecipientId,
        topic: "proof_approved",
        createdAt,
        updatedAt: createdAt,
      },
      {
        recipientId: notificationRecipientId,
        topic: "proof_changes_requested",
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    await database.insert(checkoutSessions).values([
      {
        id: checkoutSessionId,
        tokenDigest,
        customerId,
        version: 1,
        completedAt: createdAt,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: unpaidCheckoutSessionId,
        tokenDigest: "f".repeat(64),
        customerId,
        version: 1,
        completedAt: createdAt,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    await database.insert(orders).values([
      {
        id: orderId,
        orderNumber,
        checkoutSessionId,
        checkoutSessionVersion: 1,
        idempotencyKey: randomUUID(),
        customerId,
        customerEmail,
        pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
        deliveryMethod: "pickup",
        shippingServiceCode: "pickup",
        shippingServiceName: "Pickup",
        productSubtotalExGstCents: 0,
        productGstCents: 0,
        productTotalInclGstCents: 0,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        shippingTotalInclGstCents: 0,
        totalExGstCents: 0,
        totalGstCents: 0,
        totalInclGstCents: 0,
        paymentStatus: "paid",
        fulfilmentStatus: "designing",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: unpaidOrderId,
        orderNumber: unpaidOrderNumber,
        checkoutSessionId: unpaidCheckoutSessionId,
        checkoutSessionVersion: 1,
        idempotencyKey: randomUUID(),
        customerId,
        customerEmail,
        pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
        deliveryMethod: "pickup",
        shippingServiceCode: "pickup",
        shippingServiceName: "Pickup",
        productSubtotalExGstCents: 0,
        productGstCents: 0,
        productTotalInclGstCents: 0,
        shippingExGstCents: 0,
        shippingGstCents: 0,
        shippingTotalInclGstCents: 0,
        totalExGstCents: 0,
        totalGstCents: 0,
        totalInclGstCents: 0,
        paymentStatus: "awaiting_payment",
        fulfilmentStatus: "new",
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    await database.insert(productionJobs).values([
      {
        id: jobId,
        jobNumber: orderNumber,
        source: "web",
        orderId,
        customerName: "Proof Customer",
        customerEmail,
        customerPhone: "+64210000000",
        customerSource: "web",
        urgent: false,
        neededDate: "2026-08-20",
        deliveryMethod: "pickup",
        designRequirements: "Review online",
        internalNotes: "",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: unpaidJobId,
        jobNumber: unpaidOrderNumber,
        source: "web",
        orderId: unpaidOrderId,
        customerName: "Proof Customer",
        customerEmail,
        customerPhone: "+64210000000",
        customerSource: "web",
        urgent: false,
        neededDate: "2026-08-20",
        deliveryMethod: "pickup",
        designRequirements: "Must remain blocked until paid",
        internalNotes: "",
        createdAt,
        updatedAt: createdAt,
      },
    ]);
  });

  afterAll(async () => {
    await database.delete(adminAuditLogs).where(and(
      eq(adminAuditLogs.resourceType, "production_job"),
      eq(adminAuditLogs.resourceId, jobId),
    ));
    await database.delete(productionJobs).where(inArray(productionJobs.id, [jobId, unpaidJobId]));
    await database.delete(orders).where(inArray(orders.id, [orderId, unpaidOrderId]));
    await database.delete(checkoutSessions).where(inArray(checkoutSessions.id, [checkoutSessionId, unpaidCheckoutSessionId]));
    await database.delete(internalNotificationOutbox)
      .where(eq(internalNotificationOutbox.recipientId, notificationRecipientId));
    await database.delete(internalNotificationRecipients)
      .where(eq(internalNotificationRecipients.id, notificationRecipientId));
    await database.delete(user).where(inArray(user.id, [actorId, customerId]));
    await pool.end();
  });

  it("publishes only the latest draft and records a customer decision atomically", async () => {
    let now = new Date("2026-08-05T01:00:00.000Z");
    const service = createProductionProofService(
      createDrizzleProductionProofRepository(database),
      { now: () => now },
    );
    const baseReference = {
      originalName: "draft.jpg",
      mimeType: "image/jpeg" as const,
      size: 3,
      sha256: "b".repeat(64),
    };
    const firstId = randomUUID();
    const secondId = randomUUID();
    const thirdId = randomUUID();
    const fourthId = randomUUID();

    await service.registerFile({ userId: actorId, email: actorEmail }, jobId, {
      kind: "design_draft",
      idempotencyKey: `proof-1-${suffix}`,
      reference: { ...baseReference, id: firstId, storageKey: `${firstId}.bin` },
    }, { canManageFinance: false });
    now = new Date("2026-08-05T02:00:00.000Z");
    await service.registerFile({ userId: actorId, email: actorEmail }, jobId, {
      kind: "design_draft",
      idempotencyKey: `proof-2-${suffix}`,
      reference: { ...baseReference, id: secondId, storageKey: `${secondId}.bin`, sha256: "c".repeat(64) },
    }, { canManageFinance: false });

    await expect(service.listCustomerProofs(orderNumber, {
      kind: "customer",
      userId: "another-customer",
    })).rejects.toMatchObject({ name: "ProductionProofNotFoundError" });
    await expect(service.listCustomerProofs(orderNumber, {
      kind: "checkout",
      tokenDigest,
    })).resolves.toMatchObject({
      fulfilmentStatus: "awaiting_customer",
      files: [
        expect.objectContaining({ id: secondId, version: 2 }),
        expect.objectContaining({ id: firstId, version: 1 }),
      ],
    });
    await expect(service.listCustomerProofs(orderNumber, {
      kind: "signed",
      fileId: secondId,
    })).resolves.toMatchObject({
      files: [expect.objectContaining({ id: secondId, version: 2 })],
    });

    await expect(service.recordCustomerReview(orderNumber, {
      kind: "customer",
      userId: customerId,
    }, {
      fileId: firstId,
      decision: "approved",
      notes: "",
      idempotencyKey: `customer-old-${suffix}`,
    })).rejects.toMatchObject({ name: "ProductionProofValidationError" });

    now = new Date("2026-08-05T03:00:00.000Z");
    const changeRequest = await service.recordCustomerReview(orderNumber, {
      kind: "customer",
      userId: customerId,
    }, {
      fileId: secondId,
      decision: "changes_requested",
      notes: "Move the title and use the warmer background.",
      idempotencyKey: `customer-change-${suffix}`,
    });
    expect(changeRequest).toMatchObject({ result: "created" });
    expect((await database.select({ status: orders.fulfilmentStatus }).from(orders)
      .where(eq(orders.id, orderId)))[0]?.status).toBe("designing");

    now = new Date("2026-08-05T04:00:00.000Z");
    await service.registerFile({ userId: actorId, email: actorEmail }, jobId, {
      kind: "design_draft",
      idempotencyKey: `proof-3-${suffix}`,
      reference: { ...baseReference, id: thirdId, storageKey: `${thirdId}.bin`, sha256: "d".repeat(64) },
    }, { canManageFinance: false });
    now = new Date("2026-08-05T05:00:00.000Z");
    const approval = await service.recordCustomerReview(orderNumber, {
      kind: "signed",
      fileId: thirdId,
    }, {
      fileId: thirdId,
      decision: "approved",
      notes: "This note must not be persisted for approval.",
      idempotencyKey: `customer-approve-${suffix}`,
    });
    await expect(service.recordCustomerReview(orderNumber, {
      kind: "signed",
      fileId: thirdId,
    }, {
      fileId: thirdId,
      decision: "approved",
      notes: "",
      idempotencyKey: `customer-approve-${suffix}`,
    })).resolves.toMatchObject({ result: "duplicate", review: { id: approval.review.id } });

    expect((await database.select({ status: orders.fulfilmentStatus }).from(orders)
      .where(eq(orders.id, orderId)))[0]?.status).toBe("ready_to_print");

    now = new Date("2026-08-05T05:10:00.000Z");
    await service.registerFile({ userId: actorId, email: actorEmail }, jobId, {
      kind: "design_draft",
      idempotencyKey: `proof-4-${suffix}`,
      reference: { ...baseReference, id: fourthId, storageKey: `${fourthId}.bin`, sha256: "e".repeat(64) },
    }, { canManageFinance: false });
    now = new Date("2026-08-05T05:20:00.000Z");
    await expect(service.recordReview({ userId: actorId, email: actorEmail }, jobId, {
      fileId: fourthId,
      decision: "approved",
      notes: "Confirmed with the customer by phone.",
      idempotencyKey: `staff-approve-${suffix}`,
    })).resolves.toMatchObject({ result: "created" });
    expect((await database.select({ status: orders.fulfilmentStatus }).from(orders)
      .where(eq(orders.id, orderId)))[0]?.status).toBe("ready_to_print");

    expect(await database.select().from(productionProofReviews)
      .where(eq(productionProofReviews.jobId, jobId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: secondId, reviewerType: "customer", decision: "changes_requested" }),
      expect.objectContaining({ fileId: thirdId, reviewerType: "customer", decision: "approved", notes: "" }),
      expect.objectContaining({ fileId: fourthId, reviewerType: "staff", decision: "approved" }),
    ]));
    expect(await database.select().from(customerNotificationOutbox)
      .where(eq(customerNotificationOutbox.jobId, jobId))).toHaveLength(4);
    expect(await database.select().from(internalNotificationOutbox)
      .where(eq(internalNotificationOutbox.recipientId, notificationRecipientId)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventKey: `proof_changes_requested:${changeRequest.review.id}:${notificationRecipientId}`,
          topic: "proof_changes_requested",
          sourceEventId: changeRequest.review.id,
          resourceType: "proof_review",
          resourceId: changeRequest.review.id,
          resourceReference: orderNumber,
          recipientEmail: notificationRecipientEmail,
          payload: { version: 1, adminPath: `/admin/jobs/${jobId}` },
        }),
        expect.objectContaining({
          eventKey: `proof_approved:${approval.review.id}:${notificationRecipientId}`,
          topic: "proof_approved",
          sourceEventId: approval.review.id,
          resourceType: "proof_review",
          resourceId: approval.review.id,
          resourceReference: orderNumber,
          recipientEmail: notificationRecipientEmail,
          payload: { version: 1, adminPath: `/admin/jobs/${jobId}` },
        }),
      ]));
    expect(await database.select().from(internalNotificationOutbox)
      .where(eq(internalNotificationOutbox.recipientId, notificationRecipientId)))
      .toHaveLength(2);
    expect(await database.select().from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))).toHaveLength(6);

    const notifications = createDrizzleCustomerNotificationRepository(database);
    const claimed = await notifications.claimForFile(thirdId, new Date("2026-08-05T05:30:00.000Z"));
    expect(claimed).toMatchObject({
      fileId: thirdId,
      orderNumber,
      proofVersion: 3,
      recipientEmail: customerEmail,
      status: "sending",
      attempts: 1,
    });
    expect(await notifications.markSent(claimed!.id, "provider-message-1", new Date("2026-08-05T05:31:00.000Z"))).toBe(true);
    expect((await database.select({ notifiedAt: productionJobs.customerNotifiedAt }).from(productionJobs)
      .where(eq(productionJobs.id, jobId)))[0]?.notifiedAt).toEqual(new Date("2026-08-05T05:31:00.000Z"));
    expect(await notifications.claimForFile(thirdId, new Date("2026-08-05T05:32:00.000Z"))).toBeNull();
    expect(await notifications.listForJob(jobId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: thirdId, status: "sent", sentAt: new Date("2026-08-05T05:31:00.000Z") }),
    ]));

    await database.update(customerNotificationOutbox).set({
      status: "failed",
      attempts: 5,
      availableAt: new Date("2026-08-05T05:32:00.000Z"),
      sentAt: null,
    }).where(eq(customerNotificationOutbox.fileId, thirdId));
    await expect(notifications.claimForFile(
      thirdId,
      new Date("2026-08-05T05:33:00.000Z"),
    )).resolves.toMatchObject({ attempts: 6 });
  });

  it("records both customer proof decisions successfully with zero eligible recipients", async () => {
    const fixtureSessionIds: string[] = [];
    const fixtureOrderIds: string[] = [];
    const fixtureJobIds: string[] = [];
    const fixtureFileIds: string[] = [];
    const reviewIds: string[] = [];
    await database.delete(internalNotificationSubscriptions).where(and(
      eq(internalNotificationSubscriptions.recipientId, notificationRecipientId),
      inArray(internalNotificationSubscriptions.topic, [
        "proof_approved",
        "proof_changes_requested",
      ]),
    ));
    try {
      const service = createProductionProofService(
        createDrizzleProductionProofRepository(database),
      );
      for (const [index, decision] of [
        "approved",
        "changes_requested",
      ].entries()) {
        const sessionId = randomUUID();
        const fixtureOrderId = randomUUID();
        const fixtureJobId = randomUUID();
        const fileId = randomUUID();
        const fixtureOrderNumber = `RNR-2026-Z${decision === "approved" ? "A" : "C"}${suffix.slice(0, 8)}`;
        const createdAt = new Date(`2026-08-06T0${index + 1}:00:00.000Z`);
        fixtureSessionIds.push(sessionId);
        fixtureOrderIds.push(fixtureOrderId);
        fixtureJobIds.push(fixtureJobId);
        fixtureFileIds.push(fileId);
        await database.insert(checkoutSessions).values({
          id: sessionId,
          tokenDigest: `${index + 2}`.repeat(64),
          version: 1,
          completedAt: createdAt,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          createdAt,
          updatedAt: createdAt,
        });
        await database.insert(orders).values({
          id: fixtureOrderId,
          orderNumber: fixtureOrderNumber,
          checkoutSessionId: sessionId,
          checkoutSessionVersion: 1,
          idempotencyKey: randomUUID(),
          customerEmail,
          pricingSnapshot: {} as (typeof orders.$inferInsert)["pricingSnapshot"],
          deliveryMethod: "pickup",
          shippingServiceCode: "pickup",
          shippingServiceName: "Pickup",
          productSubtotalExGstCents: 0,
          productGstCents: 0,
          productTotalInclGstCents: 0,
          shippingExGstCents: 0,
          shippingGstCents: 0,
          shippingTotalInclGstCents: 0,
          totalExGstCents: 0,
          totalGstCents: 0,
          totalInclGstCents: 0,
          paymentStatus: "paid",
          fulfilmentStatus: "awaiting_customer",
          createdAt,
          updatedAt: createdAt,
        });
        await database.insert(productionJobs).values({
          id: fixtureJobId,
          jobNumber: fixtureOrderNumber,
          source: "web",
          orderId: fixtureOrderId,
          customerName: "Zero Recipient Proof Customer",
          customerEmail,
          customerPhone: "+64210000000",
          customerSource: "web",
          urgent: false,
          neededDate: "2026-08-20",
          deliveryMethod: "pickup",
          designRequirements: "Zero recipient review",
          internalNotes: "",
          createdAt,
          updatedAt: createdAt,
        });
        await database.insert(productionJobFiles).values({
          id: fileId,
          jobId: fixtureJobId,
          kind: "design_draft",
          version: 1,
          originalName: "zero-recipient-proof.jpg",
          mediaType: "image/jpeg",
          sizeBytes: 3,
          storageKey: `${fileId}.bin`,
          sha256: `${index + 4}`.repeat(64),
          idempotencyKey: `zero-recipient-proof-file-${fileId}`,
          requestDigest: `${index + 6}`.repeat(64),
          uploadedByUserId: actorId,
          createdAt,
        });

        const result = await service.recordCustomerReview(fixtureOrderNumber, {
          kind: "signed",
          fileId,
        }, {
          fileId,
          decision: decision as "approved" | "changes_requested",
          notes: decision === "approved" ? "" : "Please revise the layout.",
          idempotencyKey: `zero-recipient-proof-review-${fileId}`,
        });
        expect(result).toMatchObject({ result: "created" });
        if (result.result !== "created") throw new Error("Expected customer review creation");
        reviewIds.push(result.review.id);
        await expect(database.select().from(internalNotificationOutbox).where(eq(
          internalNotificationOutbox.sourceEventId,
          result.review.id,
        ))).resolves.toEqual([]);
        await expect(database.select().from(customerNotificationOutbox).where(eq(
          customerNotificationOutbox.jobId,
          fixtureJobId,
        ))).resolves.toEqual([]);
      }
    } finally {
      await database.insert(internalNotificationSubscriptions).values([
        {
          recipientId: notificationRecipientId,
          topic: "proof_approved",
          createdAt: new Date("2026-08-05T00:00:00.000Z"),
          updatedAt: new Date("2026-08-05T00:00:00.000Z"),
        },
        {
          recipientId: notificationRecipientId,
          topic: "proof_changes_requested",
          createdAt: new Date("2026-08-05T00:00:00.000Z"),
          updatedAt: new Date("2026-08-05T00:00:00.000Z"),
        },
      ]).onConflictDoNothing();
      if (reviewIds.length > 0) {
        await database.delete(internalNotificationOutbox).where(inArray(
          internalNotificationOutbox.sourceEventId,
          reviewIds,
        ));
      }
      if (fixtureJobIds.length > 0) {
        await database.delete(adminAuditLogs).where(and(
          eq(adminAuditLogs.resourceType, "production_job"),
          inArray(adminAuditLogs.resourceId, fixtureJobIds),
        ));
      }
      if (fixtureOrderIds.length > 0) {
        await database.delete(orderStatusHistory).where(inArray(
          orderStatusHistory.orderId,
          fixtureOrderIds,
        ));
      }
      if (fixtureFileIds.length > 0) {
        await database.delete(productionProofReviews).where(inArray(
          productionProofReviews.fileId,
          fixtureFileIds,
        ));
        await database.delete(productionJobFiles).where(inArray(
          productionJobFiles.id,
          fixtureFileIds,
        ));
      }
      if (fixtureJobIds.length > 0) {
        await database.delete(productionJobs).where(inArray(
          productionJobs.id,
          fixtureJobIds,
        ));
      }
      if (fixtureOrderIds.length > 0) {
        await database.delete(orders).where(inArray(orders.id, fixtureOrderIds));
      }
      if (fixtureSessionIds.length > 0) {
        await database.delete(checkoutSessions).where(inArray(
          checkoutSessions.id,
          fixtureSessionIds,
        ));
      }
    }
  });

  it("does not accept a design draft for an unpaid web order", async () => {
    const service = createProductionProofService(createDrizzleProductionProofRepository(database));
    const fileId = randomUUID();

    await expect(service.registerFile({ userId: actorId, email: actorEmail }, unpaidJobId, {
      kind: "design_draft",
      idempotencyKey: `unpaid-proof-${suffix}`,
      reference: {
        id: fileId,
        originalName: "unpaid-draft.jpg",
        mimeType: "image/jpeg",
        size: 3,
        storageKey: `${fileId}.bin`,
        sha256: "9".repeat(64),
      },
    }, { canManageFinance: false })).rejects.toMatchObject({
      name: "ProductionProofConflictError",
      message: "Payment must be confirmed before production can begin",
    });

    await expect(database.select({ id: productionJobFiles.id }).from(productionJobFiles)
      .where(eq(productionJobFiles.jobId, unpaidJobId))).resolves.toEqual([]);
    await expect(database.select({ status: orders.fulfilmentStatus }).from(orders)
      .where(eq(orders.id, unpaidOrderId))).resolves.toEqual([{ status: "new" }]);
  });
});
