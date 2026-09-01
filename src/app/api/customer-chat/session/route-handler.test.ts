import { describe, expect, it, vi } from "vitest";

import { createCustomerChatSessionHandler } from "./route-handler";
import { hashWebsiteConversationKey } from "@/server/customer-service/website/session";
import {
  createWebsiteAnalyticsIdentity,
  websiteAnalyticsVisitorDigest,
} from "@/server/analytics/website-analytics-cookies";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";

const token = "s".repeat(43);
const now = new Date("2026-08-21T00:00:00.000Z");
const sessionSecret = "website-session-secret-that-is-long-enough";

function request(body: unknown, input: Readonly<{ origin?: string; contentType?: string; rawBody?: string }> = {}) {
  return new Request("https://rrgallery.co.nz/api/customer-chat/session", {
    method: "POST",
    headers: {
      origin: input.origin ?? "https://rrgallery.co.nz",
      "content-type": input.contentType ?? "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: input.rawBody ?? JSON.stringify(body),
  });
}

function setup(input: Readonly<{
  enabled?: boolean;
  active?: boolean;
  identity?: {
    kind: "website_stable_visitor";
    keyHash: string;
  };
  analyticsSecret?: string;
  createToken?: string;
}> = {}) {
  const repository = {
    resolveWebsiteSession: vi.fn().mockResolvedValue(input.active
      ? {
          conversationId: "conversation-private",
          expiresAt: new Date("2026-08-28T00:00:00.000Z"),
          identity: input.identity ?? {
            kind: "website_conversation",
            keyHash: hashWebsiteConversationKey(token, sessionSecret),
          },
        }
      : null),
  };
  return {
    repository,
    handler: createCustomerChatSessionHandler({
      enabled: input.enabled ?? true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret,
      permitSecret: "website-permit-secret-that-is-long-enough",
      repository,
      getOptionalSession: async () => null,
      analyticsConfig: input.analyticsSecret ? {
        enabled: true,
        v2Enabled: true,
        cookieSecret: input.analyticsSecret,
        attributionLookbackDays: 90,
      } : {
        enabled: false,
        v2Enabled: false,
        cookieSecret: null,
        attributionLookbackDays: 90,
      },
      now: () => now,
      cookieEnvironment: "preview",
      createSessionToken: () => input.createToken ?? token,
      createPermitNonce: () => "n".repeat(22),
    }),
  };
}

const validBody = { version: 1, clientMessageKey: "M".repeat(22) };

describe("POST /api/customer-chat/session", () => {
  it("issues only an HttpOnly cookie and opaque no-store permit with no database write", async () => {
    const current = setup();
    const response = await current.handler.POST(request(validBody));
    const body = await response.json() as { status: string; permit: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-rnr_customer_chat=");
    expect(body).toMatchObject({ status: "ready", permit: expect.stringMatching(/^v1\./) });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain("conversation-private");
    expect(current.repository.resolveWebsiteSession).not.toHaveBeenCalled();
  });

  it("reuses an active cookie without replacing it", async () => {
    const current = setup({ active: true });
    const response = await current.handler.POST(new Request("https://rrgallery.co.nz/api/customer-chat/session", {
      method: "POST",
      headers: {
        origin: "https://rrgallery.co.nz",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        cookie: `__Host-rnr_customer_chat=${token}`,
      },
      body: JSON.stringify(validBody),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(current.repository.resolveWebsiteSession).toHaveBeenCalledOnce();
  });

  it("reuses only the same consent-linked stable visitor and rotates when it changes", async () => {
    const analyticsSecret = "website-session-analytics-secret-long-enough";
    const firstVisitor = createWebsiteAnalyticsIdentity(analyticsSecret, now);
    const secondVisitor = createWebsiteAnalyticsIdentity(analyticsSecret, now);
    const stableIdentity = {
      kind: "website_stable_visitor" as const,
      keyHash: websiteAnalyticsVisitorDigest(firstVisitor.visitorId, analyticsSecret),
    };
    const consent = encodeURIComponent(serializeAdvertisingConsent({
      version: 1,
      analytics: true,
      advertising: false,
      decidedAt: "2026-08-20T23:00:00.000Z",
    }));
    const requestWithVisitor = (visitorCookie: string, sessionCookie: string) => new Request(
      "https://rrgallery.co.nz/api/customer-chat/session",
      {
        method: "POST",
        headers: {
          origin: "https://rrgallery.co.nz",
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          cookie: [
            `__Host-rnr_customer_chat=${token}`,
            `rnr-consent-v1=${consent}`,
            `ra_vid_v1=${visitorCookie}`,
            `ra_sid_v1=${sessionCookie}`,
          ].join("; "),
        },
        body: JSON.stringify(validBody),
      },
    );
    const same = setup({ active: true, identity: stableIdentity, analyticsSecret });
    const sameResponse = await same.handler.POST(requestWithVisitor(
      firstVisitor.visitorCookie,
      firstVisitor.sessionCookie,
    ));
    expect(sameResponse.status).toBe(200);
    expect(sameResponse.headers.get("Set-Cookie")).toBeNull();

    const rotatedToken = "r".repeat(43);
    const changed = setup({
      active: true,
      identity: stableIdentity,
      analyticsSecret,
      createToken: rotatedToken,
    });
    const changedResponse = await changed.handler.POST(requestWithVisitor(
      secondVisitor.visitorCookie,
      secondVisitor.sessionCookie,
    ));
    expect(changedResponse.status).toBe(200);
    expect(changedResponse.headers.get("Set-Cookie")).toContain(rotatedToken);
  });

  it.each([
    ["disabled", setup({ enabled: false }), request(validBody), 503],
    ["cross-origin", setup(), request(validBody, { origin: "https://evil.example" }), 403],
    ["wrong media type", setup(), request(validBody, { contentType: "text/plain" }), 415],
    ["malformed body", setup(), request(validBody, { rawBody: "{" }), 422],
    ["oversized body", setup(), request(validBody, { rawBody: JSON.stringify({ ...validBody, padding: "x".repeat(1_100) }) }), 413],
  ])("rejects %s without issuing a cookie or resolving a session", async (_name, current, input, status) => {
    const response = await current.handler.POST(input);

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(current.repository.resolveWebsiteSession).not.toHaveBeenCalled();
  });
});
