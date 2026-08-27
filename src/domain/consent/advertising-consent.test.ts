import { describe, expect, it, vi } from "vitest";

import {
  ADVERTISING_CONSENT_COOKIE,
  advertisingConsentCookieHeader,
  parseAdvertisingConsent,
  serializeAdvertisingConsent,
} from "./advertising-consent";

const validConsent = {
  version: 1,
  analytics: true,
  advertising: false,
  decidedAt: "2026-08-28T00:00:00.000Z",
} as const;

describe("advertising consent", () => {
  it("round-trips the exact versioned choice", () => {
    const serialized = serializeAdvertisingConsent(validConsent);

    expect(parseAdvertisingConsent(serialized)).toEqual(validConsent);
  });

  it("reads the URL-encoded cookie value sent by the browser", () => {
    expect(parseAdvertisingConsent(encodeURIComponent(serializeAdvertisingConsent(validConsent))))
      .toEqual(validConsent);
  });

  it.each([
    undefined,
    "",
    "not-json",
    JSON.stringify({ ...validConsent, version: 2 }),
    JSON.stringify({ ...validConsent, analytics: "true" }),
    JSON.stringify({ ...validConsent, extra: true }),
    JSON.stringify({ ...validConsent, decidedAt: "2026-08-28" }),
    "x".repeat(513),
  ])("treats malformed, unknown, and oversized values as no choice", (value) => {
    expect(parseAdvertisingConsent(value)).toBeNull();
  });

  it("serializes a one-year HttpOnly Production cookie without a Domain", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const header = advertisingConsentCookieHeader(validConsent, "development");

      expect(header).toContain(`${ADVERTISING_CONSENT_COOKIE}=`);
      expect(header).toContain("Path=/");
      expect(header).toContain("Max-Age=31536000");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Secure");
      expect(header).not.toContain("Domain=");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
