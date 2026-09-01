import { describe, expect, it, vi } from "vitest";

import { createCustomerChatSessionHandler } from "./route-handler";

const token = "s".repeat(43);
const now = new Date("2026-08-21T00:00:00.000Z");

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

function setup(input: Readonly<{ enabled?: boolean; active?: boolean }> = {}) {
  const repository = {
    resolveWebsiteSession: vi.fn().mockResolvedValue(input.active
      ? { conversationId: "conversation-private", expiresAt: new Date("2026-08-28T00:00:00.000Z") }
      : null),
  };
  return {
    repository,
    handler: createCustomerChatSessionHandler({
      enabled: input.enabled ?? true,
      trustedOrigin: "https://rrgallery.co.nz",
      sessionSecret: "website-session-secret-that-is-long-enough",
      permitSecret: "website-permit-secret-that-is-long-enough",
      repository,
      now: () => now,
      cookieEnvironment: "preview",
      createSessionToken: () => token,
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
