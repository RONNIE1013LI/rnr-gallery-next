import { describe, expect, it } from "vitest";

import { FormStatsValidationError, parseFormStatsLayout, parseFormStatsWidget } from "./forms-stats-service";

describe("forms stats validation", () => {
  it("accepts bounded widgets from the explicit metric registry", () => {
    expect(parseFormStatsLayout({
      name: "Daily",
      widgets: [{ id: "w1", type: "number", metric: "job_count", title: "Orders" }],
    }).widgets).toHaveLength(1);
  });

  it("rejects executable metrics, finance leaks and oversized layouts", () => {
    expect(() => parseFormStatsLayout({
      name: "Unsafe",
      widgets: [{ id: "w1", type: "number", metric: "select * from user", title: "Leak" }],
    })).toThrow(FormStatsValidationError);
    expect(() => parseFormStatsWidget(
      { id: "w2", type: "number", metric: "amount_paid_total", title: "Paid" },
      { canViewFinance: false },
    )).toThrow(FormStatsValidationError);
    expect(() => parseFormStatsLayout({
      name: "Too many",
      widgets: Array.from({ length: 25 }, (_, index) => ({ id: `w${index}`, type: "number", metric: "job_count", title: "Orders" })),
    })).toThrow(FormStatsValidationError);
  });
});
