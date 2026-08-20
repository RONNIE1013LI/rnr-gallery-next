import { describe, expect, it } from "vitest";

import { formatRelativeReviewDate } from "./relative-date";

describe("formatRelativeReviewDate", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("returns deterministic accessible day, month, and year labels", () => {
    expect(formatRelativeReviewDate("2026-08-19", now)).toEqual({
      dateTime: "2026-08-19",
      label: "yesterday",
      title: "19 August 2026",
    });
    expect(formatRelativeReviewDate("2026-06-20", now)).toEqual({
      dateTime: "2026-06-20",
      label: "2 months ago",
      title: "20 June 2026",
    });
    expect(formatRelativeReviewDate("2024-08-20", now)).toEqual({
      dateTime: "2024-08-20",
      label: "2 years ago",
      title: "20 August 2024",
    });
  });

  it("rejects invalid calendar dates", () => {
    expect(() => formatRelativeReviewDate("2026-02-30", now))
      .toThrow("Invalid review date");
  });
});
