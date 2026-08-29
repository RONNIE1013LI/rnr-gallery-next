import { describe, expect, it } from "vitest";

import {
  analyticsDateRange,
  analyticsGranularity,
  previousAnalyticsDateRange,
} from "./website-analytics-date-range";

describe("website analytics v2 Auckland date ranges", () => {
  it.each([
    ["today", "2026-09-27", "2026-09-27", "2026-09-26T12:00:00.000Z", "2026-09-27T11:00:00.000Z"],
    ["yesterday", "2026-04-05", "2026-04-05", "2026-04-04T11:00:00.000Z", "2026-04-05T12:00:00.000Z"],
  ] as const)("creates DST-safe %s intervals", (preset, from, to, start, end) => {
    const now = preset === "today" ? new Date("2026-09-26T14:30:00.000Z") : new Date("2026-04-05T23:30:00.000Z");
    expect(analyticsDateRange({ preset, now })).toMatchObject({ from, to, start: new Date(start), end: new Date(end) });
  });

  it("uses inclusive UI dates and an exclusive UTC end for a one-day custom range", () => {
    expect(analyticsDateRange({ preset: "custom", from: "2026-09-27", to: "2026-09-27" })).toEqual({
      from: "2026-09-27", to: "2026-09-27",
      start: new Date("2026-09-26T12:00:00.000Z"), end: new Date("2026-09-27T11:00:00.000Z"),
    });
  });

  it.each([
    ["this_month", "2026-02-01", "2026-02-16"],
    ["last_month", "2026-01-01", "2026-01-31"],
    ["this_year", "2026-01-01", "2026-02-16"],
  ] as const)("resolves %s at month and year boundaries", (preset, from, to) => {
    expect(analyticsDateRange({ preset, now: new Date("2026-02-15T12:00:00.000Z") })).toMatchObject({ from, to });
  });

  it.each([
    ["last_month", new Date("2026-01-15T12:00:00.000Z"), "2025-12-01", "2025-12-31"],
    ["this_month", new Date("2026-12-15T12:00:00.000Z"), "2026-12-01", "2026-12-16"],
  ] as const)("handles %s across a calendar year boundary", (preset, now, from, to) => {
    expect(analyticsDateRange({ preset, now })).toMatchObject({ from, to });
  });

  it.each([
    [{ preset: "custom", from: "2026-02-30", to: "2026-03-01" }],
    [{ preset: "custom", from: "2026-03-02", to: "2026-03-01" }],
    [{ preset: "custom", from: "2025-01-01", to: "2026-05-02", maximumDays: 365 }],
  ] as const)("rejects invalid, reversed, and overlong ranges", (input) => {
    expect(() => analyticsDateRange(input)).toThrow("analytics_date_range_invalid");
  });

  it("calculates a previous period with exactly the current inclusive day count", () => {
    const range = analyticsDateRange({ preset: "custom", from: "2026-03-01", to: "2026-03-07" });
    expect(previousAnalyticsDateRange(range)).toMatchObject({ from: "2026-02-22", to: "2026-02-28" });
  });

  it.each([[45, "day"], [46, "week"], [180, "week"], [181, "month"]] as const)("uses %s-day auto granularity as %s", (days, expected) => {
    expect(analyticsGranularity("auto", days)).toBe(expected);
  });

  it.each([
    ["last_7_days", "2026-08-24", "2026-08-30"],
    ["last_30_days", "2026-08-01", "2026-08-30"],
  ] as const)("resolves the %s preset", (preset, from, to) => {
    expect(analyticsDateRange({ preset, now: new Date("2026-08-29T12:30:00.000Z") })).toMatchObject({ from, to });
  });

  it("allows a bounded multi-year All Time range and rejects a range past its 100-year default cap", () => {
    expect(analyticsDateRange({
      preset: "all_time", allTimeFrom: "2024-01-01", now: new Date("2026-08-29T12:30:00.000Z"),
    })).toMatchObject({ from: "2024-01-01", to: "2026-08-30" });
    expect(() => analyticsDateRange({
      preset: "all_time", allTimeFrom: "1900-01-01", now: new Date("2026-08-29T12:30:00.000Z"),
    })).toThrow("analytics_date_range_invalid");
  });
});
