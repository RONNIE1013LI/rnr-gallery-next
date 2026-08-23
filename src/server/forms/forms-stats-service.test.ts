import { describe, expect, it } from "vitest";

import {
  FormStatsValidationError,
  parseFormStatRequest,
  parseFormStatsLayout,
  parseFormStatsWidget,
} from "./forms-stats-service";

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

  it("accepts a dated custom statistics query", () => {
    expect(parseFormStatRequest({
      dimension: "submitted_at",
      timeUnit: "week",
      measure: "amount_payable",
      aggregation: "sum",
      sort: "default",
    })).toEqual(expect.objectContaining({ dimension: "submitted_at", timeUnit: "week" }));
  });

  it("rejects unsupported and unauthorised custom query combinations", () => {
    expect(() => parseFormStatRequest({
      dimension: "customer_email",
      measure: "order_count",
      aggregation: "count",
      sort: "default",
    })).toThrow(FormStatsValidationError);
    expect(() => parseFormStatRequest({
      dimension: "delivery_method",
      timeUnit: "month",
      measure: "order_count",
      aggregation: "count",
      sort: "default",
    })).toThrow(FormStatsValidationError);
    expect(() => parseFormStatRequest({
      measure: "amount_paid",
      aggregation: "sum",
      sort: "default",
    }, { canViewFinance: false })).toThrow(FormStatsValidationError);
  });

  it("requires dimensions for chart and table widgets", () => {
    for (const type of ["bar", "pie", "line", "table"] as const) {
      expect(() => parseFormStatsWidget({
        id: `missing-${type}`,
        type,
        title: "Orders",
        query: { measure: "order_count", aggregation: "count", sort: "default" },
      })).toThrow(FormStatsValidationError);
    }
  });

  it("rejects dimensions on number widgets", () => {
    expect(() => parseFormStatsWidget({
      id: "number-with-dimension",
      type: "number",
      title: "Orders",
      query: {
        dimension: "status",
        measure: "order_count",
        aggregation: "count",
        sort: "default",
      },
    })).toThrow(FormStatsValidationError);
  });

  it("requires nonblank text and unique widget IDs", () => {
    expect(() => parseFormStatsWidget({ id: "note", type: "text", title: "Note", text: "  " }))
      .toThrow(FormStatsValidationError);
    expect(() => parseFormStatsLayout({
      name: "Duplicate IDs",
      widgets: [
        { id: "same", type: "number", metric: "job_count", title: "Orders" },
        { id: "same", type: "number", metric: "job_count", title: "Orders" },
      ],
    })).toThrow(FormStatsValidationError);
  });

  it("keeps the existing fixed-metric widget valid", () => {
    expect(parseFormStatsWidget({
      id: "legacy",
      type: "number",
      metric: "job_count",
      title: "Orders",
    })).toEqual(expect.objectContaining({ metric: "job_count" }));
  });
});
