import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
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
import { createWebsitePublicUpdatesReader } from "./public-updates";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl)
  && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);
const databaseDescribe = enabled ? describe : describe.skip;
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/test");
const repository = createDrizzleCustomerServiceRepository(database);
const createdConversationIds: string[] = [];
const cursorSecret = "website-public-updates-integration-secret-that-is-long-enough";
const sessionKeyHash = "a".repeat(64);

databaseDescribe("website public update repository", () => {
  beforeAll(async () => {
    const sameTime = new Date("2026-08-21T00:00:00.000Z");
    const [firstConversation, secondConversation, defaultTimestampConversation] = await database.insert(customerServiceConversations).values([
      { id: "00000000-0000-4000-8000-000000000001", channel: "website", externalKeyHash: `updates-a-${randomUUID()}` },
      { id: "00000000-0000-4000-8000-000000000002", channel: "website", externalKeyHash: `updates-b-${randomUUID()}` },
      { id: "00000000-0000-4000-8000-000000000003", channel: "website", externalKeyHash: `updates-default-${randomUUID()}` },
    ]).returning({ id: customerServiceConversations.id });
    createdConversationIds.push(firstConversation!.id, secondConversation!.id, defaultTimestampConversation!.id);

    const [firstMessage, secondMessage, defaultTimestampMessage] = await database.insert(customerServiceMessages).values([
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
      {
        id: "00000000-0000-4000-8000-000000000013",
        conversationId: defaultTimestampConversation!.id,
        channel: "website",
        externalMessageKeyHash: `updates-default-message-${randomUUID()}`,
        body: "Default timestamp first message",
        receivedAt: new Date(),
      },
    ]).returning({ id: customerServiceMessages.id });
    const [firstTurn, secondTurn, defaultTimestampTurn] = await database.insert(customerServiceTurns).values([
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
      {
        id: "00000000-0000-4000-8000-000000000023",
        conversationId: defaultTimestampConversation!.id,
        channel: "website",
        representativeMessageId: defaultTimestampMessage!.id,
        body: "Default timestamp first message",
        debounceUntil: new Date(),
        openedAt: new Date(),
        lastEventAt: new Date(),
      },
    ]).returning({ id: customerServiceTurns.id });
    await database.insert(customerServiceConversationEvents).values([
      {
        id: "00000000-0000-4000-8000-000000000031",
        conversationId: firstConversation!.id,
        turnId: firstTurn!.id,
        legacyMessageId: firstMessage!.id,
        channel: "website",
        externalMessageKeyHash: "b".repeat(64),
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
        externalMessageKeyHash: "c".repeat(64),
        role: "customer",
        eventType: "customer_message",
        body: "Other session message",
        receivedAt: sameTime,
        createdAt: sameTime,
      },
      {
        id: "00000000-0000-4000-8000-000000000035",
        conversationId: defaultTimestampConversation!.id,
        turnId: defaultTimestampTurn!.id,
        legacyMessageId: defaultTimestampMessage!.id,
        channel: "website",
        externalMessageKeyHash: "d".repeat(64),
        role: "customer",
        eventType: "customer_message",
        body: "Default timestamp first message",
        receivedAt: new Date(),
      },
      {
        id: "00000000-0000-4000-8000-000000000036",
        conversationId: defaultTimestampConversation!.id,
        channel: "website",
        externalMessageKeyHash: `updates-default-second-${randomUUID()}`,
        role: "staff",
        eventType: "human_outbound",
        body: "Default timestamp human reply",
        receivedAt: new Date(),
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
        orderingKey: first[1]!.orderingKey,
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

  it("preserves database-default microseconds through two reader polls without duplicate or skipped updates", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000003";
    const reader = createWebsitePublicUpdatesReader({ cursorSecret, repository });

    const first = await reader.read({ conversationId, sessionKeyHash, cursor: null, limit: 1 });
    const second = await reader.read({ conversationId, sessionKeyHash, cursor: first.cursor, limit: 10 });

    expect([...first.events, ...second.events].map((event) => event.text)).toEqual([
      "Default timestamp first message",
      "Default timestamp human reply",
    ]);
    expect(new Set([...first.events, ...second.events].map((event) => event.eventKey)).size).toBe(2);
  });

  it("uses index-backed keyset plans for both update branches", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const cursor = "2026-08-21T00:00:00.000000Z";
    const eventId = "00000000-0000-4000-8000-000000000031";
    const assistantId = "00000000-0000-4000-8000-000000000032";
    const plans = await database.transaction(async (transaction) => {
      await transaction.execute(sql`set local enable_seqscan = off`);
      const events = await transaction.execute(sql`
        explain (costs off)
        select event.id, event.created_at
        from customer_service_conversation_events event
        where event.conversation_id = ${conversationId}::uuid
          and event.channel = 'website'
          and (event.event_type = 'customer_message' or (event.event_type = 'human_outbound' and event.role = 'staff'))
          and (event.created_at > ${cursor}::timestamptz or (event.created_at = ${cursor}::timestamptz and event.id > ${eventId}::uuid))
        order by event.created_at asc, event.id asc
        limit 2
      `);
      const assistant = await transaction.execute(sql`
        explain (costs off)
        select message.id, message.published_at
        from customer_service_website_assistant_messages message
        where message.conversation_id = ${conversationId}::uuid
          and message.channel = 'website'
          and (message.published_at > ${cursor}::timestamptz or (message.published_at = ${cursor}::timestamptz and message.id > ${assistantId}::uuid))
        order by message.published_at asc, message.id asc
        limit 2
      `);
      return { events, assistant };
    });
    const eventPlan = plans.events.rows.map((row) => Object.values(row).join(" ")).join("\n");
    const assistantPlan = plans.assistant.rows.map((row) => Object.values(row).join(" ")).join("\n");

    expect(eventPlan).toMatch(/Index (Only )?Scan/i);
    expect(eventPlan).not.toMatch(/Seq Scan/i);
    expect(assistantPlan).toMatch(/Index (Only )?Scan using customer_service_website_assistant_messages_conversation_publis/i);
    expect(assistantPlan).not.toMatch(/Seq Scan/i);
  });

  it("keeps the first normal claim pending and labels only later retries as recovery", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    await database.update(customerServiceTurns).set({ processingAttempts: 1 })
      .where(eq(customerServiceTurns.id, "00000000-0000-4000-8000-000000000021"));
    const firstClaim = await repository.listWebsitePublicUpdates({ conversationId, after: null, limit: 10 });
    expect(firstClaim.find((update) => update.text === "Customer message")?.state).toBe("pending");

    await database.update(customerServiceTurns).set({ processingAttempts: 2 })
      .where(eq(customerServiceTurns.id, "00000000-0000-4000-8000-000000000021"));
    const retried = await repository.listWebsitePublicUpdates({ conversationId, after: null, limit: 10 });

    expect(retried.find((update) => update.text === "Customer message")?.state).toBe("recovery");
  });
});
