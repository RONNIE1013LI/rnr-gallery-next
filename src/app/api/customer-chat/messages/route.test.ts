import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry, parseProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveSafeProductContext } from "@/server/customer-service/website/product-context";
import { createCustomerChatMessagesHandler } from "./route-handler";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";
import {
  createWebsiteAnalyticsIdentity,
  websiteAnalyticsVisitorDigest,
} from "@/server/analytics/website-analytics-cookies";

const sessionToken = "s".repeat(43);
const sessionSecret = "website-session-secret-that-is-long-enough";
const abuseSecret = "website-abuse-secret-that-is-long-enough";
const now = new Date("2026-08-21T00:00:00.000Z");
const registry = parseProductRegistry(defaultProductRegistry);

function request(body: unknown, input: Readonly<{
  origin?: string;
  contentType?: string;
  cookie?: string;
  rawBody?: string;
}> = {}) {
  return new Request("https://rrgallery.co.nz/api/customer-chat/messages", {
    method: "POST",
    headers: {
      origin: input.origin ?? "https://rrgallery.co.nz",
      "content-type": input.contentType ?? "application/json",
      "sec-fetch-site": "same-origin",
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    body: input.rawBody ?? JSON.stringify(body),
  });
}

function setup(input: Readonly<{
  enabled?: boolean;
  analyticsConfig?: Readonly<{
    enabled: boolean;
    v2Enabled: boolean;
    cookieSecret: string | null;
    attributionLookbackDays: number;
  }>;
  ingestResults?: readonly ({ status: "duplicate" } | { status: "rate_limited" } | {
    status: "turn_pending";
    messageId: string;
    turnId: string;
    debounceUntil: Date;
  })[];
}> = {}) {
  const ingestConversationEvent = vi.fn();
  for (const result of input.ingestResults ?? [{
    status: "turn_pending" as const,
    messageId: "message-private",
    turnId: "turn-private",
    debounceUntil: new Date("2026-08-21T00:00:02.000Z"),
  }]) ingestConversationEvent.mockResolvedValueOnce(result);
  const repository = {
    resolveWebsiteSession: vi.fn().mockResolvedValue(null),
    ensureWebsiteSession: vi.fn().mockResolvedValue({
      conversationId: "conversation-private",
      expiresAt: new Date("2026-08-28T00:00:00.000Z"),
    }),
    ingestConversationEvent,
  };
  const tasks: (() => Promise<void>)[] = [];
  const processTurn = vi.fn(async () => undefined);
  const processReviewAlert = vi.fn(async () => undefined);
  const processCustomerNotifications = vi.fn(async () => undefined);
  const resolveProductContext = vi.fn(async (pathname: string) => (
    resolveSafeProductContext(pathname, registry)
  ));
  const handler = createCustomerChatMessagesHandler({
    enabled: input.enabled ?? true,
    trustedOrigin: "https://rrgallery.co.nz",
    sessionSecret,
    messageHashSecret: abuseSecret,
    debounceMs: 2_000,
    repository,
    resolveProductContext,
    processTurn,
    processReviewAlert,
    processCustomerNotifications,
    scheduleAfter: (task) => tasks.push(task),
    waitUntil: vi.fn(async () => undefined),
    now: () => now,
    cookieEnvironment: "preview",
    createSessionToken: () => sessionToken,
    resolveTrustedIp: () => "203.0.113.42",
    analyticsConfig: input.analyticsConfig ?? {
      enabled: false,
      v2Enabled: false,
      cookieSecret: null,
      attributionLookbackDays: 90,
    },
  });
  return {
    handler,
    repository,
    tasks,
    processTurn,
    processReviewAlert,
    processCustomerNotifications,
    resolveProductContext,
  };
}

const validBody = {
  clientMessageKey: "A".repeat(22),
  message: "What details do you need for a quote?",
  pageContext: { pathname: "/products/roll-up-banner" },
};

describe("POST /api/customer-chat/messages", () => {
  it("passes only signed consented V1 identity to the authoritative inquiry write", async () => {
    const analyticsSecret = "customer-chat-analytics-secret-value-0001";
    const identity = createWebsiteAnalyticsIdentity(analyticsSecret, now);
    const consent = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-20T23:00:00.000Z",
    }));
    const current = setup({
      analyticsConfig: {
        enabled: true,
        v2Enabled: true,
        cookieSecret: analyticsSecret,
        attributionLookbackDays: 90,
      },
    });

    const response = await current.handler.POST(request(validBody, {
      cookie: [
        `rnr-consent-v1=${consent}`,
        `ra_vid_v1=${identity.visitorCookie}`,
        `ra_sid_v1=${identity.sessionCookie}`,
      ].join("; "),
    }));

    expect(response.status).toBe(202);
    expect(current.repository.ingestConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        websiteAnalyticsContext: {
          consentLinked: true,
          visitorDigest: websiteAnalyticsVisitorDigest(identity.visitorId, analyticsSecret),
          convertingSessionId: identity.sessionId,
          isInternal: false,
        },
      }),
    );
  });

  it("persists first, returns a minimal 202 response, and schedules the durable turn", async () => {
    const current = setup();
    const response = await current.handler.POST(request(validBody));

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-rnr_customer_chat=");
    const responseBody = await response.json();
    expect(responseBody).toEqual({ status: "accepted" });
    expect(current.repository.ingestConversationEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: "website",
      role: "customer",
      text: validBody.message,
      externalConversationKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      externalMessageKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      productContext: expect.objectContaining({ productKey: "roll-up-banner" }),
    }));
    expect(current.tasks).toHaveLength(1);
    await current.tasks[0]();
    expect(current.processTurn).toHaveBeenCalledWith("turn-private");
    expect(current.processReviewAlert).toHaveBeenCalledOnce();
    expect(current.processCustomerNotifications).toHaveBeenCalledOnce();
    expect(current.processReviewAlert.mock.invocationCallOrder[0])
      .toBeLessThan(current.processCustomerNotifications.mock.invocationCallOrder[0]);
    expect(JSON.stringify(responseBody))
      .not.toMatch(/message-private|turn-private|conversation-private|policy|hash|secret/i);
  });

  it("keeps the accepted chat response and durable alert recovery path when best-effort alert delivery fails", async () => {
    const current = setup();
    current.processReviewAlert.mockRejectedValueOnce(new Error("email provider unavailable"));

    const response = await current.handler.POST(request(validBody));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(current.repository.ingestConversationEvent).toHaveBeenCalledOnce();
    expect(current.tasks).toHaveLength(1);
    await expect(current.tasks[0]()).resolves.toBeUndefined();
    expect(current.processTurn).toHaveBeenCalledWith("turn-private");
    expect(current.processReviewAlert).toHaveBeenCalledOnce();
    expect(current.processCustomerNotifications).toHaveBeenCalledOnce();
  });

  it("accepts a duplicate retry without scheduling duplicate processing", async () => {
    const current = setup({ ingestResults: [{
      status: "turn_pending", messageId: "message-private", turnId: "turn-private",
      debounceUntil: new Date("2026-08-21T00:00:02.000Z"),
    }, { status: "duplicate" }] });
    const cookie = `__Host-rnr_customer_chat=${sessionToken}`;
    current.repository.resolveWebsiteSession.mockResolvedValue({
      conversationId: "conversation-private",
      expiresAt: new Date("2026-08-28T00:00:00.000Z"),
    });

    const first = await current.handler.POST(request(validBody, { cookie }));
    const second = await current.handler.POST(request(validBody, { cookie }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(current.tasks).toHaveLength(1);
    expect(current.repository.ingestConversationEvent).toHaveBeenCalledTimes(2);
  });

  it("returns 429 without scheduling processing when the database rejects website abuse", async () => {
    const current = setup({ ingestResults: [{ status: "rate_limited" }] });

    const response = await current.handler.POST(request(validBody));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "RATE_LIMITED" } });
    expect(current.tasks).toHaveLength(0);
    expect(current.processTurn).not.toHaveBeenCalled();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(current.repository.ensureWebsiteSession).not.toHaveBeenCalled();
  });

  it("fails closed before session creation when the feature is disabled", async () => {
    const current = setup({ enabled: false });
    const response = await current.handler.POST(request(validBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "SERVICE_UNAVAILABLE" } });
    expect(current.repository.ensureWebsiteSession).not.toHaveBeenCalled();
    expect(current.repository.ingestConversationEvent).not.toHaveBeenCalled();
  });

  it.each([
    [request(validBody, { origin: "https://evil.example" }), 403],
    [request(validBody, { contentType: "text/plain" }), 415],
    [request([], {}), 422],
    [request({ ...validBody, clientMessageKey: "bad key" }), 422],
    [request({ ...validBody, message: "x".repeat(2_001) }), 422],
    [request(validBody, { rawBody: JSON.stringify({ data: "x".repeat(4_097) }) }), 413],
  ])("rejects malformed public input without creating a session", async (incoming, status) => {
    const current = setup();
    const response = await current.handler.POST(incoming);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code: "REQUEST_REJECTED" } });
    expect(current.repository.ensureWebsiteSession).not.toHaveBeenCalled();
    expect(current.repository.ingestConversationEvent).not.toHaveBeenCalled();
  });

  it("returns a generic failure without leaking internal errors", async () => {
    const current = setup();
    current.repository.ingestConversationEvent.mockReset();
    current.repository.ingestConversationEvent.mockRejectedValueOnce(new Error("private database host and token"));
    const response = await current.handler.POST(request(validBody));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(body)).not.toMatch(/database|token|private/i);
  });

  it("rejects invalid UTF-8 as a generic public request error", async () => {
    const current = setup();
    const response = await current.handler.POST(new Request(
      "https://rrgallery.co.nz/api/customer-chat/messages",
      {
        method: "POST",
        headers: {
          origin: "https://rrgallery.co.nz",
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: new Uint8Array([0xc3, 0x28]),
      },
    ));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "REQUEST_REJECTED" } });
    expect(current.repository.ensureWebsiteSession).not.toHaveBeenCalled();
  });
});
