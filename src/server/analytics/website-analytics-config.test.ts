import { describe, expect, it } from "vitest";

import {
  readWebsiteAnalyticsBusinessConfig,
  readWebsiteAnalyticsConfig,
} from "./website-analytics-config";

describe("website analytics config", () => {
  it("is disabled unless the feature flag is explicitly true", () => {
    expect(readWebsiteAnalyticsConfig({})).toEqual({
      enabled: false,
      cookieSecret: null,
      v2Enabled: false,
      attributionLookbackDays: 90,
    });
    expect(readWebsiteAnalyticsConfig({ FIRST_PARTY_ANALYTICS_ENABLED: "false" }))
      .toEqual({
        enabled: false,
        cookieSecret: null,
        v2Enabled: false,
        attributionLookbackDays: 90,
      });
  });

  it("fails the V2 flag closed for missing and invalid values without changing V1", () => {
    const base = {
      FIRST_PARTY_ANALYTICS_ENABLED: "true",
      FIRST_PARTY_ANALYTICS_COOKIE_SECRET: "x".repeat(32),
    };

    expect(readWebsiteAnalyticsConfig(base)).toMatchObject({ enabled: true, v2Enabled: false });
    expect(readWebsiteAnalyticsConfig({ ...base, WEBSITE_ANALYTICS_V2_ENABLED: "yes" }))
      .toMatchObject({ enabled: true, v2Enabled: false });
    expect(readWebsiteAnalyticsConfig({ ...base, WEBSITE_ANALYTICS_V2_ENABLED: " TRUE " }))
      .toMatchObject({ enabled: true, v2Enabled: true });
  });

  it.each([
    [undefined, 90],
    ["", 90],
    ["invalid", 90],
    ["0", 90],
    ["-1", 90],
    ["1.5", 90],
    ["30", 30],
    ["90", 90],
    ["91", 90],
  ])("defaults or clamps attribution lookback %s to %i days", (value, expected) => {
    expect(readWebsiteAnalyticsConfig({
      ANALYTICS_ATTRIBUTION_LOOKBACK_DAYS: value,
    }).attributionLookbackDays).toBe(expected);
  });

  it("requires a strong server-only cookie secret when enabled", () => {
    expect(() => readWebsiteAnalyticsConfig({
      FIRST_PARTY_ANALYTICS_ENABLED: "true",
      FIRST_PARTY_ANALYTICS_COOKIE_SECRET: "short",
    })).toThrow(/cookie secret/i);

    expect(readWebsiteAnalyticsConfig({
      FIRST_PARTY_ANALYTICS_ENABLED: "true",
      FIRST_PARTY_ANALYTICS_COOKIE_SECRET: "x".repeat(32),
    })).toEqual({
      enabled: true,
      cookieSecret: "x".repeat(32),
      v2Enabled: false,
      attributionLookbackDays: 90,
    });
  });

  it.each(["false", "true"])(
    "provides a disabled business-path config when V2=%s and V1 secret validation fails",
    (v2Enabled) => {
      expect(readWebsiteAnalyticsBusinessConfig({
        FIRST_PARTY_ANALYTICS_ENABLED: "true",
        FIRST_PARTY_ANALYTICS_COOKIE_SECRET: "short",
        WEBSITE_ANALYTICS_V2_ENABLED: v2Enabled,
      })).toEqual({
        enabled: false,
        cookieSecret: null,
        v2Enabled: false,
        attributionLookbackDays: 90,
      });
    },
  );
});
