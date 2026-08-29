import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  clearWebsiteAnalyticsCookieHeaders,
  createWebsiteAnalyticsIdentity,
  parseWebsiteAnalyticsSession,
  parseWebsiteAnalyticsVisitor,
  websiteAnalyticsCookieHeaders,
  websiteAnalyticsVisitorDigest,
} from "./website-analytics-cookies";

const secret = "test-only-cookie-secret-at-least-32-bytes";
const now = new Date("2026-08-29T10:00:00.000Z");

describe("website analytics cookies", () => {
  it("creates server-signed visitor and session identities", () => {
    const identity = createWebsiteAnalyticsIdentity(secret, now);

    expect(parseWebsiteAnalyticsVisitor(identity.visitorCookie, secret, now))
      .toEqual({ visitorId: identity.visitorId, issuedAt: now });
    expect(parseWebsiteAnalyticsSession(identity.sessionCookie, secret, now))
      .toEqual({ sessionId: identity.sessionId, lastActivityAt: now });
  });

  it("rejects tampered, expired, and client-invented session values", () => {
    const identity = createWebsiteAnalyticsIdentity(secret, now);
    const tampered = `${identity.sessionCookie.slice(0, -1)}x`;
    const expiredAt = new Date(now.getTime() + 30 * 60_000 + 1);

    expect(parseWebsiteAnalyticsSession(tampered, secret, now)).toBeNull();
    expect(parseWebsiteAnalyticsSession(randomUUID(), secret, now)).toBeNull();
    expect(parseWebsiteAnalyticsSession(identity.sessionCookie, secret, expiredAt)).toBeNull();
  });

  it("produces stable non-reversible visitor digests", () => {
    const identity = createWebsiteAnalyticsIdentity(secret, now);
    const digest = websiteAnalyticsVisitorDigest(identity.visitorId, secret);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(websiteAnalyticsVisitorDigest(identity.visitorId, secret)).toBe(digest);
    expect(digest).not.toContain(identity.visitorId);
  });

  it("sets HttpOnly host-only cookies and can expire both cookies", () => {
    const identity = createWebsiteAnalyticsIdentity(secret, now);
    const headers = websiteAnalyticsCookieHeaders(identity, "production");
    const cleared = clearWebsiteAnalyticsCookieHeaders("production");

    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Secure");
      expect(header).not.toContain("Domain=");
    }
    expect(cleared).toHaveLength(2);
    expect(cleared.every((header) => header.includes("Max-Age=0"))).toBe(true);
  });
});
