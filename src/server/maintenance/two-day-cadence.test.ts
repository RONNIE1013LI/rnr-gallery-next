import { describe, expect, it } from "vitest";

import { shouldRunTwoDayMaintenance } from "./two-day-cadence";

describe("two-day maintenance cadence", () => {
  it("runs from the approved 2026-09-01 UTC anchor and then exactly every 48 hours", () => {
    expect(shouldRunTwoDayMaintenance(new Date("2026-09-01T00:00:00.000Z"))).toBe(true);
    expect(shouldRunTwoDayMaintenance(new Date("2026-09-02T23:59:59.999Z"))).toBe(false);
    expect(shouldRunTwoDayMaintenance(new Date("2026-09-03T04:00:00.000Z"))).toBe(true);
  });

  it.each([
    ["2026-01-31", "2026-02-01", "2026-02-02"],
    ["2027-12-31", "2028-01-01", "2028-01-02"],
    ["2028-02-28", "2028-02-29", "2028-03-01"],
  ])("never runs on consecutive UTC dates across %s", (first, second, third) => {
    const decisions = [first, second, third].map((date) => (
      shouldRunTwoDayMaintenance(new Date(`${date}T04:00:00.000Z`))
    ));

    expect(decisions[0] && decisions[1]).toBe(false);
    expect(decisions[1] && decisions[2]).toBe(false);
    expect(decisions.filter(Boolean)).toHaveLength(decisions[0] ? 2 : 1);
  });
});
