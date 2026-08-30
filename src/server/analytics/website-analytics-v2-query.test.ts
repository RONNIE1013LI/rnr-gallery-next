import { describe, expect, it } from "vitest";
import {
  parseWebsiteAnalyticsV2Query,
  WebsiteAnalyticsV2QueryError,
} from "./website-analytics-v2-query";

const now = new Date("2026-08-30T00:00:00.000Z");

function parse(query = "", options: Readonly<{ allTimeFrom?: string }> = {}) {
  return parseWebsiteAnalyticsV2Query(new URLSearchParams(query), { now, ...options });
}

describe("website analytics V2 query", () => {
  it("defaults to a canonical Auckland Last 30 Days website query", () => {
    expect(parse()).toEqual({
      preset: "last_30_days",
      from: "2026-08-01",
      to: "2026-08-30",
      start: new Date("2026-07-31T12:00:00.000Z"),
      end: new Date("2026-08-30T12:00:00.000Z"),
      scope: "website",
      market: null,
      currency: null,
      attribution: "last_touch",
      granularity: "auto",
      resolvedGranularity: "day",
      compare: false,
      includeInternal: false,
      sort: "occurred_at_desc",
      page: 1,
      pageSize: 25,
      canonicalQuery: "preset=last_30_days&from=2026-08-01&to=2026-08-30&scope=website&market=all&currency=all&attribution=last_touch&granularity=auto&compare=false&includeInternal=false&sort=occurred_at_desc&page=1&pageSize=25",
    });
  });

  it.each([
    ["today", "2026-08-30", "2026-08-30"],
    ["yesterday", "2026-08-29", "2026-08-29"],
    ["last_7_days", "2026-08-24", "2026-08-30"],
    ["last_30_days", "2026-08-01", "2026-08-30"],
    ["this_month", "2026-08-01", "2026-08-30"],
    ["last_month", "2026-07-01", "2026-07-31"],
    ["this_year", "2026-01-01", "2026-08-30"],
  ] as const)("resolves the %s preset", (preset, from, to) => {
    expect(parse(`preset=${preset}`)).toMatchObject({ preset, from, to });
  });

  it("supports bounded custom and explicit all-time ranges", () => {
    expect(parse("preset=custom&from=2024-02-29&to=2024-02-29"))
      .toMatchObject({ from: "2024-02-29", to: "2024-02-29" });
    expect(parse("preset=custom&from=2024-01-01&to=2024-12-31"))
      .toMatchObject({ from: "2024-01-01", to: "2024-12-31" });
    expect(parse("preset=all_time", { allTimeFrom: "2001-03-04" }))
      .toMatchObject({ from: "2001-03-04", to: "2026-08-30" });
  });

  it("canonicalizes every allow-listed filter and drill-down field", () => {
    const result = parse([
      "preset=custom",
      "from=2026-01-01",
      "to=2026-06-30",
      "scope=all_business",
      "market=AU",
      "currency=AUD",
      "attribution=first_touch",
      "granularity=week",
      "compare=true",
      "includeInternal=true",
      "sort=ordered_amount_asc",
      "page=17",
      "pageSize=100",
    ].join("&"));
    expect(result).toMatchObject({
      scope: "all_business",
      market: "AU",
      currency: "AUD",
      attribution: "first_touch",
      granularity: "week",
      resolvedGranularity: "week",
      compare: true,
      includeInternal: true,
      sort: "ordered_amount_asc",
      page: 17,
      pageSize: 100,
    });
    expect(result.canonicalQuery).toContain("market=AU&currency=AUD");
  });

  it.each([
    ["scope=manual"],
    ["market=US"],
    ["currency=USD"],
    ["attribution=linear"],
    ["granularity=quarter"],
    ["compare=1"],
    ["includeInternal=1"],
    ["sort=customer_email"],
    ["page=0"],
    ["page=10001"],
    ["page=1.5"],
    ["pageSize=0"],
    ["pageSize=101"],
    ["market=NZ&currency=AUD"],
    ["preset=custom&from=2024-01-01&to=2025-01-01"],
    ["preset=custom&from=2026-08-31&to=2026-08-30"],
    ["preset=custom&from=2026-02-29&to=2026-03-01"],
    ["unknown=value"],
  ])("rejects unsafe query %s", (query) => {
    expect(() => parse(query)).toThrow(WebsiteAnalyticsV2QueryError);
  });

  it("rejects duplicate or array-valued fields instead of choosing one", () => {
    expect(() => parse("scope=website&scope=all_business"))
      .toThrow(WebsiteAnalyticsV2QueryError);
    expect(() => parseWebsiteAnalyticsV2Query({ scope: ["website", "all_business"] }, { now }))
      .toThrow(WebsiteAnalyticsV2QueryError);
  });

  it("uses Auto day/week/month thresholds from the shared Task 1 contract", () => {
    expect(parse("preset=custom&from=2026-07-17&to=2026-08-30").resolvedGranularity)
      .toBe("day");
    expect(parse("preset=custom&from=2026-07-16&to=2026-08-30").resolvedGranularity)
      .toBe("week");
    expect(parse("preset=custom&from=2026-03-04&to=2026-08-30").resolvedGranularity)
      .toBe("week");
    expect(parse("preset=custom&from=2026-03-03&to=2026-08-30").resolvedGranularity)
      .toBe("month");
  });
});
