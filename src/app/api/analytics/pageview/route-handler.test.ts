import { describe, expect, it, vi } from "vitest";
import { serializeAdvertisingConsent } from "@/domain/consent/advertising-consent";
import {
  createWebsiteAnalyticsIdentity,
  createWebsiteAnalyticsInternalDevice,
} from "@/server/analytics/website-analytics-cookies";
import { createWebsitePageviewRoute } from "./route-handler";

const origin = "https://rnrgallery.com";
const secret = "test-only-cookie-secret-at-least-32-bytes";
const now = new Date("2026-08-29T10:00:00.000Z");
const eventId = "00000000-0000-4000-8000-000000000001";

function consent(analytics: boolean, advertising: boolean) {
  return encodeURIComponent(serializeAdvertisingConsent({
    version: 1,
    analytics,
    advertising,
    decidedAt: "2026-08-29T09:00:00.000Z",
  }));
}

function request(
  body: unknown,
  options: Readonly<{
    cookie?: string;
    userAgent?: string;
    country?: string;
    requestOrigin?: string;
  }> = {},
) {
  return new Request(`${origin}/api/analytics/pageview`, {
    method: "POST",
    headers: {
      Origin: options.requestOrigin ?? origin,
      "Sec-Fetch-Site": options.requestOrigin && options.requestOrigin !== origin
        ? "cross-site"
        : "same-origin",
      "Content-Type": "application/json",
      Cookie: options.cookie ?? `rnr-consent-v1=${consent(true, false)}`,
      "User-Agent": options.userAgent ?? "Mozilla/5.0 Safari/605.1.15",
      ...(options.country ? { "x-vercel-ip-country": options.country } : {}),
    },
    body: JSON.stringify(body),
  });
}

const body = {
  version: 1,
  eventId,
  pathname: "/products/photo-print-canvas?utm_source=ignored",
  utmSource: "google",
  utmMedium: "cpc",
  utmCampaign: "spring_canvas",
  clickIdTypes: ["gclid"],
  referrerOrigin: "https://www.google.com/",
};

describe("website pageview route", () => {
  function handler(record = vi.fn().mockResolvedValue(undefined)) {
    return {
      record,
      POST: createWebsitePageviewRoute({
        config: { enabled: true, cookieSecret: secret },
        environment: "production",
        trustedOrigin: origin,
        now: () => now,
        record,
      }),
    };
  }

  it("records a consented pageview with server-owned identity and Auckland date", async () => {
    const route = handler();
    const response = await route.POST(request(body, { country: "nz" }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toContain("ra_vid_v1=");
    expect(response.headers.get("Set-Cookie")).toContain("ra_sid_v1=");
    expect(route.record).toHaveBeenCalledWith(expect.objectContaining({
      eventId,
      pathname: "/products/photo-print-canvas",
      localDate: "2026-08-29",
      countryCode: "NZ",
      attribution: {
        channel: "google_ads",
        source: "google",
        medium: "cpc",
        utmCampaign: "spring_canvas",
        clickIdType: null,
      },
      isInternal: false,
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      visitorDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("marks a new session internal only from a valid server-signed device cookie", async () => {
    const marker = createWebsiteAnalyticsInternalDevice(secret, now);
    const route = handler();
    await route.POST(request(body, {
      cookie: `rnr-consent-v1=${consent(true, false)}; ra_internal_v1=${marker}`,
    }));
    expect(route.record).toHaveBeenCalledWith(expect.objectContaining({ isInternal: true }));

    const tampered = handler();
    await tampered.POST(request(body, {
      cookie: `rnr-consent-v1=${consent(true, false)}; ra_internal_v1=${marker.slice(0, -1)}x`,
    }));
    expect(tampered.record).toHaveBeenCalledWith(expect.objectContaining({ isInternal: false }));
  });

  it("reuses valid signed identities and honors advertising click consent", async () => {
    const identity = createWebsiteAnalyticsIdentity(secret, now);
    const cookie = [
      `rnr-consent-v1=${consent(true, true)}`,
      `ra_vid_v1=${identity.visitorCookie}`,
      `ra_sid_v1=${identity.sessionCookie}`,
    ].join("; ");
    const route = handler();

    await route.POST(request({
      ...body,
      utmSource: "facebook",
      utmMedium: "paid_social",
      clickIdTypes: ["fbclid"],
    }, { cookie }));

    expect(route.record).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: identity.sessionId,
      attribution: expect.objectContaining({ channel: "meta_ads", clickIdType: "fbclid" }),
    }));
  });

  it("reuses the signed identity returned by the preceding first pageview", async () => {
    const route = handler();
    const first = await route.POST(request(body));
    const cookies = first.headers.get("Set-Cookie") ?? "";
    const visitor = /ra_vid_v1=([^;]+)/.exec(cookies)?.[1];
    const session = /ra_sid_v1=([^;]+)/.exec(cookies)?.[1];
    expect(visitor).toBeTruthy();
    expect(session).toBeTruthy();

    await route.POST(request({
      ...body,
      eventId: "00000000-0000-4000-8000-000000000002",
      pathname: "/design-gallery",
    }, {
      cookie: [
        `rnr-consent-v1=${consent(true, false)}`,
        `ra_vid_v1=${visitor}`,
        `ra_sid_v1=${session}`,
      ].join("; "),
    }));

    const [firstRecord, secondRecord] = route.record.mock.calls.map(([value]) => value);
    expect(firstRecord).toEqual(expect.objectContaining({
      sessionId: expect.any(String),
      visitorDigest: expect.any(String),
    }));
    expect(secondRecord).toEqual(expect.objectContaining({
      sessionId: firstRecord.sessionId,
      visitorDigest: firstRecord.visitorDigest,
    }));
  });

  it("writes nothing without analytics consent, on private paths, or for bots", async () => {
    const route = handler();
    const requests = [
      request(body, { cookie: `rnr-consent-v1=${consent(false, false)}` }),
      request({ ...body, pathname: "/admin/analytics" }),
      request(body, { userAgent: "Googlebot/2.1" }),
      request(body, { requestOrigin: "https://attacker.example" }),
    ];

    for (const candidate of requests) {
      expect((await route.POST(candidate)).status).toBe(204);
    }
    expect(route.record).not.toHaveBeenCalled();
  });

  it("fails soft when storage is unavailable", async () => {
    const record = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const response = await handler(record).POST(request(body));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("does nothing when the feature flag is disabled", async () => {
    const record = vi.fn();
    const POST = createWebsitePageviewRoute({
      config: { enabled: false, cookieSecret: null },
      trustedOrigin: origin,
      record,
    });
    expect((await POST(request(body))).status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });
});
