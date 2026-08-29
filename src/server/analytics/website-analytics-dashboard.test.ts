import { describe, expect, it } from "vitest";
import { websiteAnalyticsDateRange } from "./website-analytics-dashboard";

describe("website analytics dashboard dates", () => {
  const now = new Date("2026-08-29T12:30:00.000Z");

  it.each([
    ["today", "2026-08-30", "2026-08-30"],
    ["yesterday", "2026-08-29", "2026-08-29"],
    ["7d", "2026-08-24", "2026-08-30"],
    ["30d", "2026-08-01", "2026-08-30"],
  ] as const)("builds the %s Auckland range", (period, startDate, endDate) => {
    expect(websiteAnalyticsDateRange(period, now)).toEqual({ period, startDate, endDate });
  });
});
