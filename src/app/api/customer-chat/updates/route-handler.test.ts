import { describe, expect, it, vi } from "vitest";
import { createCustomerChatUpdatesHandler } from "./route-handler";
import { hashWebsiteConversationKey } from "@/server/customer-service/website/session";
import { authenticatedWebsiteCustomerHash } from "@/server/customer-service/identity/customer-identity";
import {
  createWebsiteAnalyticsIdentity,
  websiteAnalyticsVisitorDigest,
} from "@/server/analytics/website-analytics-cookies";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";

const sessionSecret = "website-session-secret-that-is-long-enough";
const sessionToken = "s".repeat(43);
const now = new Date("2026-08-21T00:00:00.000Z");

function request(input: {
  cookie?: string;
  cursor?: string;
  conversation?: string;
  customerId?: string;
} = {}) {
  const url = new URL("https://rrgallery.co.nz/api/customer-chat/updates");
  if (input.cursor) url.searchParams.set("cursor", input.cursor);
  if (input.conversation) url.searchParams.set("conversation", input.conversation);
  return new Request(url, {
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      ...(input.customerId ? { "x-test-customer-id": input.customerId } : {}),
    },
  });
}

const analyticsDisabled = {
  enabled: false,
  v2Enabled: false,
  cookieSecret: null,
  attributionLookbackDays: 90,
} as const;

async function testSession(headers: Headers) {
  const customerId = headers.get("x-test-customer-id");
  return customerId ? { user: { id: customerId } } : null;
}

describe("GET /api/customer-chat/updates", () => {
  it("never creates a session for GET requests without a valid session cookie", async () => {
    let resolveCalls = 0;
    let listCalls = 0;
    const handler = createCustomerChatUpdatesHandler({
      enabled: true,
      sessionSecret,
      cursorSecret: "website-public-updates-secret-that-is-long-enough",
      cookieEnvironment: "preview",
      now: () => now,
      repository: {
        async resolveWebsiteSession() {
          resolveCalls += 1;
          return null;
        },
        async listWebsitePublicUpdates() {
          listCalls += 1;
          return [];
        },
      },
      getOptionalSession: testSession,
      analyticsConfig: analyticsDisabled,
    });

    const response = await handler.GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({ cursor: null, hasMore: false, events: [], state: "pending" });
    expect(resolveCalls).toBe(0);
    expect(listCalls).toBe(0);
  });

  it("resolves the conversation only from the cookie, isolates browser-supplied selectors, and performs no provider work", async () => {
    const selectedConversations: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const handler = createCustomerChatUpdatesHandler({
      enabled: true,
      sessionSecret,
      cursorSecret: "website-public-updates-secret-that-is-long-enough",
      cookieEnvironment: "preview",
      now: () => now,
      repository: {
        async resolveWebsiteSession() {
          return {
            conversationId: "00000000-0000-4000-8000-000000000001",
            expiresAt: new Date("2026-08-28T00:00:00.000Z"),
            identity: {
              kind: "website_conversation",
              keyHash: hashWebsiteConversationKey(sessionToken, sessionSecret),
            },
          };
        },
        async listWebsitePublicUpdates(input) {
          selectedConversations.push(input.conversationId);
          return [{
            source: "assistant" as const,
            id: "00000000-0000-4000-8000-000000000010",
            role: "assistant" as const,
            text: "Please share the product and required date.",
            createdAt: now,
            orderingKey: "2026-08-21T00:00:00.000000Z",
            state: "committed_assistant" as const,
          }];
        },
      },
      getOptionalSession: testSession,
      analyticsConfig: analyticsDisabled,
    });

    try {
      const response = await handler.GET(request({
        cookie: `__Host-rnr_customer_chat=${sessionToken}`,
        conversation: "00000000-0000-4000-8000-000000000999",
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        cursor: expect.any(String),
        hasMore: false,
        events: [{
          eventKey: expect.stringMatching(/^[a-f0-9]{64}$/),
          role: "assistant",
          text: "Please share the product and required date.",
          createdAt: "2026-08-21T00:00:00.000Z",
          state: "committed_assistant",
        }],
        state: "committed_assistant",
      });
      expect(selectedConversations).toEqual(["00000000-0000-4000-8000-000000000001"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects a tampered or cross-session cursor with a generic public error", async () => {
    const handler = createCustomerChatUpdatesHandler({
      enabled: true,
      sessionSecret,
      cursorSecret: "website-public-updates-secret-that-is-long-enough",
      cookieEnvironment: "preview",
      now: () => now,
      repository: {
        async resolveWebsiteSession() {
          return {
            conversationId: "00000000-0000-4000-8000-000000000001",
            expiresAt: new Date("2026-08-28T00:00:00.000Z"),
            identity: {
              kind: "website_conversation",
              keyHash: hashWebsiteConversationKey(sessionToken, sessionSecret),
            },
          };
        },
        async listWebsitePublicUpdates() {
          return [];
        },
      },
      getOptionalSession: testSession,
      analyticsConfig: analyticsDisabled,
    });

    const response = await handler.GET(request({
      cookie: `__Host-rnr_customer_chat=${sessionToken}`,
      cursor: "not-a-valid-cursor",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "REQUEST_REJECTED" } });
  });

  it("hides unexpected repository failures behind a generic server error", async () => {
    const handler = createCustomerChatUpdatesHandler({
      enabled: true,
      sessionSecret,
      cursorSecret: "website-public-updates-secret-that-is-long-enough",
      cookieEnvironment: "preview",
      now: () => now,
      repository: {
        async resolveWebsiteSession() {
          throw new Error("private database host and credentials");
        },
        async listWebsitePublicUpdates() {
          return [];
        },
      },
      getOptionalSession: testSession,
      analyticsConfig: analyticsDisabled,
    });

    const response = await handler.GET(request({ cookie: `__Host-rnr_customer_chat=${sessionToken}` }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
  });

  it.each([
    [
      "logout from User A",
      { kind: "website_authenticated_customer" as const, keyHash: authenticatedWebsiteCustomerHash("user-a", sessionSecret) },
      undefined,
    ],
    [
      "User A to User B",
      { kind: "website_authenticated_customer" as const, keyHash: authenticatedWebsiteCustomerHash("user-a", sessionSecret) },
      "user-b",
    ],
    [
      "Guest to User A",
      { kind: "website_conversation" as const, keyHash: hashWebsiteConversationKey(sessionToken, sessionSecret) },
      "user-a",
    ],
  ])("returns no transcript after %s changes the authoritative identity", async (_name, storedIdentity, customerId) => {
    const listWebsitePublicUpdates = vi.fn(async () => []);
    const handler = createCustomerChatUpdatesHandler({
      enabled: true,
      sessionSecret,
      cursorSecret: "website-public-updates-secret-that-is-long-enough",
      cookieEnvironment: "preview",
      now: () => now,
      getOptionalSession: testSession,
      analyticsConfig: analyticsDisabled,
      repository: {
        async resolveWebsiteSession() {
          return {
            conversationId: "00000000-0000-4000-8000-000000000001",
            expiresAt: new Date("2026-08-28T00:00:00.000Z"),
            identity: storedIdentity,
          };
        },
        listWebsitePublicUpdates,
      },
    });

    const response = await handler.GET(request({
      cookie: `__Host-rnr_customer_chat=${sessionToken}`,
      customerId,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cursor: null, hasMore: false, events: [], state: "pending" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(listWebsitePublicUpdates).not.toHaveBeenCalled();
  });

  it("returns no transcript after the consent-linked stable visitor changes", async () => {
    const analyticsSecret = "website-updates-analytics-secret-long-enough";
    const firstVisitor = createWebsiteAnalyticsIdentity(analyticsSecret, now);
    const secondVisitor = createWebsiteAnalyticsIdentity(analyticsSecret, now);
    const consent = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-20T23:00:00.000Z",
    }));
    const listWebsitePublicUpdates = vi.fn(async () => []);
    const handler = createCustomerChatUpdatesHandler({
      enabled: true,
      sessionSecret,
      cursorSecret: "website-public-updates-secret-that-is-long-enough",
      cookieEnvironment: "preview",
      now: () => now,
      getOptionalSession: testSession,
      analyticsConfig: {
        enabled: true,
        v2Enabled: true,
        cookieSecret: analyticsSecret,
        attributionLookbackDays: 90,
      },
      repository: {
        async resolveWebsiteSession() {
          return {
            conversationId: "00000000-0000-4000-8000-000000000001",
            expiresAt: new Date("2026-08-28T00:00:00.000Z"),
            identity: {
              kind: "website_stable_visitor" as const,
              keyHash: websiteAnalyticsVisitorDigest(firstVisitor.visitorId, analyticsSecret),
            },
          };
        },
        listWebsitePublicUpdates,
      },
    });
    const response = await handler.GET(request({
      cookie: [
        `__Host-rnr_customer_chat=${sessionToken}`,
        `rnr-consent-v1=${consent}`,
        `ra_vid_v1=${secondVisitor.visitorCookie}`,
        `ra_sid_v1=${secondVisitor.sessionCookie}`,
      ].join("; "),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cursor: null, hasMore: false, events: [], state: "pending" });
    expect(listWebsitePublicUpdates).not.toHaveBeenCalled();
  });
});
