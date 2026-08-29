import { describe, expect, it } from "vitest";

import { readWebsiteAnalyticsConfig } from "./website-analytics-config";

describe("website analytics config", () => {
  it("is disabled unless the feature flag is explicitly true", () => {
    expect(readWebsiteAnalyticsConfig({})).toEqual({ enabled: false, cookieSecret: null });
    expect(readWebsiteAnalyticsConfig({ FIRST_PARTY_ANALYTICS_ENABLED: "false" }))
      .toEqual({ enabled: false, cookieSecret: null });
  });

  it("requires a strong server-only cookie secret when enabled", () => {
    expect(() => readWebsiteAnalyticsConfig({
      FIRST_PARTY_ANALYTICS_ENABLED: "true",
      FIRST_PARTY_ANALYTICS_COOKIE_SECRET: "short",
    })).toThrow(/cookie secret/i);

    expect(readWebsiteAnalyticsConfig({
      FIRST_PARTY_ANALYTICS_ENABLED: "true",
      FIRST_PARTY_ANALYTICS_COOKIE_SECRET: "x".repeat(32),
    })).toEqual({ enabled: true, cookieSecret: "x".repeat(32) });
  });
});
