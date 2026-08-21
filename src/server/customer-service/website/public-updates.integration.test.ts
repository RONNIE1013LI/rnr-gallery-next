import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  customerServiceConversationEvents,
  customerServiceConversations,
  customerServiceMessages,
  customerServiceTurns,
  customerServiceWebsiteAssistantMessages,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "../repositories/drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl)
  && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const databaseDescribe = enabled ? describe : describe.skip;
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerServiceRepository(database);
const createdConversationIds: string[] = [];

databaseDescribe("website public update repository", () => {
  beforeAll(async () => {
    const sameTime = new Date("2026-08-21T00:00:00.000Z");
    const [firstConversation, secondConversation] = await database.insert(customerServiceConversations).values([
      { id: "00000000-0000-4000-8000-000000000001", channel: "website", externalKeyHash: `updates-a-${randomUUID()}` },
      { id: "00000000-0000-4000-8000-000000000002", channel: "website", externalKeyHash: `updates-b-${randomUUID()}` },
    ]).returning({ id: customerServiceConversations.id });
    createdConversationIds.push(firstConversation!.id, secondConversation!.id);

    const [firstMessage, secondMessage] = await database.insert(customerServiceMessages).values([
      {
        id: "00000000-0000-4000-8000-000000000011",
        conversationId: firstConversation!.id,
        channel: "website",
        externalMessageKeyHash: `updates-message-a-${randomUUID()}`,
        body: "Customer message",
        receivedAt: sameTime,
        createdAt: sameTime,
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        conversationId: secondConversation!.id,
        channel: "website",
        externalMessageKeyHash: `updates-message-b-${randomUUID()}`,
        body: "Other session message",
        receivedAt: sameTime,
        createdAt: sameTime,
      },
    ]).returning({ id: customerServiceMessages.id });
    const [firstTurn, secondTurn] = await database.insert(customerServiceTurns).values([
      {
        id: "00000000-0000-4000-8000-000000000021",
        conversationId: firstConversation!.id,
        channel: "website",
        representativeMessageId: firstMessage!.id,
        body: "Customer message",
        debounceUntil: sameTime,
        openedAt: sameTime,
        lastEventAt: sameTime,
        createdAt: sameTime,
      },
      {
        id: "00000000-0000-4000-8000-000000000022",
        conversationId: secondConversation!.id,
        channel: "website",
        representativeMessageId: secondMessage!.id,
        body: "Other session message",
        debounceUntil: sameTime,
        openedAt: sameTime,
        lastEventAt: sameTime,
        createdAt: sameTime,
      },
    ]).returning({ id: customerServiceTurns.id });
    await database.insert(customerServiceConversationEvents).values([
      {
        id: "00000000-0000-4000-8000-000000000031",
        conversationId: firstConversation!.id,
        turnId: firstTurn!.id,
        legacyMessageId: firstMessage!.id,
        channel: "website",
        externalMessageKeyHash: `updates-customer-${randomUUID()}`,
        role: "customer",
        eventType: "customer_message",
        body: "Customer message",
        receivedAt: sameTime,
        createdAt: sameTime,
      },
      {
        id: "00000000-0000-4000-8000-000000000033",
        conversationId: firstConversation!.id,
        channel: "website",
        externalMessageKeyHash: `updates-human-${randomUUID()}`,
        role: "staff",
        eventType: "human_outbound",
        body: "Human reply",
        receivedAt: sameTime,
        createdAt: sameTime,
      },
      {
        id: "00000000-0000-4000-8000-000000000034",
        conversationId: secondConversation!.id,
        turnId: secondTurn!.id,
        legacyMessageId: secondMessage!.id,
        channel: "website",
        externalMessageKeyHash: `updates-other-${randomUUID()}`,
        role: "customer",
        eventType: "customer_message",
        body: "Other session message",
        receivedAt: sameTime,
        createdAt: sameTime,
      },
    ]);
    await database.insert(customerServiceWebsiteAssistantMessages).values({
      id: "00000000-0000-4000-8000-000000000032",
      conversationId: firstConversation!.id,
      channel: "website",
      messageId: firstMessage!.id,
      turnId: firstTurn!.id,
      kind: "policy_acknowledgement",
      body: "Committed assistant reply",
      policyResult: "realtime_required",
      knowledgeVersion: "updates-test",
      publishedAt: sameTime,
      createdAt: sameTime,
    });
  });

  afterAll(async () => {
    if (!createdConversationIds.length) return;
    await database.delete(customerServiceWebsiteAssistantMessages)
      .where(inArray(customerServiceWebsiteAssistantMessages.conversationId, createdConversationIds));
    await database.delete(customerServiceConversationEvents)
      .where(inArray(customerServiceConversationEvents.conversationId, createdConversationIds));
    await database.delete(customerServiceTurns)
      .where(inArray(customerServiceTurns.conversationId, createdConversationIds));
    await database.delete(customerServiceMessages)
      .where(inArray(customerServiceMessages.conversationId, createdConversationIds));
    await database.delete(customerServiceConversations)
      .where(inArray(customerServiceConversations.id, createdConversationIds));
  });

  it("uses a stable source and ID order without gaps or duplicates across same-timestamp pages", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const first = await repository.listWebsitePublicUpdates({ conversationId, after: null, limit: 2 });
    const second = await repository.listWebsitePublicUpdates({
      conversationId,
      after: {
        createdAt: first[1]!.createdAt,
        source: first[1]!.source,
        id: first[1]!.id,
      },
      limit: 2,
    });

    expect([...first, ...second].map((item) => item.text)).toEqual([
      "Customer message",
      "Human reply",
      "Committed assistant reply",
    ]);
    expect(new Set([...first, ...second].map((item) => `${item.source}:${item.id}`)).size).toBe(3);
  });

  it("queries only the requested website conversation", async () => {
    const updates = await repository.listWebsitePublicUpdates({
      conversationId: "00000000-0000-4000-8000-000000000001",
      after: null,
      limit: 10,
    });

    expect(updates.map((item) => item.text)).not.toContain("Other session message");
  });
});
