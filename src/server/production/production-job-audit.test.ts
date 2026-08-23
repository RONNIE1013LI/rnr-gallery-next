import { describe, expect, it } from "vitest";

import { productionJobAuditChanges } from "./production-job-audit";

describe("production job audit changes", () => {
  it("records only actual operational changes with safe before and after values", () => {
    expect(productionJobAuditChanges({
      customerName: "Private customer",
      internalNotes: "Private old note",
      urgent: false,
      manualStatus: "designing",
      deliveredAt: null,
      amountPaidCents: 5_000,
    }, {
      customerName: "Different private customer",
      internalNotes: "Private new note",
      urgent: false,
      manualStatus: "on_hold",
      deliveredAt: new Date("2026-08-23T00:00:00.000Z"),
      amountPaidCents: 7_500,
    })).toEqual([
      { field: "customerName" },
      { field: "internalNotes" },
      { field: "manualStatus", before: "designing", after: "on hold" },
      { field: "deliveredAt", before: "NO", after: "YES" },
      { field: "amountPaidCents", before: "$50.00", after: "$75.00" },
    ]);
  });

  it("does not claim unchanged fields or unchanged items changed", () => {
    const items = [{ productTitle: "Canvas", sizeLabel: "A2", quantity: 1, designText: "", notes: "" }];
    expect(productionJobAuditChanges(
      { customerSource: "email", neededDate: "2026-08-30" },
      { customerSource: "email", neededDate: "2026-08-30" },
      items,
      items,
    )).toEqual([]);
  });

  it("reports product changes without putting customer artwork text into the audit", () => {
    expect(productionJobAuditChanges(
      {},
      {},
      [{ productTitle: "Canvas", sizeLabel: "A2", quantity: 1, designText: "private old", notes: "" }],
      [{ productTitle: "Canvas", sizeLabel: "A1", quantity: 1, designText: "private new", notes: "" }],
    )).toEqual([{ field: "items" }]);
  });
});
