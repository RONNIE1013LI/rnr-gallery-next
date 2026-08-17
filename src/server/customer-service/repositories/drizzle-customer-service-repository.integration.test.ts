import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceMessages,
  customerServicePilotRuns,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "./drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerServiceRepository(database);

async function clearTables() {
  await database.delete(customerServiceFeedbackEvents);
  await database.delete(customerServiceAiAttempts);
  await database.delete(customerServiceImageAnalysisInputs);
  await database.delete(customerServiceImageAnalysisAttempts);
  await database.delete(customerServiceAttachments);
  await database.delete(customerServiceMessages);
  await database.delete(customerServiceConversations);
  await database.delete(customerServiceBudgetState);
  await database.delete(customerServicePilotRuns);
}

describe.runIf(enabled)("DrizzleCustomerServiceRepository", () => {
  beforeEach(clearTables);
  afterAll(clearTables);

  it("deduplicates concurrent webhook ingestion and allocates one pilot slot", async () => {
    await database.insert(customerServicePilotRuns).values({
      name: "test-facebook",
      channel: "facebook",
      messageLimit: 100,
      status: "active",
      startedAt: new Date(),
    });
    const message = {
      channel: "facebook" as const,
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: "How do I prepare my photos?",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    };
    const results = await Promise.all([
      repository.ingestFacebookMessage(message),
      repository.ingestFacebookMessage(message),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual(["created", "duplicate"]);
    const [persisted] = await database.select().from(customerServiceMessages);
    expect(persisted).toMatchObject({
      body: "How do I prepare my photos?",
      customerText: "How do I prepare my photos?",
    });
  });

  it("loads context from the current conversation only", async () => {
    await database.insert(customerServicePilotRuns).values({
      name: "context-facebook",
      channel: "facebook",
      messageLimit: 100,
      status: "active",
      startedAt: new Date(),
    });
    const first = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "1".repeat(64),
      externalMessageKeyHash: "2".repeat(64),
      text: "first conversation",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "3".repeat(64),
      externalMessageKeyHash: "4".repeat(64),
      text: "other customer",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:00:01.000Z"),
    });
    expect(first.status).toBe("created");
    if (first.status !== "created") return;
    await expect(repository.loadDraftInput(first.messageId, 6)).resolves.toMatchObject({
      context: ["first conversation"],
    });
  });

  it("commits message and safe attachment metadata atomically without duplicating attachments", async () => {
    const receivedAt = new Date("2026-08-17T00:00:00.000Z");
    const message = {
      channel: "facebook" as const,
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: null,
      attachments: [{
        externalAttachmentKeyHash: "c".repeat(64),
        ordinal: 0,
        kind: "image" as const,
        mimeTypeHint: "image/jpeg",
      }],
      receivedAt,
    };

    const created = await repository.ingestFacebookMessage(message);
    expect(created.status).toBe("pilot_complete");
    const [persistedMessage] = await database.select().from(customerServiceMessages);
    const [persistedAttachment] = await database.select().from(customerServiceAttachments);
    expect(persistedMessage).toMatchObject({
      body: "[Image attachment]",
      customerText: null,
      receivedAt,
    });
    expect(persistedAttachment).toMatchObject({
      messageId: persistedMessage.id,
      conversationId: persistedMessage.conversationId,
      externalAttachmentKeyHash: "c".repeat(64),
      ordinal: 0,
      kind: "image",
      mimeTypeHint: "image/jpeg",
      status: "metadata_received",
    });
    expect(JSON.stringify([persistedMessage, persistedAttachment])).not.toContain("https://scontent.test/image.jpg");

    await expect(repository.ingestFacebookMessage(message)).resolves.toMatchObject({ status: "duplicate" });
    expect(await database.select().from(customerServiceAttachments)).toHaveLength(1);

    await expect(repository.ingestFacebookMessage({
      ...message,
      externalMessageKeyHash: "d".repeat(64),
      attachments: [
        { ...message.attachments[0], ordinal: 0 },
        { ...message.attachments[0], externalAttachmentKeyHash: "e".repeat(64), ordinal: 0 },
      ],
    })).rejects.toThrow();
    expect(await database.select().from(customerServiceMessages)).toHaveLength(1);
    expect(await database.select().from(customerServiceAttachments)).toHaveLength(1);
  });

  it("selects current-message attachments in stable ordinal order", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: "Please check these photos",
      attachments: [
        { externalAttachmentKeyHash: "c".repeat(64), ordinal: 1, kind: "image", mimeTypeHint: "image/png" },
        { externalAttachmentKeyHash: "d".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: "image/jpeg" },
      ],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).toBe("pilot_complete");
    if (created.status === "duplicate") return;

    const attachments = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .orderBy(customerServiceAttachments.ordinal);
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: null,
    });
  });

  it("selects up to five recent attachment-only images from the same conversation", async () => {
    const conversation = "a".repeat(64);
    const start = new Date("2026-08-17T00:00:00.000Z");
    const prior = await Promise.all(Array.from({ length: 6 }, async (_, index) => (
      repository.ingestFacebookMessage({
        channel: "facebook",
        externalConversationKeyHash: conversation,
        externalMessageKeyHash: `${index}`.padStart(64, "b"),
        text: null,
        attachments: [{
          externalAttachmentKeyHash: `${index}`.padStart(64, "c"),
          ordinal: 0,
          kind: "image",
          mimeTypeHint: null,
        }],
        receivedAt: new Date(start.getTime() + index * 60_000),
      })
    )));
    const other = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "d".repeat(64),
      externalMessageKeyHash: "e".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "f".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date(start.getTime() + 6 * 60_000),
    });
    const current = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "g".repeat(64),
      text: "Can you use them?",
      attachments: [],
      receivedAt: new Date(start.getTime() + 6 * 60_000),
    });
    expect(current.status).toBe("pilot_complete");
    if (current.status === "duplicate") return;

    const selected = await repository.selectImageContext(current.messageId);
    expect(selected).toMatchObject({ messageId: current.messageId, analysisSummary: null });
    expect(selected?.attachmentIds).toHaveLength(5);
    const [oldest] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, prior[0].messageId));
    const [otherAttachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, other.messageId));
    expect(selected?.attachmentIds).not.toContain(oldest.id);
    expect(selected?.attachmentIds).not.toContain(otherAttachment.id);
  });

  it("stops image context at the first earlier text message", async () => {
    const conversation = "a".repeat(64);
    const start = new Date("2026-08-17T00:00:00.000Z");
    const beforeText = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "b".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "c".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: start,
    });
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "d".repeat(64),
      text: "This is a new request",
      attachments: [],
      receivedAt: new Date(start.getTime() + 60_000),
    });
    const afterText = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "e".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "f".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date(start.getTime() + 2 * 60_000),
    });
    const current = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: conversation,
      externalMessageKeyHash: "g".repeat(64),
      text: "Can you use it?",
      attachments: [],
      receivedAt: new Date(start.getTime() + 3 * 60_000),
    });
    expect(current.status).toBe("pilot_complete");
    if (current.status === "duplicate" || beforeText.status === "duplicate" || afterText.status === "duplicate") return;

    const [allowed] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, afterText.messageId));
    const [blocked] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, beforeText.messageId));
    await expect(repository.selectImageContext(current.messageId)).resolves.toEqual({
      messageId: current.messageId,
      attachmentIds: [allowed.id],
      analysisSummary: null,
    });
    expect(allowed.id).not.toBe(blocked.id);
  });

  it("does not select attachment-only messages older than five minutes", async () => {
    const start = new Date("2026-08-17T00:00:00.000Z");
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: null,
      attachments: [{ externalAttachmentKeyHash: "c".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: start,
    });
    const current = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "d".repeat(64),
      text: "Can you use it?",
      attachments: [],
      receivedAt: new Date(start.getTime() + 5 * 60_000 + 1),
    });
    expect(current.status).toBe("pilot_complete");
    if (current.status === "duplicate") return;

    await expect(repository.selectImageContext(current.messageId)).resolves.toBeNull();
  });

  it("uses createdAt and id to order same-timestamp predecessors and stop at text", async () => {
    const receivedAt = new Date("2026-08-17T00:00:00.000Z");
    const createdAt = new Date("2026-08-17T00:00:01.000Z");
    const conversationId = "00000000-0000-0000-0000-000000000001";
    const beforeTextId = "00000000-0000-0000-0000-000000000010";
    const textBoundaryId = "00000000-0000-0000-0000-000000000020";
    const afterTextId = "00000000-0000-0000-0000-000000000030";
    const currentId = "00000000-0000-0000-0000-000000000040";
    const beforeTextAttachmentId = "00000000-0000-0000-0000-000000000101";
    const afterTextAttachmentId = "00000000-0000-0000-0000-000000000103";

    await database.insert(customerServiceConversations).values({
      id: conversationId,
      channel: "facebook",
      externalKeyHash: "a".repeat(64),
      createdAt,
    });
    await database.insert(customerServiceMessages).values([
      {
        id: beforeTextId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "b".repeat(64),
        body: "[Image attachment]",
        customerText: null,
        receivedAt,
        createdAt,
      },
      {
        id: textBoundaryId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "c".repeat(64),
        body: "A new request",
        customerText: "A new request",
        receivedAt,
        createdAt,
      },
      {
        id: afterTextId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "d".repeat(64),
        body: "[Image attachment]",
        customerText: null,
        receivedAt,
        createdAt,
      },
      {
        id: currentId,
        conversationId,
        channel: "facebook",
        externalMessageKeyHash: "e".repeat(64),
        body: "Can you use it?",
        customerText: "Can you use it?",
        receivedAt,
        createdAt,
      },
    ]);
    await database.insert(customerServiceAttachments).values([
      {
        id: beforeTextAttachmentId,
        messageId: beforeTextId,
        conversationId,
        externalAttachmentKeyHash: "f".repeat(64),
        ordinal: 0,
      },
      {
        id: afterTextAttachmentId,
        messageId: afterTextId,
        conversationId,
        externalAttachmentKeyHash: "g".repeat(64),
        ordinal: 0,
      },
    ]);

    await expect(repository.selectImageContext(currentId)).resolves.toEqual({
      messageId: currentId,
      attachmentIds: [afterTextAttachmentId],
      analysisSummary: null,
    });
  });

  it("keeps microsecond createdAt ordering in PostgreSQL for image context boundaries", async () => {
    const receivedAt = new Date("2026-08-17T00:00:00.000Z");
    const conversationId = "00000000-0000-0000-0000-000000000002";
    const beforeTextId = "00000000-0000-0000-0000-000000000110";
    const textBoundaryId = "00000000-0000-0000-0000-000000000120";
    const afterTextId = "00000000-0000-0000-0000-000000000130";
    const currentId = "00000000-0000-0000-0000-000000000140";
    const beforeTextAttachmentId = "00000000-0000-0000-0000-000000000201";
    const afterTextAttachmentId = "00000000-0000-0000-0000-000000000203";

    await database.insert(customerServiceConversations).values({
      id: conversationId,
      channel: "facebook",
      externalKeyHash: "h".repeat(64),
    });
    await database.execute(sql`
      insert into customer_service_messages (
        id, conversation_id, channel, external_message_key_hash, body, customer_text, received_at, created_at
      ) values
        (${beforeTextId}, ${conversationId}, 'facebook', ${"i".repeat(64)}, '[Image attachment]', null, ${receivedAt}, '2026-08-17 00:00:01.000001+00'),
        (${textBoundaryId}, ${conversationId}, 'facebook', ${"j".repeat(64)}, 'A new request', 'A new request', ${receivedAt}, '2026-08-17 00:00:01.000002+00'),
        (${afterTextId}, ${conversationId}, 'facebook', ${"k".repeat(64)}, '[Image attachment]', null, ${receivedAt}, '2026-08-17 00:00:01.000003+00'),
        (${currentId}, ${conversationId}, 'facebook', ${"l".repeat(64)}, 'Can you use it?', 'Can you use it?', ${receivedAt}, '2026-08-17 00:00:01.000004+00')
    `);
    await database.insert(customerServiceAttachments).values([
      {
        id: beforeTextAttachmentId,
        messageId: beforeTextId,
        conversationId,
        externalAttachmentKeyHash: "m".repeat(64),
        ordinal: 0,
      },
      {
        id: afterTextAttachmentId,
        messageId: afterTextId,
        conversationId,
        externalAttachmentKeyHash: "n".repeat(64),
        ordinal: 0,
      },
    ]);

    await expect(repository.selectImageContext(currentId)).resolves.toEqual({
      messageId: currentId,
      attachmentIds: [afterTextAttachmentId],
      analysisSummary: null,
    });
  });

  it("persists exact image analysis inputs and shares budget accounting with draft generation", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "a".repeat(64),
      externalMessageKeyHash: "b".repeat(64),
      text: "Can you assess these photos?",
      attachments: [
        { externalAttachmentKeyHash: "c".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null },
        { externalAttachmentKeyHash: "d".repeat(64), ordinal: 1, kind: "image", mimeTypeHint: null },
      ],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).toBe("pilot_complete");
    if (created.status === "duplicate") return;
    const attachments = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .orderBy(customerServiceAttachments.ordinal);

    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: attachments.map((attachment, ordinal) => ({ attachmentId: attachment.id, ordinal })),
    });
    await repository.markImageAttachmentStored({
      attachmentId: attachments[0].id,
      verifiedMimeType: "image/png",
      width: 100,
      height: 80,
      byteSize: 64,
      sha256: "e".repeat(64),
      privateStorageKey: "customer-service-attachments/00000000-0000-4000-8000-000000000001.bin",
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    await expect(repository.reserveImageAnalysisAttempt({
      attemptId,
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    })).resolves.toEqual({ status: "reserved" });

    const analysis = {
      schemaVersion: "1" as const,
      overallStatus: "assessed" as const,
      images: attachments.map((_, ordinal) => ({
        ordinal,
        classification: "customer_photo" as const,
        blur: "mild" as const,
        sourceResolutionSignal: "normal" as const,
        subjectScale: "usable" as const,
        crop: "none_visible" as const,
        obstruction: "none_visible" as const,
        screenshotSignal: "none_visible" as const,
        recommendedRole: ordinal === 0 ? "main_candidate" as const : "side_candidate" as const,
        issueCodes: [],
      })),
      comparison: null,
      recommendationCodes: ["use_as_main_candidate" as const],
      safeSummary: "Image 0 is the likely main candidate.",
    };
    await repository.completeImageAnalysisAttempt({
      attemptId,
      status: "analyzed",
      providerCalled: true,
      provider: "mock",
      model: "mock-image",
      analysisResult: analysis,
      validatorCodes: [],
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      estimatedCostMicrousd: 25,
      latencyMs: 5,
      dailyScopeKey: "daily:2026-08-17",
      reservedCostMicrousd: 100,
    });
    await repository.markImageAttachmentDeleted({
      attachmentId: attachments[0].id,
      deleted: false,
      failureCode: "image_cleanup_failed",
    });

    const [attempt] = await database.select().from(customerServiceImageAnalysisAttempts)
      .where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    const inputs = await database.select().from(customerServiceImageAnalysisInputs)
      .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attemptId))
      .orderBy(customerServiceImageAnalysisInputs.ordinal);
    const budgets = await database.select().from(customerServiceBudgetState)
      .orderBy(customerServiceBudgetState.scopeKey);
    const [deletedAttachment] = await database.select().from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.id, attachments[0].id));
    expect(attempt).toMatchObject({ status: "analyzed", providerCalled: true, estimatedCostMicrousd: 25 });
    expect(inputs.map((item) => item.attachmentId)).toEqual(attachments.map((attachment) => attachment.id));
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 25 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 25 }),
    ]));
    expect(deletedAttachment).toMatchObject({ status: "failed", failureCode: "image_cleanup_failed" });
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: null,
    });
    for (const attachment of attachments) {
      await repository.markImageAttachmentDeleted({
        attachmentId: attachment.id,
        deleted: true,
        failureCode: null,
      });
    }
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: analysis.safeSummary,
    });

    const other = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "f".repeat(64),
      externalMessageKeyHash: "1".repeat(64),
      text: "Other customer",
      attachments: [{ externalAttachmentKeyHash: "2".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:01.000Z"),
    });
    expect(other.status).toBe("pilot_complete");
    if (other.status === "duplicate") return;
    const [otherAttachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, other.messageId));
    await expect(repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: otherAttachment.id, ordinal: 0 }],
    })).rejects.toThrow("customer_service_image_context_mismatch");
  });
});
