import { randomBytes } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomerChatMessagesHandler } from "@/app/api/customer-chat/messages/route-handler";
import { createCustomerChatSessionHandler } from "@/app/api/customer-chat/session/route-handler";
import {
  customerServiceConversationEvents,
  customerServiceConversationIdentities,
  customerServiceConversations,
  customerServiceMessages,
  customerServiceRateLimitBuckets,
  customerServiceTurns,
  customerServiceWebSessions,
} from "@/server/db/schema";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { authenticatedWebsiteCustomerHash } from "../identity/customer-identity";
import { hashWebsiteClientMessageKey } from "./public-api";
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

function messageRequest(input: Readonly<{
  token: string;
  permit: string;
  clientMessageKey: string;
  message: string;
  customerId?: string | null;
}>) {
  return new Request("https://rrgallery.co.nz/api/customer-chat/messages", {
    method: "POST",
    headers: {
      origin: "https://rrgallery.co.nz",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: `__Host-rnr_customer_chat=${input.token}`,
      "x-rnr-customer-chat-permit": input.permit,
      ...(input.customerId ? { "x-test-customer-id": input.customerId } : {}),
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
    await database.delete(customerServiceConversationIdentities)
      .where(inArray(customerServiceConversationIdentities.conversationId, ids));
    await database.delete(customerServiceConversations).where(inArray(customerServiceConversations.id, ids));
  }
  if (createdRateKeys.size) {
    await database.delete(customerServiceRateLimitBuckets)
      .where(inArray(customerServiceRateLimitBuckets.bucketKeyHash, [...createdRateKeys]));
  }
  createdConversationHashes.clear();
  createdRateKeys.clear();
}

function sessionRequest(input: Readonly<{
  clientMessageKey: string;
  token?: string;
  customerId?: string | null;
}>) {
  return new Request("https://rrgallery.co.nz/api/customer-chat/session", {
    method: "POST",
    headers: {
      origin: "https://rrgallery.co.nz",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...(input.token ? { cookie: `__Host-rnr_customer_chat=${input.token}` } : {}),
      ...(input.customerId ? { "x-test-customer-id": input.customerId } : {}),
    },
    body: JSON.stringify({ version: 1, clientMessageKey: input.clientMessageKey }),
  });
}

async function testSession(headers: Headers) {
  const customerId = headers.get("x-test-customer-id");
  return customerId ? { user: { id: customerId } } : null;
}

function responsePermit(response: Response) {
  return response.clone().json().then((body: { permit: string }) => body.permit);
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
      getOptionalSession: testSession,
      analyticsConfig: {
        enabled: false,
        v2Enabled: false,
        cookieSecret: null,
        attributionLookbackDays: 90,
      },
      resolveProductContext: async () => null,
      processTurn: async () => undefined,
      scheduleAfter: (task) => scheduled.push(task),
      now: () => now,
      cookieEnvironment: "preview",
      resolveTrustedIp: () => "198.51.100.42",
    });
    const keyA = `A${randomBytes(16).toString("base64url").slice(0, 21)}`;
    const keyB = `B${randomBytes(16).toString("base64url").slice(0, 21)}`;
    const messageHashA = hashWebsiteClientMessageKey({ conversationHash, clientKey: keyA, secret: abuseSecret });
    const messageHashB = hashWebsiteClientMessageKey({ conversationHash, clientKey: keyB, secret: abuseSecret });
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
      authenticatedCustomerId: null,
      stableVisitorDigest: null,
    });

    expect(bootstrap.cookie?.value).toBe(rawToken);
    expect((await database.select({ value: count() }).from(customerServiceConversations)
      .where(eq(customerServiceConversations.externalKeyHash, conversationHash)))[0]?.value).toBe(0);
    expect((await database.select({ value: count() }).from(customerServiceWebSessions)
      .where(eq(customerServiceWebSessions.sessionTokenHash, sessionKeyHash)))[0]?.value).toBe(0);
    expect((await database.select({ value: count() }).from(customerServiceMessages)
      .where(inArray(customerServiceMessages.externalMessageKeyHash, [messageHashA, messageHashB])))[0]?.value).toBe(0);
    expect((await database.select({ value: count() }).from(customerServiceRateLimitBuckets)
      .where(eq(customerServiceRateLimitBuckets.bucketKeyHash, sessionKeyHash)))[0]?.value).toBe(0);
    expect(inquiryRecorder.recordInquiry).not.toHaveBeenCalled();

    const permitB = createWebsiteSessionPermit({
      token: rawToken,
      clientMessageKey: keyB,
      sessionExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
      now,
      sessionSecret,
      permitSecret: abuseSecret,
      nonce: "m".repeat(22),
      identity: {
        kind: "website_conversation",
        keyHash: conversationHash,
      },
    });
    const [first, second] = await Promise.all([
      handler.POST(messageRequest({ token: rawToken, permit: bootstrap.permit, clientMessageKey: keyA, message: "Synthetic first message" })),
      handler.POST(messageRequest({ token: rawToken, permit: permitB, clientMessageKey: keyB, message: "Synthetic second message" })),
    ]);
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
    await expect(database.select({
      kind: customerServiceConversationIdentities.identityKind,
      keyHash: customerServiceConversationIdentities.identityKeyHash,
    }).from(customerServiceConversationIdentities)
      .where(eq(customerServiceConversationIdentities.conversationId, (await database.select({
        id: customerServiceConversations.id,
      }).from(customerServiceConversations)
        .where(eq(customerServiceConversations.externalKeyHash, conversationHash))
        .limit(1))[0]!.id))).resolves.toEqual([{
      kind: "website_conversation",
      keyHash: conversationHash,
    }]);
  });

  it("rotates Guest/User A/Guest/User B scopes and reuses only the active exact scope", async () => {
    const repository = createDrizzleCustomerServiceRepository(database as never);
    const rawTokens = [token(), token(), token(), token()];
    rawTokens.forEach((rawToken) => {
      createdConversationHashes.add(hashWebsiteConversationKey(rawToken, sessionSecret));
      createdRateKeys.add(hashWebsiteSessionToken(rawToken, sessionSecret));
    });
    let tokenIndex = 0;
    const sessionHandler = createCustomerChatSessionHandler({
      enabled: true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret,
      permitSecret: abuseSecret,
      repository,
      getOptionalSession: testSession,
      analyticsConfig: {
        enabled: false,
        v2Enabled: false,
        cookieSecret: null,
        attributionLookbackDays: 90,
      },
      now: () => now,
      cookieEnvironment: "preview",
      createSessionToken: () => rawTokens[tokenIndex++],
      createPermitNonce: () => "n".repeat(22),
    });
    const scheduled: Array<() => Promise<void>> = [];
    const messagesHandler = createCustomerChatMessagesHandler({
      enabled: true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret,
      messageHashSecret: abuseSecret,
      permitSecret: abuseSecret,
      debounceMs: 2_000,
      repository,
      getOptionalSession: testSession,
      resolveProductContext: async () => null,
      processTurn: async () => undefined,
      scheduleAfter: (task) => scheduled.push(task),
      now: () => now,
      cookieEnvironment: "preview",
      resolveTrustedIp: () => "198.51.100.43",
    });
    const scopes = [
      { customerId: null, token: rawTokens[0], clientMessageKey: `G${"1".repeat(21)}` },
      { customerId: "user-a", token: rawTokens[1], clientMessageKey: `A${"2".repeat(21)}` },
      { customerId: null, token: rawTokens[2], clientMessageKey: `G${"3".repeat(21)}` },
      { customerId: "user-b", token: rawTokens[3], clientMessageKey: `B${"4".repeat(21)}` },
    ] as const;

    let activeToken: string | undefined;
    for (const scope of scopes) {
      const bootstrap = await sessionHandler.POST(sessionRequest({
        clientMessageKey: scope.clientMessageKey,
        token: activeToken,
        customerId: scope.customerId,
      }));
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers.get("Set-Cookie")).toContain(scope.token);
      const body = await bootstrap.clone().json();
      expect(JSON.stringify(body)).not.toMatch(/identity|keyHash|user-a|user-b/i);
      const accepted = await messagesHandler.POST(messageRequest({
        token: scope.token,
        permit: await responsePermit(bootstrap),
        clientMessageKey: scope.clientMessageKey,
        message: `Synthetic ${scope.clientMessageKey}`,
        customerId: scope.customerId,
      }));
      expect(accepted.status).toBe(202);
      expect(JSON.stringify(await accepted.json())).not.toMatch(/identity|keyHash|user-a|user-b/i);
      activeToken = scope.token;
    }

    const sameUser = await sessionHandler.POST(sessionRequest({
      clientMessageKey: `C${"5".repeat(21)}`,
      token: rawTokens[3],
      customerId: "user-b",
    }));
    expect(sameUser.status).toBe(200);
    expect(sameUser.headers.get("Set-Cookie")).toBeNull();
    expect(tokenIndex).toBe(4);

    const links = await database.select({
      conversationHash: customerServiceConversations.externalKeyHash,
      kind: customerServiceConversationIdentities.identityKind,
      keyHash: customerServiceConversationIdentities.identityKeyHash,
    }).from(customerServiceConversationIdentities)
      .innerJoin(customerServiceConversations, eq(
        customerServiceConversationIdentities.conversationId,
        customerServiceConversations.id,
      ))
      .where(inArray(
        customerServiceConversations.externalKeyHash,
        rawTokens.map((rawToken) => hashWebsiteConversationKey(rawToken, sessionSecret)),
      ));
    expect(links).toEqual(expect.arrayContaining([
      {
        conversationHash: hashWebsiteConversationKey(rawTokens[0], sessionSecret),
        kind: "website_conversation",
        keyHash: hashWebsiteConversationKey(rawTokens[0], sessionSecret),
      },
      {
        conversationHash: hashWebsiteConversationKey(rawTokens[1], sessionSecret),
        kind: "website_authenticated_customer",
        keyHash: authenticatedWebsiteCustomerHash("user-a", sessionSecret),
      },
      {
        conversationHash: hashWebsiteConversationKey(rawTokens[2], sessionSecret),
        kind: "website_conversation",
        keyHash: hashWebsiteConversationKey(rawTokens[2], sessionSecret),
      },
      {
        conversationHash: hashWebsiteConversationKey(rawTokens[3], sessionSecret),
        kind: "website_authenticated_customer",
        keyHash: authenticatedWebsiteCustomerHash("user-b", sessionSecret),
      },
    ]));
  });

  it("links two User A devices to one Inbox identity and rejects a User B permit replay", async () => {
    const repository = createDrizzleCustomerServiceRepository(database as never);
    const deviceTokens = [token(), token(), token()];
    deviceTokens.forEach((rawToken) => {
      createdConversationHashes.add(hashWebsiteConversationKey(rawToken, sessionSecret));
      createdRateKeys.add(hashWebsiteSessionToken(rawToken, sessionSecret));
    });
    const sessionHandler = (rawToken: string, customerId: string) => createCustomerChatSessionHandler({
      enabled: true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret,
      permitSecret: abuseSecret,
      repository,
      getOptionalSession: async () => ({ user: { id: customerId } }),
      analyticsConfig: {
        enabled: false,
        v2Enabled: false,
        cookieSecret: null,
        attributionLookbackDays: 90,
      },
      now: () => now,
      cookieEnvironment: "preview",
      createSessionToken: () => rawToken,
      createPermitNonce: () => "n".repeat(22),
    });
    const messagesHandler = createCustomerChatMessagesHandler({
      enabled: true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret,
      messageHashSecret: abuseSecret,
      permitSecret: abuseSecret,
      debounceMs: 2_000,
      repository,
      getOptionalSession: testSession,
      resolveProductContext: async () => null,
      processTurn: async () => undefined,
      scheduleAfter: () => undefined,
      now: () => now,
      cookieEnvironment: "preview",
      resolveTrustedIp: () => "198.51.100.44",
    });
    const clientKeys = [`A${"6".repeat(21)}`, `A${"7".repeat(21)}`];
    for (const [index, rawToken] of deviceTokens.slice(0, 2).entries()) {
      const bootstrap = await sessionHandler(rawToken, "user-a").POST(sessionRequest({
        clientMessageKey: clientKeys[index],
        customerId: "user-a",
      }));
      const accepted = await messagesHandler.POST(messageRequest({
        token: rawToken,
        permit: await responsePermit(bootstrap),
        clientMessageKey: clientKeys[index],
        message: `Device ${index + 1}`,
        customerId: "user-a",
      }));
      expect(accepted.status).toBe(202);
    }
    const identityHash = authenticatedWebsiteCustomerHash("user-a", sessionSecret);
    const links = await database.select().from(customerServiceConversationIdentities)
      .where(and(
        eq(customerServiceConversationIdentities.identityKind, "website_authenticated_customer"),
        eq(customerServiceConversationIdentities.identityKeyHash, identityHash),
      ));
    expect(links).toHaveLength(2);
    expect(new Set(links.map((link) => link.conversationId)).size).toBe(2);

    const replayKey = `A${"8".repeat(21)}`;
    const replayBootstrap = await sessionHandler(deviceTokens[2], "user-a").POST(sessionRequest({
      clientMessageKey: replayKey,
      customerId: "user-a",
    }));
    const rejected = await messagesHandler.POST(messageRequest({
      token: deviceTokens[2],
      permit: await responsePermit(replayBootstrap),
      clientMessageKey: replayKey,
      message: "Must not cross the identity boundary",
      customerId: "user-b",
    }));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: { code: "SESSION_REQUIRED" } });
    expect(await database.select().from(customerServiceConversations)
      .where(eq(
        customerServiceConversations.externalKeyHash,
        hashWebsiteConversationKey(deviceTokens[2], sessionSecret),
      ))).toHaveLength(0);
  });
});
