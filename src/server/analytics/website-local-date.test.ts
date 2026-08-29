import { describe, expect, it } from "vitest";

import { websiteAnalyticsLocalDate } from "./website-local-date";

describe("website analytics local date", () => {
  it("uses Pacific/Auckland rather than UTC", () => {
    expect(websiteAnalyticsLocalDate(new Date("2026-08-29T12:30:00.000Z")))
      .toBe("2026-08-30");
  });

  it("remains correct across daylight-saving transitions", () => {
    expect(websiteAnalyticsLocalDate(new Date("2026-09-26T13:59:59.000Z")))
      .toBe("2026-09-27");
    expect(websiteAnalyticsLocalDate(new Date("2026-09-26T14:00:00.000Z")))
      .toBe("2026-09-27");
  });
});
