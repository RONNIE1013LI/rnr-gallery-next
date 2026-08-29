import { describe, expect, it } from "vitest";

import {
  ANALYTICS_DIMENSION_SENTINELS,
  WEBSITE_ANALYTICS_V2_RULES_VERSION,
  isWebsiteAnalyticsAttributionModel,
  isWebsiteAnalyticsCurrency,
  isWebsiteAnalyticsScope,
  normalizeAnalyticsDimension,
} from "./website-analytics-v2";

describe("website analytics v2 contract", () => {
  it("uses a versioned contract and explicit missing dimensions", () => {
    expect(WEBSITE_ANALYTICS_V2_RULES_VERSION).toBe("v2");
    expect(normalizeAnalyticsDimension(null, "source")).toBe(ANALYTICS_DIMENSION_SENTINELS.unattributed);
    expect(normalizeAnalyticsDimension("", "campaign")).toBe(ANALYTICS_DIMENSION_SENTINELS.notSet);
    expect(normalizeAnalyticsDimension("manual", "channel")).toBe(ANALYTICS_DIMENSION_SENTINELS.manualOffline);
    expect(normalizeAnalyticsDimension(null, "channel")).toBe(ANALYTICS_DIMENSION_SENTINELS.unattributed);
    expect(isWebsiteAnalyticsScope("website")).toBe(true);
    expect(isWebsiteAnalyticsScope("other")).toBe(false);
    expect(isWebsiteAnalyticsCurrency("NZD")).toBe(true);
    expect(isWebsiteAnalyticsCurrency("USD")).toBe(false);
    expect(isWebsiteAnalyticsAttributionModel("last_touch")).toBe(true);
    expect(isWebsiteAnalyticsAttributionModel("position_based")).toBe(false);
  });
});
