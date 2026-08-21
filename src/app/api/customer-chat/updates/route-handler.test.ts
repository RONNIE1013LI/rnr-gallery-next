import { describe, expect, it, vi } from "vitest";
import { createCustomerChatUpdatesHandler } from "./route-handler";

const sessionSecret = "website-session-secret-that-is-long-enough";
const sessionToken = "s".repeat(43);
const now = new Date("2026-08-21T00:00:00.000Z");

function request(input: { cookie?: string; cursor?: string; conversation?: string } = {}) {
  const url = new URL("https://rrgallery.co.nz/api/customer-chat/updates");
  if (input.cursor) url.searchParams.set("cursor", input.cursor);
  if (input.conversation) url.searchParams.set("conversation", input.conversation);
  return new Request(url, {
    headers: input.cookie ? { cookie: input.cookie } : undefined,
  });
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
            state: "committed_assistant" as const,
          }];
        },
      },
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
          };
        },
        async listWebsitePublicUpdates() {
          return [];
        },
      },
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
    });

    const response = await handler.GET(request({ cookie: `__Host-rnr_customer_chat=${sessionToken}` }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
  });
});
