import { randomBytes } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomerChatMessagesHandler } from "@/app/api/customer-chat/messages/route-handler";
import {
  customerServiceConversationEvents,
  customerServiceConversations,
  customerServiceMessages,
  customerServiceRateLimitBuckets,
  customerServiceTurns,
  customerServiceWebSessions,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "../repositories/drizzle-customer-service-repository";
import {
  bootstrapWebsiteSession,
  createWebsiteSessionPermit,
  hashWebsiteConversationKey,
  hashWebsiteSessionToken,
} from "./session";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const applicationDatabaseUrl = process.env.DATABASE_URL;
const enabled = Boolean(testDatabaseUrl) && isDedicatedTestDatabase(testDatabaseUrl, applicationDatabaseUrl);
const describeDatabase = enabled ? describe : describe.skip;
const database = drizzle(testDatabaseUrl ?? "postgres://disabled.invalid/customer_chat_identity");
const now = new Date("2026-09-01T00:00:00.000Z");
const sessionSecret = "customer-chat-identity-session-secret-long-enough";
const abuseSecret = "customer-chat-identity-abuse-secret-long-enough";
const createdConversationHashes = new Set<string>();
const createdRateKeys = new Set<string>();

function token() {
  return randomBytes(32).toString("base64url");
}

function messageRequest(input: Readonly<{ token: string; permit: string; clientMessageKey: string; message: string }>) {
  return new Request("https://rrgallery.co.nz/api/customer-chat/messages", {
    method: "POST",
    headers: {
      origin: "https://rrgallery.co.nz",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: `__Host-rnr_customer_chat=${input.token}`,
      "x-rnr-customer-chat-permit": input.permit,
    },
    body: JSON.stringify({
      clientMessageKey: input.clientMessageKey,
      message: input.message,
      pageContext: { pathname: "/integration-test" },
    }),
  });
}

async function cleanup() {
  if (!createdConversationHashes.size) return;
  const conversations = await database.select({ id: customerServiceConversations.id })
    .from(customerServiceConversations)
    .where(and(
      eq(customerServiceConversations.channel, "website"),
      inArray(customerServiceConversations.externalKeyHash, [...createdConversationHashes]),
    ));
  const ids = conversations.map((conversation) => conversation.id);
  if (ids.length) {
    await database.delete(customerServiceConversationEvents).where(inArray(customerServiceConversationEvents.conversationId, ids));
    await database.delete(customerServiceTurns).where(inArray(customerServiceTurns.conversationId, ids));
    await database.delete(customerServiceMessages).where(inArray(customerServiceMessages.conversationId, ids));
    await database.delete(customerServiceWebSessions).where(inArray(customerServiceWebSessions.conversationId, ids));
    await database.delete(customerServiceConversations).where(inArray(customerServiceConversations.id, ids));
  }
  if (createdRateKeys.size) {
    await database.delete(customerServiceRateLimitBuckets)
      .where(inArray(customerServiceRateLimitBuckets.bucketKeyHash, [...createdRateKeys]));
  }
  createdConversationHashes.clear();
  createdRateKeys.clear();
}

describeDatabase("customer-chat first-message identity", () => {
  beforeEach(() => expect(isDedicatedTestDatabase(testDatabaseUrl, applicationDatabaseUrl)).toBe(true));
  afterEach(cleanup);

  it("keeps bootstrap stateless and converges two first messages plus a duplicate retry", async () => {
    const inquiryRecorder = { recordInquiry: vi.fn().mockResolvedValue(undefined) };
    const repository = createDrizzleCustomerServiceRepository(database as never, {
      analyticsRecorder: inquiryRecorder,
    });
    const rawToken = token();
    const sessionKeyHash = hashWebsiteSessionToken(rawToken, sessionSecret);
    const conversationHash = hashWebsiteConversationKey(rawToken, sessionSecret);
    createdConversationHashes.add(conversationHash);
    createdRateKeys.add(sessionKeyHash);
    const scheduled: Array<() => Promise<void>> = [];
    const handler = createCustomerChatMessagesHandler({
      enabled: true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret,
      messageHashSecret: abuseSecret,
      permitSecret: abuseSecret,
      debounceMs: 2_000,
      repository,
      resolveProductContext: async () => null,
      processTurn: async () => undefined,
      scheduleAfter: (task) => scheduled.push(task),
      now: () => now,
      cookieEnvironment: "preview",
      resolveTrustedIp: () => "198.51.100.42",
    });
    const keyA = `A${randomBytes(16).toString("base64url").slice(0, 21)}`;
    const keyB = `B${randomBytes(16).toString("base64url").slice(0, 21)}`;
    const bootstrap = await bootstrapWebsiteSession({
      request: new Request("https://rrgallery.co.nz/api/customer-chat/session", { method: "POST" }),
      repository,
      sessionSecret,
      permitSecret: abuseSecret,
      clientMessageKey: keyA,
      now,
      environment: "preview",
      createToken: () => rawToken,
      createNonce: () => "n".repeat(22),
    });

    expect(bootstrap.cookie?.value).toBe(rawToken);
    expect((await database.select({ value: count() }).from(customerServiceConversations)
      .where(eq(customerServiceConversations.externalKeyHash, conversationHash)))[0]?.value).toBe(0);
    expect((await database.select({ value: count() }).from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, sessionKeyHash)))[0]?.value).toBe(0);

    const first = await handler.POST(messageRequest({ token: rawToken, permit: bootstrap.permit, clientMessageKey: keyA, message: "Synthetic first message" }));
    const permitB = createWebsiteSessionPermit({
      token: rawToken,
      clientMessageKey: keyB,
      sessionExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
      now,
      sessionSecret,
      permitSecret: abuseSecret,
      nonce: "m".repeat(22),
    });
    const second = await handler.POST(messageRequest({ token: rawToken, permit: permitB, clientMessageKey: keyB, message: "Synthetic second message" }));
    const duplicate = await handler.POST(messageRequest({ token: rawToken, permit: bootstrap.permit, clientMessageKey: keyA, message: "Synthetic first message" }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(duplicate.status).toBe(202);
    const [conversationCount] = await database.select({ value: count() }).from(customerServiceConversations)
      .where(eq(customerServiceConversations.externalKeyHash, conversationHash));
    const [sessionCount] = await database.select({ value: count() }).from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, sessionKeyHash));
    const [messageCount] = await database.select({ value: count() }).from(customerServiceMessages)
      .where(and(eq(customerServiceMessages.channel, "website"), eq(customerServiceMessages.conversationId, (await database.select({ id: customerServiceConversations.id }).from(customerServiceConversations).where(eq(customerServiceConversations.externalKeyHash, conversationHash)).limit(1))[0]!.id)));
    const [sessionTotal] = await database.select({ value: customerServiceRateLimitBuckets.requestCount })
      .from(customerServiceRateLimitBuckets)
      .where(and(eq(customerServiceRateLimitBuckets.bucketKind, "session_total"), eq(customerServiceRateLimitBuckets.bucketKeyHash, sessionKeyHash)));

    expect(conversationCount?.value).toBe(1);
    expect(sessionCount?.value).toBe(1);
    expect(messageCount?.value).toBe(2);
    expect(inquiryRecorder.recordInquiry).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(2);
    expect(sessionTotal?.value).toBe(2);
  });
});
