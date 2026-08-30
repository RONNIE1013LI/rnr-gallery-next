import { describe, expect, it } from "vitest";

import { resolveWebsiteAnalyticsAttribution } from "./website-analytics-attribution-v2";

const conversion = { occurredAt: new Date("2026-08-30T00:00:00.000Z"), visitorDigest: "visitor-1", convertingSessionId: "direct", consentLinked: true, sourceReference: "order-1" } as const;
const sessions = [
  { id: "first", visitorDigest: "visitor-1", startedAt: new Date("2026-06-15T00:00:00.000Z"), channel: "google_ads", source: "google", medium: "cpc", campaign: "Winter", term: "canvas gifts", content: "hero-a", landingPath: "/canvas", referrerOrigin: "https://www.google.co.nz", market: "NZ", countryCode: "NZ", deviceCategory: "mobile", consentQualifiedClickIds: { gclid: "server-only-gclid" } },
  { id: "last", visitorDigest: "visitor-1", startedAt: new Date("2026-08-29T22:00:00.000Z"), channel: "meta_ads", source: "meta", medium: "paid_social", campaign: "August" },
  { id: "direct", visitorDigest: "visitor-1", startedAt: new Date("2026-08-30T00:00:00.000Z"), channel: "direct", source: "direct", medium: null, campaign: null },
] as const;

describe("website analytics v2 attribution", () => {
  it("freezes first-touch and last-non-direct attribution snapshots", () => {
    const result = resolveWebsiteAnalyticsAttribution({ conversion, sessions });
    expect(result).toMatchObject({ firstSessionId: "first", lastSessionId: "direct", lastNonDirectSessionId: "last" });
    expect(result.firstTouch).toMatchObject({
      sessionId: "first", channel: "google_ads", source: "google", term: "canvas gifts", content: "hero-a",
      landingPath: "/canvas", externalReferrerOrigin: "https://www.google.co.nz", market: "NZ", countryCode: "NZ",
      deviceCategory: "mobile", consentQualifiedClickIds: { gclid: "server-only-gclid" }, visitorReference: "visitor-1",
      conversionReference: "order-1", attributedAt: "2026-08-30T00:00:00.000Z",
    });
    expect(result.lastTouch).toMatchObject({ sessionId: "last", channel: "meta_ads", source: "meta" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.firstTouch)).toBe(true);
    expect(Object.isFrozen(result.firstTouch.consentQualifiedClickIds)).toBe(true);
  });

  it("falls back from a direct converting session to the last non-direct session", () => {
    expect(resolveWebsiteAnalyticsAttribution({ conversion, sessions }).lastTouch.channel).toBe("meta_ads");
  });

  it("uses the valid converting session when there is no non-direct touch", () => {
    expect(resolveWebsiteAnalyticsAttribution({ conversion, sessions: [sessions[2]] }).lastTouch).toMatchObject({ channel: "direct", sessionId: "direct" });
  });

  it("expires touches outside the 90-day lookback", () => {
    expect(resolveWebsiteAnalyticsAttribution({
      conversion,
      sessions: [{ ...sessions[0], startedAt: new Date("2026-05-31T23:59:59.000Z") }, sessions[2]],
    }).firstTouch).toMatchObject({ channel: "direct", sessionId: "direct" });
  });

  it.each([
    [{ ...conversion, consentLinked: false }, sessions],
    [{ ...conversion, convertingSessionId: "missing" }, sessions],
    [{ ...conversion, historical: true }, sessions],
  ])("uses the explicit unattributed snapshot when behavioural attribution is unavailable", (conversionInput, sessionInput) => {
    expect(resolveWebsiteAnalyticsAttribution({ conversion: conversionInput, sessions: sessionInput }).lastTouch).toMatchObject({ channel: "unattributed", source: "Unattributed", sessionId: null });
  });

  it("keeps manual and offline conversions in their own immutable attribution class", () => {
    const result = resolveWebsiteAnalyticsAttribution({ conversion: { ...conversion, source: "manual" }, sessions });
    expect(result.lastTouch).toMatchObject({ channel: "manual", source: "Manual / Offline / Unattributed", sessionId: null, conversionReference: "order-1" });
    expect(Object.isFrozen(result.lastTouch)).toBe(true);
  });

  it("does not treat the gallery's own referrer as an external acquisition channel", () => {
    for (const hostname of ["rnrgallery.com", "www.rnrgallery.com", "rrgallery.co.nz", "www.rrgallery.co.nz"]) {
      expect(resolveWebsiteAnalyticsAttribution({
        conversion: { ...conversion, convertingSessionId: hostname },
        sessions: [{ ...sessions[2], id: hostname, channel: "other", source: hostname, medium: "referral", referrerOrigin: `https://${hostname}` }],
      }).lastTouch).toMatchObject({ channel: "direct", source: "direct", externalReferrerOrigin: null });
    }
  });

  it.each([
    ["google_ads", "google", "cpc", { gclid: "redirect-click" }],
    ["meta_ads", "meta", "paid_social", { fbclid: "redirect-click" }],
  ] as const)("preserves %s attribution when an old-domain redirect is the referrer", (
    channel,
    source,
    medium,
    consentQualifiedClickIds,
  ) => {
    const redirected = {
      ...sessions[2],
      id: "redirected-paid",
      channel,
      source,
      medium,
      referrerOrigin: "https://rrgallery.co.nz",
      consentQualifiedClickIds,
    };
    expect(resolveWebsiteAnalyticsAttribution({
      conversion: { ...conversion, convertingSessionId: redirected.id },
      sessions: [redirected],
    }).lastTouch).toMatchObject({
      channel,
      source,
      consentQualifiedClickIds,
    });
  });

  it("uses session IDs as a deterministic tie-breaker when session timestamps match", () => {
    const tied = [
      { ...sessions[2], id: "z", channel: "meta_ads" as const, source: "meta" },
      { ...sessions[2], id: "a", channel: "google_ads" as const, source: "google" },
    ];
    const input = { conversion: { ...conversion, convertingSessionId: "z" }, sessions: tied } as const;
    expect(resolveWebsiteAnalyticsAttribution(input)).toMatchObject({ firstSessionId: "a", lastSessionId: "z", lastNonDirectSessionId: "z" });
    expect(resolveWebsiteAnalyticsAttribution({ ...input, sessions: [...tied].reverse() })).toMatchObject({ firstSessionId: "a", lastSessionId: "z", lastNonDirectSessionId: "z" });
  });
});
