import { randomBytes } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  customerServiceConversationIdentities,
  customerServiceConversations,
  customerServiceWebSessions,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "../repositories/drizzle-customer-service-repository";
import {
  WEBSITE_SESSION_MAX_AGE_SECONDS,
  hashWebsiteConversationKey,
  hashWebsiteSessionToken,
} from "./session";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const applicationDatabaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(testDatabaseUrl && applicationDatabaseUrl);
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const database = drizzle(testDatabaseUrl ?? "postgres://invalid/website_session_test");
const repository = createDrizzleCustomerServiceRepository(database as never);
const secret = "website-session-integration-secret-long-enough";
const createdConversationHashes = new Set<string>();

function token() {
  return randomBytes(32).toString("base64url");
}

async function cleanup() {
  if (!createdConversationHashes.size) return;
  const conversations = await database.select({ id: customerServiceConversations.id })
    .from(customerServiceConversations)
    .where(and(
      eq(customerServiceConversations.channel, "website"),
      inArray(customerServiceConversations.externalKeyHash, [...createdConversationHashes]),
    ));
  if (conversations.length) {
    const ids = conversations.map((conversation) => conversation.id);
    await database.delete(customerServiceWebSessions).where(inArray(customerServiceWebSessions.conversationId, ids));
    await database.delete(customerServiceConversationIdentities)
      .where(inArray(customerServiceConversationIdentities.conversationId, ids));
    await database.delete(customerServiceConversations).where(inArray(customerServiceConversations.id, ids));
  }
  createdConversationHashes.clear();
}

describeDatabase("website session repository", () => {
  beforeEach(async () => {
    expect(isDedicatedTestDatabase(testDatabaseUrl, applicationDatabaseUrl)).toBe(true);
  });

  afterEach(cleanup);

  it("creates and resolves a website session while storing hashes only", async () => {
    const rawToken = token();
    const now = new Date("2026-08-21T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
    const sessionTokenHash = hashWebsiteSessionToken(rawToken, secret);
    const externalConversationKeyHash = hashWebsiteConversationKey(rawToken, secret);
    createdConversationHashes.add(externalConversationKeyHash);

    const created = await repository.ensureWebsiteSession({
      sessionTokenHash,
      externalConversationKeyHash,
      now,
      expiresAt,
    });
    const resolved = await repository.resolveWebsiteSession({ sessionTokenHash, now });
    const [stored] = await database.select().from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, sessionTokenHash));

    expect(resolved).toEqual({
      ...created,
      identity: {
        kind: "website_conversation",
        keyHash: externalConversationKeyHash,
      },
    });
    expect(stored.sessionTokenHash).toBe(sessionTokenHash);
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(stored.channel).toBe("website");
  });

  it("returns null for expired sessions without extending expiry", async () => {
    const rawToken = token();
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    const expiresAt = new Date("2026-08-08T00:00:00.000Z");
    const sessionTokenHash = hashWebsiteSessionToken(rawToken, secret);
    const externalConversationKeyHash = hashWebsiteConversationKey(rawToken, secret);
    createdConversationHashes.add(externalConversationKeyHash);
    await repository.ensureWebsiteSession({
      sessionTokenHash,
      externalConversationKeyHash,
      now: createdAt,
      expiresAt,
    });

    await expect(repository.resolveWebsiteSession({
      sessionTokenHash,
      now: new Date("2026-08-09T00:00:00.000Z"),
    })).resolves.toBeNull();
    const [stored] = await database.select().from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, sessionTokenHash));
    expect(stored.expiresAt).toEqual(expiresAt);
  });

  it("uses database CAS for concurrent first POSTs with the same token", async () => {
    const rawToken = token();
    const now = new Date("2026-08-21T00:00:00.000Z");
    const input = {
      sessionTokenHash: hashWebsiteSessionToken(rawToken, secret),
      externalConversationKeyHash: hashWebsiteConversationKey(rawToken, secret),
      now,
      expiresAt: new Date(now.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000),
    };
    createdConversationHashes.add(input.externalConversationKeyHash);

    const [first, second] = await Promise.all([
      repository.ensureWebsiteSession(input),
      repository.ensureWebsiteSession(input),
    ]);
    const [sessionCount] = await database.select({ value: count() }).from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, input.sessionTokenHash));
    const [conversationCount] = await database.select({ value: count() })
      .from(customerServiceConversations)
      .where(and(
        eq(customerServiceConversations.channel, "website"),
        eq(customerServiceConversations.externalKeyHash, input.externalConversationKeyHash),
      ));

    expect(first).toEqual(second);
    expect(sessionCount.value).toBe(1);
    expect(conversationCount.value).toBe(1);
  });

  it("refreshes activity on POST reuse without extending absolute expiry", async () => {
    const rawToken = token();
    const createdAt = new Date("2026-08-21T00:00:00.000Z");
    const touchedAt = new Date("2026-08-21T01:00:00.000Z");
    const expiresAt = new Date(createdAt.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
    const input = {
      sessionTokenHash: hashWebsiteSessionToken(rawToken, secret),
      externalConversationKeyHash: hashWebsiteConversationKey(rawToken, secret),
      now: createdAt,
      expiresAt,
    };
    createdConversationHashes.add(input.externalConversationKeyHash);
    await repository.ensureWebsiteSession(input);
    await repository.ensureWebsiteSession({ ...input, now: touchedAt });

    const [stored] = await database.select().from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, input.sessionTokenHash));
    expect(stored.lastSeenAt).toEqual(touchedAt);
    expect(stored.expiresAt).toEqual(expiresAt);
  });

  it("strictly isolates two website sessions and never binds a Facebook conversation", async () => {
    const now = new Date("2026-08-21T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
    const firstToken = token();
    const secondToken = token();
    const firstConversationHash = hashWebsiteConversationKey(firstToken, secret);
    const secondConversationHash = hashWebsiteConversationKey(secondToken, secret);
    createdConversationHashes.add(firstConversationHash);
    createdConversationHashes.add(secondConversationHash);
    const [first, second] = await Promise.all([
      repository.ensureWebsiteSession({
        sessionTokenHash: hashWebsiteSessionToken(firstToken, secret),
        externalConversationKeyHash: firstConversationHash,
        now,
        expiresAt,
      }),
      repository.ensureWebsiteSession({
        sessionTokenHash: hashWebsiteSessionToken(secondToken, secret),
        externalConversationKeyHash: secondConversationHash,
        now,
        expiresAt,
      }),
    ]);

    expect(first.conversationId).not.toBe(second.conversationId);
    const conversations = await database.select().from(customerServiceConversations)
      .where(inArray(customerServiceConversations.externalKeyHash, [firstConversationHash, secondConversationHash]));
    expect(conversations).toHaveLength(2);
    expect(conversations.every((conversation) => conversation.channel === "website")).toBe(true);
  });
});
