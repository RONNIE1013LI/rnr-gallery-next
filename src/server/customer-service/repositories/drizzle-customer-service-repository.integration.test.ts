import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceFeedbackEvents,
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
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    };
    const results = await Promise.all([
      repository.ingestFacebookMessage(message),
      repository.ingestFacebookMessage(message),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual(["created", "duplicate"]);
    expect(await database.select().from(customerServiceMessages)).toHaveLength(1);
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
      receivedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    await repository.ingestFacebookMessage({
      channel: "facebook",
      externalConversationKeyHash: "3".repeat(64),
      externalMessageKeyHash: "4".repeat(64),
      text: "other customer",
      receivedAt: new Date("2026-08-17T00:00:01.000Z"),
    });
    expect(first.status).toBe("created");
    if (first.status !== "created") return;
    await expect(repository.loadDraftInput(first.messageId, 6)).resolves.toMatchObject({
      context: ["first conversation"],
    });
  });
});
