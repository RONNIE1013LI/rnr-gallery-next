import { describe, expect, it } from "vitest";

import { resolveWebsiteAnalyticsAttribution } from "./website-analytics-attribution-v2";

const conversion = { occurredAt: new Date("2026-08-30T00:00:00.000Z"), visitorDigest: "visitor-1", convertingSessionId: "direct", consentLinked: true } as const;
const sessions = [
  { id: "first", visitorDigest: "visitor-1", startedAt: new Date("2026-06-15T00:00:00.000Z"), channel: "google_ads", source: "google", medium: "cpc", campaign: "Winter" },
  { id: "last", visitorDigest: "visitor-1", startedAt: new Date("2026-08-29T22:00:00.000Z"), channel: "meta_ads", source: "meta", medium: "paid_social", campaign: "August" },
  { id: "direct", visitorDigest: "visitor-1", startedAt: new Date("2026-08-30T00:00:00.000Z"), channel: "direct", source: "direct", medium: null, campaign: null },
] as const;

describe("website analytics v2 attribution", () => {
  it("freezes first-touch and last-non-direct attribution snapshots", () => {
    const result = resolveWebsiteAnalyticsAttribution({ conversion, sessions });
    expect(result).toMatchObject({ firstSessionId: "first", lastSessionId: "direct", lastNonDirectSessionId: "last" });
    expect(result.firstTouch).toMatchObject({ sessionId: "first", channel: "google_ads", source: "google" });
    expect(result.lastTouch).toMatchObject({ sessionId: "last", channel: "meta_ads", source: "meta" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lastTouch)).toBe(true);
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
    [{ ...conversion, source: "manual" as const }, sessions],
    [{ ...conversion, historical: true }, sessions],
  ])("uses the explicit unattributed snapshot when behavioural attribution is unavailable", (conversionInput, sessionInput) => {
    expect(resolveWebsiteAnalyticsAttribution({ conversion: conversionInput, sessions: sessionInput }).lastTouch).toMatchObject({ channel: "unattributed", source: "Unattributed", sessionId: null });
  });

  it("does not treat the gallery's own referrer as an external acquisition channel", () => {
    expect(resolveWebsiteAnalyticsAttribution({
      conversion: { ...conversion, convertingSessionId: "self" },
      sessions: [{ ...sessions[2], id: "self", channel: "other", source: "rrgallery.co.nz", referrerOrigin: "https://www.rrgallery.co.nz" }],
    }).lastTouch).toMatchObject({ channel: "direct", source: "direct" });
  });
});
