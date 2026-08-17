import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
  customerServiceMessages,
  customerServicePilotRuns,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "./drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerServiceRepository(database);
const sourceIdentitySecret = "integration-source-identity-secret";

function sourceHash(value: string) {
  return createHmac("sha256", sourceIdentitySecret).update(value).digest("hex");
}

function assessedAnalysis(safeSummary = "Image 0 is the likely main candidate.") {
  return {
    schemaVersion: "1" as const,
    overallStatus: "assessed" as const,
    images: [{
      ordinal: 0,
      classification: "customer_photo" as const,
      blur: "mild" as const,
      sourceResolutionSignal: "normal" as const,
      subjectScale: "usable" as const,
      crop: "none_visible" as const,
      obstruction: "none_visible" as const,
      screenshotSignal: "none_visible" as const,
      recommendedRole: "main_candidate" as const,
      issueCodes: [],
    }],
    comparison: null,
    recommendationCodes: ["use_as_main_candidate" as const],
    safeSummary,
  };
}

function imageCompletion(attemptId: string, status: "analyzed" | "provider_error") {
  return {
    attemptId,
    status,
    providerCalled: true,
    provider: "mock" as const,
    model: "mock-image",
    ...(status === "analyzed" ? { analysisResult: assessedAnalysis() } : {}),
    validatorCodes: [],
    inputTokens: 10,
    cachedInputTokens: 2,
    outputTokens: 4,
    estimatedCostMicrousd: 25,
    latencyMs: 5,
    ...(status === "provider_error" ? { providerErrorCode: "image_provider_error" } : {}),
  };
}

async function clearTables() {
  await database.delete(customerServiceFeedbackEvents);
  await database.delete(customerServiceImageJobs);
  await database.delete(customerServiceAiAttempts);
  await database.delete(customerServiceImageAnalysisInputs);
  await database.delete(customerServiceImageAnalysisAttempts);
  await database.delete(customerServiceAttachments);
  await database.delete(customerServiceMessages);
  await database.delete(customerServiceConversations);
  await database.delete(customerServiceBudgetState);
  await database.delete(customerServicePilotRuns);
}

async function activateFacebookPilot(name: string) {
  await database.insert(customerServicePilotRuns).values({
    name,
    channel: "facebook",
    messageLimit: 100,
    status: "active",
    startedAt: new Date("2026-08-17T00:00:00.000Z"),
  });
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
      current: { text: "first conversation" },
      context: ["first conversation"],
    });
  });

  it("uses customer_text only and never promotes an image compatibility marker into model context", async () => {
    const imageOnly = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "6".repeat(64),
      text: null,
      attachments: [{
        externalAttachmentKeyHash: "7".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const text = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Please assess this message only",
      attachments: [],
      receivedAt: new Date("2026-08-17T00:01:00.000Z"),
    });

    await expect(repository.loadDraftInput(imageOnly.messageId, 6)).resolves.toMatchObject({
      current: { text: null },
      context: [],
    });
    await expect(repository.loadDraftInput(text.messageId, 6)).resolves.toMatchObject({
      current: { text: "Please assess this message only" },
      context: ["Please assess this message only"],
    });
  });

  it("omits runnable image work when the pilot is complete", async () => {
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
      imageJob: {
        id: "00000000-0000-4000-8000-000000000101",
        status: "pending" as const,
        sourceCiphertext: "v1.encrypted-source",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
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
    expect(await database.select().from(customerServiceImageJobs)).toEqual([]);
    expect(JSON.stringify([persistedMessage, persistedAttachment])).not.toContain("https://scontent.test/image.jpg");

    const claimInput = {
      jobId: message.imageJob.id,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    };
    await expect(Promise.all([
      repository.claimImageJob(claimInput),
      repository.claimImageJob(claimInput),
    ])).resolves.toEqual([null, null]);
    await expect(repository.claimImageJob(claimInput)).resolves.toBeNull();

    await expect(repository.ingestFacebookMessage(message)).resolves.toMatchObject({ status: "duplicate" });
    expect(await database.select().from(customerServiceAttachments)).toHaveLength(1);
    expect(await database.select().from(customerServiceImageJobs)).toHaveLength(0);

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
    expect(await database.select().from(customerServiceImageJobs)).toHaveLength(0);
  });

  it("does not recover a legacy runnable image job without a pilot-bound message", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "d".repeat(64),
      externalMessageKeyHash: "e".repeat(64),
      text: "Can I use this photo?",
      attachments: [{
        externalAttachmentKeyHash: "f".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: "image/jpeg",
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).toBe("pilot_complete");
    const [message] = await database.select().from(customerServiceMessages)
      .where(eq(customerServiceMessages.id, created.messageId));
    const jobId = "00000000-0000-4000-8000-000000000102";
    await database.insert(customerServiceImageJobs).values({
      id: jobId,
      messageId: message.id,
      conversationId: message.conversationId,
      status: "pending",
      sourceCiphertext: "v1.legacy-encrypted-source",
      sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
      nextRunAt: new Date("2026-08-17T00:00:00.000Z"),
    });

    const claimInput = {
      jobId,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    };
    await expect(Promise.all([
      repository.claimImageJob(claimInput),
      repository.claimImageJob(claimInput),
    ])).resolves.toEqual([null, null]);
    await expect(repository.claimImageJob(claimInput)).resolves.toBeNull();
  });

  it("persists unsupported attachment kind and stable failure metadata without a source", async () => {
    await activateFacebookPilot("unsupported-attachment");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "f".repeat(64),
      externalMessageKeyHash: "e".repeat(64),
      text: "Please check this file",
      attachments: [{
        externalAttachmentKeyHash: "d".repeat(64),
        ordinal: 0,
        kind: "unsupported",
        mimeTypeHint: "application/pdf",
        failureCode: "unsupported_attachment",
      }],
      imageJob: {
        id: "00000000-0000-4000-8000-000000000171",
        status: "human_review_required",
        sourceCiphertext: null,
        sourceExpiresAt: null,
        failureCode: "unsupported_attachment",
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    expect(attachment).toMatchObject({
      messageId: created.messageId,
      kind: "image",
      normalizedKind: "unsupported",
      status: "rejected",
      failureCode: "unsupported_attachment",
      privateStorageKey: null,
    });
    await expect(repository.selectImageContext(created.messageId)).resolves.toMatchObject({
      hasUnsupportedAttachments: true,
      analysisSummary: null,
    });
  });

  it("projects up to 100 queue image assessments with a fixed number of reads", async () => {
    const created = await Promise.all(["a", "b"].map((key, index) => repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: key.repeat(64),
      externalMessageKeyHash: String(index + 1).repeat(64),
      text: "Can you assess this photo?",
      attachments: [{
        externalAttachmentKeyHash: String(index + 3).repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: "image/png",
      }],
      receivedAt: new Date(`2026-08-17T00:00:0${index}.000Z`),
    })));
    if (created.some((result) => result.status === "duplicate")) return;
    const messageIds = created.map((result) => result.messageId);
    const attachments = await database.select({
      id: customerServiceAttachments.id,
      messageId: customerServiceAttachments.messageId,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    }).from(customerServiceAttachments).where(inArray(customerServiceAttachments.messageId, messageIds));

    for (const [index, attachment] of attachments.entries()) {
      for (const cleanupFailed of index === 0 ? [true, false] : [false]) {
        const attemptId = await repository.createImageAnalysisAttempt({
          messageId: attachment.messageId,
          schemaVersion: "1",
          attachments: [{
            attachmentId: attachment.id,
            ordinal: 0,
            externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
          }],
        });
        const storageKey = `customer-service-attachments/test-${index}-${cleanupFailed ? "stale" : "valid"}.bin`;
        await repository.markImageAttachmentStored({
          attemptId,
          attachmentId: attachment.id,
          verifiedMimeType: "image/png",
          width: 100,
          height: 80,
          byteSize: 64,
          sha256: "e".repeat(64),
          privateStorageKey: storageKey,
          deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
        });
        await repository.completeImageAnalysisAttempt(imageCompletion(attemptId, "analyzed"));
        await repository.markImageAttachmentDeleted({
          attemptId,
          attachmentId: attachment.id,
          privateStorageKey: storageKey,
          deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
          deleted: !cleanupFailed,
          failureCode: cleanupFailed ? "image_cleanup_failed" : null,
        });
      }
    }

    let queryCount = 0;
    const countedRepository = createDrizzleCustomerServiceRepository(drizzle(testDatabaseUrl!, {
      logger: { logQuery: () => { queryCount += 1; } },
    }));
    const page = await countedRepository.listQueue(100);

    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ attachmentCount: 1, imageAnalysisStatus: "assessed" }),
    ]));
    expect(queryCount).toBeLessThanOrEqual(4);
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

    const attachments = await database.select({
      id: customerServiceAttachments.id,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    })
      .from(customerServiceAttachments)
      .orderBy(customerServiceAttachments.ordinal);
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    });
  });

  it("never reuses preceding attachment-only messages for a later text message", async () => {
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
    expect(selected).toBeNull();
    const [oldest] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, prior[0].messageId));
    const [otherAttachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, other.messageId));
    expect(oldest.id).not.toBe(otherAttachment.id);
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
    await expect(repository.selectImageContext(current.messageId)).resolves.toBeNull();
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

    await expect(repository.selectImageContext(currentId)).resolves.toBeNull();
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

    await expect(repository.selectImageContext(currentId)).resolves.toBeNull();
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
    const attachments = await database.select({
      id: customerServiceAttachments.id,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    })
      .from(customerServiceAttachments)
      .orderBy(customerServiceAttachments.ordinal);

    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: attachments.map((attachment, ordinal) => ({
        attachmentId: attachment.id,
        ordinal,
        externalAttachmentKeyHash: attachment.externalAttachmentKeyHash,
      })),
    });
    const storageKeys = attachments.map((_, index) => (
      `customer-service-attachments/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}.bin`
    ));
    for (const [index, attachment] of attachments.entries()) {
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 100,
        height: 80,
        byteSize: 64,
        sha256: "e".repeat(64),
        privateStorageKey: storageKeys[index],
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      });
    }
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
    });
    await repository.markImageAttachmentDeleted({
      attemptId,
      attachmentId: attachments[0].id,
      privateStorageKey: storageKeys[0],
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
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
    expect(attempt).toMatchObject({ status: "analyzed", providerCalled: true, estimatedCostMicrousd: 25 });
    expect(inputs.map((item) => item.attachmentId)).toEqual(attachments.map((attachment) => attachment.id));
    expect(inputs[0]).toMatchObject({ cleanupStatus: "failed", privateStorageKey: storageKeys[0] });
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 25 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 25 }),
    ]));
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    });
    for (const [index, attachment] of attachments.entries()) {
      await repository.markImageAttachmentDeleted({
        attemptId,
        attachmentId: attachment.id,
        privateStorageKey: storageKeys[index],
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
        deleted: true,
        failureCode: null,
      });
    }
    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: attachments.map((attachment) => attachment.id),
      analysisSummary: analysis.safeSummary,
      hasUnsupportedAttachments: false,
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
    const [otherAttachment] = await database.select({
      id: customerServiceAttachments.id,
      externalAttachmentKeyHash: customerServiceAttachments.externalAttachmentKeyHash,
    })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, other.messageId));
    await expect(repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{
        attachmentId: otherAttachment.id,
        ordinal: 0,
        externalAttachmentKeyHash: otherAttachment.externalAttachmentKeyHash,
      }],
    })).rejects.toThrow("customer_service_image_context_mismatch");
  });

  it("rejects an ephemeral source identity substituted for the selected persisted attachment", async () => {
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "3".repeat(64),
      externalMessageKeyHash: "4".repeat(64),
      text: "Please assess this image",
      attachments: [{
        externalAttachmentKeyHash: sourceHash("conversation-a-source"),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));

    await expect(repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{
        attachmentId: attachment.id,
        ordinal: 0,
        externalAttachmentKeyHash: sourceHash("conversation-b-source"),
      }],
    })).rejects.toThrow("customer_service_image_context_mismatch");

    expect(await database.select().from(customerServiceImageAnalysisAttempts)).toHaveLength(0);
  });

  it("keeps cleanup proof and storage guards isolated to each overlapping attempt", async () => {
    const externalAttachmentKeyHash = sourceHash("shared-source");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "6".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const attemptInput = {
      messageId: created.messageId,
      schemaVersion: "1" as const,
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    };
    const attemptA = await repository.createImageAnalysisAttempt(attemptInput);
    const attemptB = await repository.createImageAnalysisAttempt(attemptInput);
    const keyA = "customer-service-attachments/00000000-0000-4000-8000-00000000000a.bin";
    const keyB = "customer-service-attachments/00000000-0000-4000-8000-00000000000b.bin";
    for (const [attemptId, privateStorageKey] of [[attemptA, keyA], [attemptB, keyB]] as const) {
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 100,
        height: 80,
        byteSize: 64,
        sha256: "e".repeat(64),
        privateStorageKey,
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      });
    }
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptA, "provider_error"));
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptB, "analyzed"));
    await repository.markImageAttachmentDeleted({
      attemptId: attemptB,
      attachmentId: attachment.id,
      privateStorageKey: keyB,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: false,
      failureCode: "image_cleanup_failed",
    });
    await repository.markImageAttachmentDeleted({
      attemptId: attemptA,
      attachmentId: attachment.id,
      privateStorageKey: keyA,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: true,
      failureCode: null,
    });
    await repository.markImageAttachmentDeleted({
      attemptId: attemptA,
      attachmentId: attachment.id,
      privateStorageKey: keyA,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      deleted: false,
      failureCode: "stale_cleanup_failure",
    });

    await expect(repository.selectImageContext(created.messageId)).resolves.toEqual({
      messageId: created.messageId,
      attachmentIds: [attachment.id],
      analysisSummary: null,
      hasUnsupportedAttachments: false,
    });
    const lifecycle = await database.execute(sql`
      select analysis_attempt_id, cleanup_status, private_storage_key
      from customer_service_image_analysis_inputs
      order by analysis_attempt_id
    `);
    expect(lifecycle.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        analysis_attempt_id: attemptA,
        cleanup_status: "deleted",
        private_storage_key: null,
      }),
      expect.objectContaining({
        analysis_attempt_id: attemptB,
        cleanup_status: "failed",
        private_storage_key: keyB,
      }),
    ]));
  });

  it("cleans only expired non-deleted attempt-owned image objects and retries failed removals", async () => {
    const externalAttachmentKeyHash = sourceHash("cleanup-source");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "9".repeat(64),
      externalMessageKeyHash: "a".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const oldDueAt = new Date("2026-08-16T00:00:00.000Z");
    const futureDueAt = new Date("2026-08-18T00:00:00.000Z");
    const createStoredAttempt = async (storageKey: string, deleteDueAt: Date) => {
      const attemptId = await repository.createImageAnalysisAttempt({
        messageId: created.messageId,
        schemaVersion: "1",
        attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
      });
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 100,
        height: 80,
        byteSize: 64,
        sha256: "e".repeat(64),
        privateStorageKey: storageKey,
        deleteDueAt,
      });
      return attemptId;
    };
    const successKey = "customer-service-attachments/00000000-0000-4000-8000-00000000000c.bin";
    const retryKey = "customer-service-attachments/00000000-0000-4000-8000-00000000000d.bin";
    const futureKey = "customer-service-attachments/00000000-0000-4000-8000-00000000000e.bin";
    const successAttemptId = await createStoredAttempt(successKey, oldDueAt);
    const retryAttemptId = await createStoredAttempt(retryKey, oldDueAt);
    await createStoredAttempt(futureKey, futureDueAt);
    await repository.completeImageAnalysisAttempt(imageCompletion(successAttemptId, "analyzed"));
    await repository.completeImageAnalysisAttempt(imageCompletion(retryAttemptId, "provider_error"));
    const removed: string[] = [];

    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 100,
      remove: async (storageKey) => {
        removed.push(storageKey);
        if (storageKey === retryKey) throw new Error("blob unavailable");
      },
    })).resolves.toEqual({ selected: 2, deleted: 1, failed: 1 });
    expect(removed).toEqual([successKey, retryKey]);
    const firstPass = await database.select({
      attemptId: customerServiceImageAnalysisInputs.analysisAttemptId,
      cleanupStatus: customerServiceImageAnalysisInputs.cleanupStatus,
      privateStorageKey: customerServiceImageAnalysisInputs.privateStorageKey,
      deleteDueAt: customerServiceImageAnalysisInputs.deleteDueAt,
      failureCode: customerServiceImageAnalysisInputs.failureCode,
    }).from(customerServiceImageAnalysisInputs).orderBy(asc(customerServiceImageAnalysisInputs.analysisAttemptId));
    expect(firstPass).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId: successAttemptId, cleanupStatus: "deleted", privateStorageKey: null, deleteDueAt: null }),
      expect.objectContaining({ attemptId: retryAttemptId, cleanupStatus: "failed", privateStorageKey: retryKey, deleteDueAt: oldDueAt, failureCode: "image_cleanup_failed" }),
      expect.objectContaining({ cleanupStatus: "stored", privateStorageKey: futureKey, deleteDueAt: futureDueAt }),
    ]));

    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 100,
      remove: async (storageKey) => { removed.push(storageKey); },
    })).resolves.toEqual({ selected: 1, deleted: 1, failed: 0 });
    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 100,
      remove: async (storageKey) => { removed.push(storageKey); },
    })).resolves.toEqual({ selected: 0, deleted: 0, failed: 0 });
    await expect(repository.metricCounts()).resolves.toMatchObject({
      providerCalls: 0,
      totalCostMicrousd: 0,
      imageProviderCalls: 2,
      imageInputTokens: 20,
      imageCachedInputTokens: 4,
      imageOutputTokens: 8,
      imageTotalCostMicrousd: 50,
      imageTotalLatencyMs: 10,
      imageFailures: 1,
      imageCleanupDeleted: 2,
      imageCleanupFailures: 0,
    });
  });

  it("owns image reservations on the attempt and makes ambiguous reserve and completion retries idempotent", async () => {
    const externalAttachmentKeyHash = sourceHash("budget-source");
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "7".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    if (created.status === "duplicate") return;
    const [attachment] = await database.select({ id: customerServiceAttachments.id })
      .from(customerServiceAttachments)
      .where(eq(customerServiceAttachments.messageId, created.messageId));
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    const reservation = {
      attemptId,
      reservationMicrousd: 100,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    };

    await expect(repository.reserveImageAnalysisAttempt(reservation)).resolves.toEqual({ status: "reserved" });
    await expect(repository.reserveImageAnalysisAttempt(reservation)).resolves.toEqual({ status: "reserved" });
    const persistedReservations = await database.execute(sql`
      select reserved_cost_microusd, budget_daily_scope_key
      from customer_service_image_analysis_attempts
      where id = ${attemptId}
    `);
    expect(persistedReservations.rows[0]).toMatchObject({
      reserved_cost_microusd: "100",
      budget_daily_scope_key: "daily:2026-08-17",
    });

    const completion = imageCompletion(attemptId, "analyzed");
    await expect(repository.completeImageAnalysisAttempt(completion)).resolves.toBeUndefined();
    await expect(repository.completeImageAnalysisAttempt(completion)).resolves.toBeUndefined();
    const budgets = await database.select().from(customerServiceBudgetState)
      .orderBy(customerServiceBudgetState.scopeKey);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 25 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 25 }),
    ]));
    const completedAttempts = await database.execute(sql`
      select reserved_cost_microusd, budget_daily_scope_key
      from customer_service_image_analysis_attempts
      where id = ${attemptId}
    `);
    expect(completedAttempts.rows[0]).toMatchObject({
      reserved_cost_microusd: "0",
      budget_daily_scope_key: "daily:2026-08-17",
    });
  });

  it("claims durable image jobs once and advances stages only with the active lease", async () => {
    await activateFacebookPilot("claim-image-job");
    const jobId = "00000000-0000-4000-8000-000000000101";
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "c".repeat(64),
      externalMessageKeyHash: "d".repeat(64),
      text: "Can I use this photo?",
      attachments: [{
        externalAttachmentKeyHash: "e".repeat(64),
        ordinal: 0,
        kind: "image",
        mimeTypeHint: null,
      }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    expect(created.status).not.toBe("duplicate");
    const claimInput = {
      jobId,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    };

    const claims = await Promise.all([
      repository.claimImageJob(claimInput),
      repository.claimImageJob(claimInput),
    ]);
    const claimed = claims.find((claim) => claim !== null);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claimed).toMatchObject({
      id: jobId,
      stage: "policy",
      hasUnsupportedAttachments: false,
      leaseToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    if (!claimed) return;

    await expect(repository.completeImageJobStage({
      jobId,
      leaseToken: "00000000-0000-4000-8000-000000000999",
      nextStage: "download",
    })).resolves.toBe(false);
    await expect(repository.completeImageJobStage({
      jobId,
      leaseToken: claimed.leaseToken,
      nextStage: "download",
    })).resolves.toBe(true);
    const [persisted] = await database.select().from(customerServiceImageJobs);
    expect(persisted).toMatchObject({
      stage: "download",
      status: "pending",
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });

  it("persists an attempt-owned cleanup key before upload and atomically gates combined image and text cost", async () => {
    await activateFacebookPilot("combined-image-budget");
    const createVisionJob = async (suffix: string, jobId: string) => {
      const externalAttachmentKeyHash = suffix.repeat(64);
      const created = await repository.ingestFacebookMessage({
        channel: "facebook",
        externalConversationKeyHash: suffix.repeat(64),
        externalMessageKeyHash: `${suffix}f`.repeat(32),
        text: "Can I use this photo?",
        attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
        imageJob: {
          id: jobId,
          status: "pending",
          sourceCiphertext: "v1.encrypted",
          sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
          failureCode: null,
        },
        receivedAt: new Date("2026-08-17T00:00:00.000Z"),
      });
      const policy = await repository.claimImageJob({
        jobId,
        now: new Date("2026-08-17T00:00:01.000Z"),
        leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
      });
      if (!policy) throw new Error("missing policy claim");
      await repository.completeImageJobStage({ jobId, leaseToken: policy.leaseToken, nextStage: "download" });
      const download = await repository.claimImageJob({
        jobId,
        now: new Date("2026-08-17T00:00:02.000Z"),
        leaseExpiresAt: new Date("2026-08-17T00:00:27.000Z"),
      });
      if (!download) throw new Error("missing download claim");
      const attempt = await repository.ensureImageAnalysisAttemptForJob({
        jobId,
        leaseToken: download.leaseToken,
        sources: [{
          ordinal: 0,
          externalAttachmentKeyHash,
          sourceRef: { kind: "facebook_remote", url: "https://example.test/private.png" },
        }],
      });
      const privateStorageKey = `customer-service-attachments/${jobId}.bin`;
      await repository.prepareImageAttachmentStorage({
        jobId,
        leaseToken: download.leaseToken,
        attemptId: attempt.attemptId,
        attachmentId: attempt.inputs[0].attachmentId,
        privateStorageKey,
        deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
      });
      const [prepared] = await database.select().from(customerServiceImageAnalysisInputs)
        .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attempt.attemptId));
      expect(prepared).toMatchObject({ cleanupStatus: "pending", privateStorageKey });
      await repository.completeImageJobStage({ jobId, leaseToken: download.leaseToken, nextStage: "vision" });
      const vision = await repository.claimImageJob({
        jobId,
        now: new Date("2026-08-17T00:00:03.000Z"),
        leaseExpiresAt: new Date("2026-08-17T00:00:28.000Z"),
      });
      if (!vision) throw new Error("missing vision claim");
      return { created, vision };
    };
    const first = await createVisionJob("1", "00000000-0000-4000-8000-000000000111");
    const second = await createVisionJob("2", "00000000-0000-4000-8000-000000000222");
    const reservation = (job: NonNullable<typeof first.vision>) => repository.reserveImageJobBudget({
      jobId: job.id,
      leaseToken: job.leaseToken,
      reservationMicrousd: 600,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 1_000,
      totalHardStopMicrousd: 1_000,
    });
    const results = await Promise.all([reservation(first.vision), reservation(second.vision)]);
    expect(results.map((result) => result.status).sort()).toEqual(["budget_blocked", "reserved"]);
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 600 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 600 }),
    ]));
  });

  it("reconciles a stale post-reservation job exactly once and leaves cleanup retryable", async () => {
    await activateFacebookPilot("stale-vision-job");
    const jobId = "00000000-0000-4000-8000-000000000333";
    const externalAttachmentKeyHash = "3".repeat(64);
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "4".repeat(64),
      externalMessageKeyHash: "5".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [message] = await database.select().from(customerServiceMessages);
    const [attachment] = await database.select().from(customerServiceAttachments);
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: message.id,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await database.update(customerServiceImageJobs).set({
      imageAnalysisAttemptId: attemptId,
      stage: "vision",
      status: "running",
      leaseToken: "00000000-0000-4000-8000-000000000334",
      leaseExpiresAt: new Date("2026-08-16T23:59:00.000Z"),
      reservedCostMicrousd: 2_000,
      budgetDailyScopeKey: "daily:2026-08-17",
    }).where(eq(customerServiceImageJobs.id, jobId));
    await database.insert(customerServiceBudgetState).values([
      { scopeKey: "daily:2026-08-17", reservedMicrousd: 2_000 },
      { scopeKey: "total", reservedMicrousd: 2_000 },
    ]);

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, terminal: 1, reservationsReleased: 1 });
    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 0, reservationsReleased: 0 });
    const [persisted] = await database.select().from(customerServiceImageJobs);
    const [persistedAttempt] = await database.select().from(customerServiceImageAnalysisAttempts)
      .where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    expect(persisted).toMatchObject({
      stage: "cleanup",
      status: "pending",
      terminalAfterCleanup: true,
      failureCode: "image_provider_state_ambiguous",
      reservedCostMicrousd: 0,
      budgetSettledAt: expect.any(Date),
    });
    expect(persistedAttempt).toMatchObject({
      status: "provider_error",
      providerCalled: false,
      providerErrorCode: "image_job_interrupted",
      completedAt: expect.any(Date),
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets.every((budget) => budget.reservedMicrousd === 0)).toBe(true);
  });

  it("resumes a stale download with its preallocated cleanup key", async () => {
    await activateFacebookPilot("stale-download-job");
    const jobId = "00000000-0000-4000-8000-000000000441";
    const externalAttachmentKeyHash = "4".repeat(64);
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "5".repeat(64),
      externalMessageKeyHash: "6".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const policy = await repository.claimImageJob({
      jobId,
      now: new Date("2026-08-17T00:00:01.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:26.000Z"),
    });
    if (!policy) throw new Error("missing policy claim");
    await repository.completeImageJobStage({ jobId, leaseToken: policy.leaseToken, nextStage: "download" });
    const download = await repository.claimImageJob({
      jobId,
      now: new Date("2026-08-17T00:00:02.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:03.000Z"),
    });
    if (!download) throw new Error("missing download claim");
    const attempt = await repository.ensureImageAnalysisAttemptForJob({
      jobId,
      leaseToken: download.leaseToken,
      sources: [{
        ordinal: 0,
        externalAttachmentKeyHash,
        sourceRef: { kind: "facebook_remote", url: "https://example.test/private.png" },
      }],
    });
    const privateStorageKey = "customer-service-attachments/00000000-0000-4000-8000-000000000442.bin";
    await repository.prepareImageAttachmentStorage({
      jobId,
      leaseToken: download.leaseToken,
      attemptId: attempt.attemptId,
      attachmentId: attempt.inputs[0].attachmentId,
      privateStorageKey,
      deleteDueAt: new Date("2026-08-18T00:00:00.000Z"),
    });

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:04.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, resumed: 1, terminal: 0 });

    const [persisted] = await database.select().from(customerServiceImageJobs)
      .where(eq(customerServiceImageJobs.id, jobId));
    const [persistedInput] = await database.select().from(customerServiceImageAnalysisInputs)
      .where(eq(customerServiceImageAnalysisInputs.analysisAttemptId, attempt.attemptId));
    expect(persisted).toMatchObject({
      stage: "download",
      status: "pending",
      sourceCiphertext: "v1.encrypted",
      terminalAfterCleanup: false,
    });
    expect(persistedInput).toMatchObject({
      cleanupStatus: "pending",
      privateStorageKey,
    });
  });

  it("abandons an ambiguous stale text attempt while settling its combined reservation once", async () => {
    await activateFacebookPilot("stale-draft-job");
    const jobId = "00000000-0000-4000-8000-000000000451";
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "7".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash: "9".repeat(64), ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    await database.update(customerServiceImageJobs).set({
      stage: "draft",
      status: "running",
      leaseToken: "00000000-0000-4000-8000-000000000452",
      leaseExpiresAt: new Date("2026-08-16T23:59:00.000Z"),
      reservedCostMicrousd: 2_000,
      budgetDailyScopeKey: "daily:2026-08-17",
    }).where(eq(customerServiceImageJobs.id, jobId));
    await database.insert(customerServiceBudgetState).values([
      { scopeKey: "daily:2026-08-17", reservedMicrousd: 2_000 },
      { scopeKey: "total", reservedMicrousd: 2_000 },
    ]);
    const [textAttempt] = await database.insert(customerServiceAiAttempts).values({
      messageId: created.messageId,
      attemptNumber: 1,
      trigger: "webhook_after",
      intent: "photo_guidance",
      riskLevel: "low",
      gateResult: "allowed",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeVersion: "test-v1",
      status: "provider_pending",
      providerCalled: true,
      reservedCostMicrousd: 0,
    }).returning({ id: customerServiceAiAttempts.id });
    await database.update(customerServiceImageJobs).set({ textAttemptId: textAttempt.id })
      .where(eq(customerServiceImageJobs.id, jobId));

    await expect(repository.reconcileStaleImageJobs({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
    })).resolves.toMatchObject({ examined: 1, terminal: 1, reservationsReleased: 1 });

    const [persistedAttempt] = await database.select().from(customerServiceAiAttempts)
      .where(eq(customerServiceAiAttempts.id, textAttempt.id));
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(persistedAttempt).toMatchObject({
      status: "abandoned",
      providerErrorCode: "text_provider_state_ambiguous",
      completedAt: expect.any(Date),
    });
    expect(budgets.every((budget) => budget.reservedMicrousd === 0)).toBe(true);
  });

  it("settles separate image and text actuals against one combined reservation exactly once", async () => {
    await activateFacebookPilot("image-text-settlement");
    const jobId = "00000000-0000-4000-8000-000000000551";
    const externalAttachmentKeyHash = "a".repeat(64);
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "b".repeat(64),
      externalMessageKeyHash: "c".repeat(64),
      text: "Can I use this photo?",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      imageJob: {
        id: jobId,
        status: "pending",
        sourceCiphertext: "v1.encrypted",
        sourceExpiresAt: new Date("2026-08-17T00:15:00.000Z"),
        failureCode: null,
      },
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    const attemptId = await repository.createImageAnalysisAttempt({
      messageId: created.messageId,
      schemaVersion: "1",
      attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
    });
    await database.update(customerServiceImageJobs).set({
      stage: "vision",
      status: "running",
      imageAnalysisAttemptId: attemptId,
      leaseToken: "00000000-0000-4000-8000-000000000552",
      leaseExpiresAt: new Date("2026-08-17T00:00:25.000Z"),
    }).where(eq(customerServiceImageJobs.id, jobId));
    const visionLease = "00000000-0000-4000-8000-000000000552";
    await expect(repository.reserveImageJobBudget({
      jobId,
      leaseToken: visionLease,
      reservationMicrousd: 2_000,
      dailyScopeKey: "daily:2026-08-17",
      dailyHardStopMicrousd: 10_000,
      totalHardStopMicrousd: 10_000,
    })).resolves.toEqual({ status: "reserved" });
    await expect(repository.markImageAnalysisProviderStarted({ jobId, leaseToken: visionLease, attemptId }))
      .resolves.toBe(true);
    await repository.completeImageAnalysisAttempt(imageCompletion(attemptId, "analyzed"));
    await database.update(customerServiceImageAnalysisAttempts).set({
      analysisResult: {
        ...assessedAnalysis(),
        recommendationCodes: ["send_original_file"],
      },
    }).where(eq(customerServiceImageAnalysisAttempts.id, attemptId));
    await repository.completeImageJobStage({ jobId, leaseToken: visionLease, nextStage: "draft" });
    const draftJob = await repository.claimImageJob({
      jobId,
      now: new Date("2026-08-17T00:00:26.000Z"),
      leaseExpiresAt: new Date("2026-08-17T00:00:51.000Z"),
    });
    if (!draftJob) throw new Error("missing draft claim");
    const text = await repository.createImageJobProviderAttempt({
      jobId,
      leaseToken: draftJob.leaseToken,
      messageId: created.messageId,
      trigger: "webhook_after",
      intent: "photo_guidance",
      riskLevel: "low",
      gateReasons: ["confirmed_draft_scope"],
      knowledgeSources: ["AI-SCOPE-05"],
      knowledgeVersion: "test-v1",
    });
    expect(text.status).toBe("reserved");
    await repository.completeProviderAttempt({
      attemptId: text.attemptId,
      status: "draft_ready",
      provider: "mock",
      model: "mock",
      draftText: "Please send the original file so we can assess it.",
      validatorCodes: [],
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      estimatedCostMicrousd: 40,
      latencyMs: 2,
      dailyScopeKey: "daily:2026-08-17",
    });
    await expect(repository.finishImageJob({
      jobId,
      leaseToken: draftJob.leaseToken,
      status: "completed",
      failureCode: null,
      textAttemptId: text.attemptId,
    })).resolves.toBe(true);
    await expect(repository.finishImageJob({
      jobId,
      leaseToken: draftJob.leaseToken,
      status: "completed",
      failureCode: null,
      textAttemptId: text.attemptId,
    })).resolves.toBe(false);
    await repository.appendFeedback({
      attemptId: text.attemptId,
      actorUserId: null,
      action: "accepted_unchanged",
      humanFinalText: "Please send the original file so we can assess it.",
      reasonCode: null,
      idempotencyKey: "image-aware-metric-feedback",
    });
    const budgets = await database.select().from(customerServiceBudgetState);
    expect(budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: "daily:2026-08-17", reservedMicrousd: 0, spentMicrousd: 65 }),
      expect.objectContaining({ scopeKey: "total", reservedMicrousd: 0, spentMicrousd: 65 }),
    ]));
    let queryCount = 0;
    const countedRepository = createDrizzleCustomerServiceRepository(drizzle(testDatabaseUrl!, {
      logger: { logQuery: () => { queryCount += 1; } },
    }));
    await expect(countedRepository.metricCounts()).resolves.toMatchObject({
      imageContexts: 1,
      imageAnalysesSucceeded: 1,
      imageAnalysesBlocked: 0,
      imageAwareDraftsGenerated: 1,
      imageAwareAcceptedUnchanged: 1,
      imageAwareEditedAccepted: 0,
      imageAwareRejected: 0,
      imageRequestOriginalRecommendations: 1,
      imageAwareTotalCostMicrousd: 65,
    });
    expect(queryCount).toBe(1);
  });

  it("commits cleanup claims before slow deletes so two workers never delete the same key", async () => {
    const externalAttachmentKeyHash = "6".repeat(64);
    const created = await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "7".repeat(64),
      externalMessageKeyHash: "8".repeat(64),
      text: "Please assess this image",
      attachments: [{ externalAttachmentKeyHash, ordinal: 0, kind: "image", mimeTypeHint: null }],
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    const [attachment] = await database.select().from(customerServiceAttachments);
    const keys = [
      "customer-service-attachments/00000000-0000-4000-8000-000000000661.bin",
      "customer-service-attachments/00000000-0000-4000-8000-000000000662.bin",
    ];
    for (const key of keys) {
      const attemptId = await repository.createImageAnalysisAttempt({
        messageId: created.messageId,
        schemaVersion: "1",
        attachments: [{ attachmentId: attachment.id, ordinal: 0, externalAttachmentKeyHash }],
      });
      await repository.markImageAttachmentStored({
        attemptId,
        attachmentId: attachment.id,
        verifiedMimeType: "image/png",
        width: 10,
        height: 10,
        byteSize: 10,
        sha256: "9".repeat(64),
        privateStorageKey: key,
        deleteDueAt: new Date("2026-08-16T00:00:00.000Z"),
      });
    }
    const removed: string[] = [];
    let releaseDeletes!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseDeletes = resolve; });
    const remove = async (key: string) => { removed.push(key); await blocked; };
    const first = repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 1,
      remove,
    });
    await expect.poll(async () => (
      await database.select().from(customerServiceImageAnalysisInputs)
    ).filter((row) => row.cleanupClaimToken !== null).length).toBe(1);
    const second = repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 2,
      remove,
    });
    await expect.poll(() => removed.length).toBe(2);
    releaseDeletes();
    await expect(Promise.all([first, second])).resolves.toEqual(expect.arrayContaining([
      { selected: 1, deleted: 1, failed: 0 },
    ]));
    expect(new Set(removed).size).toBe(2);
    await expect(repository.cleanupExpiredImageAttachments({
      now: new Date("2026-08-17T00:00:00.000Z"),
      limit: 10,
      remove: async (key) => { removed.push(key); },
    })).resolves.toEqual({ selected: 0, deleted: 0, failed: 0 });
  });
});
