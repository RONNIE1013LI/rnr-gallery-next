import { describe, expect, it } from "vitest";

import { createConsentRoute } from "./route-handler";

const origin = "https://rnrgallery.com";
const now = new Date("2026-08-28T01:02:03.000Z");

function consentRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request(`${origin}/api/consent`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("consent route", () => {
  it("stores only the two chosen booleans with a server-generated timestamp", async () => {
    const route = createConsentRoute({
      trustedOrigin: origin,
      now: () => now,
      environment: "production",
    });

    const response = await route.POST(consentRequest({ analytics: true, advertising: false }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      consent: {
        version: 1,
        analytics: true,
        advertising: false,
        decidedAt: "2026-08-28T01:02:03.000Z",
      },
    });
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });

  it("rejects cross-origin and non-JSON mutations without setting a cookie", async () => {
    const route = createConsentRoute({ trustedOrigin: origin, now: () => now });
    const crossOrigin = consentRequest(
      { analytics: true, advertising: true },
      { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    );
    const nonJson = new Request(`${origin}/api/consent`, {
      method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain" },
      body: "analytics=true",
    });

    for (const request of [crossOrigin, nonJson]) {
      const response = await route.POST(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("rejects unknown, malformed, and oversized choices without recording a decision", async () => {
    const route = createConsentRoute({ trustedOrigin: origin, now: () => now });
    const oversized = consentRequest({ analytics: true, advertising: false, padding: "x".repeat(1_000) });
    const malformed = new Request(`${origin}/api/consent`, {
      method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: "{",
    });

    for (const request of [
      consentRequest({ analytics: true, advertising: false, extra: true }),
      consentRequest({ analytics: "true", advertising: false }),
      malformed,
      oversized,
    ]) {
      const response = await route.POST(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("expires first-party analytics identity when analytics consent is denied", async () => {
    const route = createConsentRoute({ trustedOrigin: origin, now: () => now });

    const response = await route.POST(consentRequest({ analytics: false, advertising: false }));
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("ra_vid_v1=");
    expect(cookie).toContain("ra_sid_v1=");
    expect(cookie.match(/Max-Age=0/g)).toHaveLength(2);
  });
});
