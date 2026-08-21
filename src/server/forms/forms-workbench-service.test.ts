import { describe, expect, it } from "vitest";

import {
  FormFilterValidationError,
  parseFormFilterGroup,
  parseFormWorkbenchQuery,
  visibleFormColumns,
} from "./forms-workbench-service";

describe("forms workbench query", () => {
  it("parses bounded paging, search, match and sort values", () => {
    expect(parseFormWorkbenchQuery({
      q: "  07188  ",
      page: "2",
      perPage: "100",
      match: "or",
      sort: "neededDate",
      direction: "asc",
    })).toMatchObject({
      query: "07188",
      page: 2,
      pageSize: 100,
      match: "or",
      sort: "neededDate",
      direction: "asc",
    });
  });

  it("falls back safely for invalid or excessive values", () => {
    expect(parseFormWorkbenchQuery({
      page: "-3",
      perPage: "5000",
      match: "xor",
      sort: "raw_sql",
      direction: "sideways",
    })).toEqual({
      query: "",
      page: 1,
      pageSize: 100,
      match: "and",
      sort: "submittedAt",
      direction: "desc",
      preset: "all",
      conditions: [],
    });
  });

  it("accepts only the source page sizes and known date presets", () => {
    expect(parseFormWorkbenchQuery({ perPage: "50", preset: "lastSixMonths" })).toMatchObject({
      pageSize: 50,
      preset: "lastSixMonths",
    });
    expect(parseFormWorkbenchQuery({ perPage: "30", preset: "future" })).toMatchObject({
      pageSize: 20,
      preset: "all",
    });
  });

  it("removes finance columns before rendering for unauthorised operators", () => {
    expect(visibleFormColumns({ canViewFinance: false }).map((column) => column.key)).not.toEqual(
      expect.arrayContaining(["bankRecon", "amountOwing", "amountPaid", "amountPayable", "artistFee"]),
    );
    expect(visibleFormColumns({ canViewFinance: true })).toHaveLength(24);
  });

  it("validates bounded AND/OR operational filters", () => {
    expect(parseFormFilterGroup({
      match: "or",
      conditions: [
        { field: "urgent", operator: "equals", value: "true" },
        { field: "neededDate", operator: "between", value: ["2026-08-01", "2026-08-31"] },
      ],
    })).toEqual({
      match: "or",
      conditions: [
        { field: "urgent", operator: "equals", value: "true" },
        { field: "neededDate", operator: "between", value: ["2026-08-01", "2026-08-31"] },
      ],
    });
    expect(() => parseFormFilterGroup({
      match: "and",
      conditions: [{ field: "raw_sql", operator: "equals", value: "1=1" }],
    })).toThrow(FormFilterValidationError);
  });

  it("accepts persisted manual-entry field families and configured custom fields", () => {
    const customFieldId = "00000000-0000-4000-8000-000000000091";
    expect(parseFormFilterGroup({
      match: "and",
      conditions: [
        { field: "submittedByUserId", operator: "equals", value: "staff-1" },
        { field: "customerName", operator: "contains", value: "Ana" },
        { field: "amountOwing", operator: "greaterThan", value: "100.00" },
        { field: "size", operator: "contains", value: "A1" },
        { field: "paymentProof", operator: "equals", value: "true" },
        { field: "completed", operator: "equals", value: "false" },
        { field: `custom:${customFieldId}`, operator: "contains", value: "gold" },
        { field: `custom:${customFieldId}`, operator: "between", value: ["10.00", "20.00"] },
      ],
    })).toMatchObject({
      conditions: [
        { field: "submittedByUserId", operator: "equals", value: "staff-1" },
        { field: "customerName", operator: "contains", value: "Ana" },
        { field: "amountOwing", operator: "greaterThan", value: "100.00" },
        { field: "size", operator: "contains", value: "A1" },
        { field: "paymentProof", operator: "equals", value: "true" },
        { field: "completed", operator: "equals", value: "false" },
        { field: `custom:${customFieldId}`, operator: "contains", value: "gold" },
        { field: `custom:${customFieldId}`, operator: "between", value: ["10.00", "20.00"] },
      ],
    });
    expect(() => parseFormFilterGroup({
      match: "and",
      conditions: [{ field: "custom:not-a-uuid", operator: "contains", value: "gold" }],
    })).toThrow(FormFilterValidationError);
  });

  it("parses at most twenty filters from shareable URL state", () => {
    const filters = Array.from({ length: 24 }, (_, index) =>
      index === 0 ? "urgent~equals~true" : "status~equals~new");
    expect(parseFormWorkbenchQuery({ filter: filters })).toMatchObject({
      conditions: [
        { field: "urgent", operator: "equals", value: "true" },
        ...Array.from({ length: 19 }, () => ({ field: "status", operator: "equals", value: "new" })),
      ],
    });
  });
});
