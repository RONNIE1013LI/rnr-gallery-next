import { describe, expect, it } from "vitest";
import {
  buildProductionReport,
  createProductionCsv,
  type ProductionOperationsJob,
} from "./production-operations-service";

function job(overrides: Partial<ProductionOperationsJob>): ProductionOperationsJob {
  return {
    id: "job-1", jobNumber: "RNR-1", source: "manual", orderNumber: null,
    customerName: "Customer", customerEmail: "customer@example.com", customerPhone: "021",
    status: "designing", paymentStatus: "processing", urgent: false, neededDate: "2026-08-06",
    deliveryMethod: "post", assignedUserId: "staff-1", assignedUserName: "Artist",
    productTitles: ["Canvas"], sizeLabels: ["A2"],
    finance: { amountPayableCents: 10000, amountPaidCents: 4000, amountOwingCents: 6000, artistFeeCents: 1000, materialCostCents: 500, actualProfitCents: 2500 },
    createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-02T00:00:00Z"),
    ...overrides,
  };
}

describe("production operations", () => {
  it("derives overdue, due-soon, urgent, unassigned and workload attention without notifications", () => {
    const report = buildProductionReport([
      job({ id: "late", jobNumber: "RNR-LATE", neededDate: "2026-08-03", urgent: true, assignedUserId: null, assignedUserName: null }),
      job({ id: "soon", jobNumber: "RNR-SOON", neededDate: "2026-08-06" }),
      job({ id: "done", jobNumber: "RNR-DONE", neededDate: "2026-08-01", status: "completed" }),
    ], new Date("2026-08-04T12:00:00+12:00"), { canViewFinance: false });
    expect(report.metrics).toMatchObject({ total: 3, active: 2, overdue: 1, dueSoon: 1, urgent: 1, unassigned: 1 });
    expect(report.workload).toEqual([{ assignedUserId: "staff-1", assignedUserName: "Artist", activeJobs: 1 }]);
    expect(report.finance).toBeNull();
    expect(report.attention.map((item) => item.jobNumber)).toEqual(["RNR-LATE", "RNR-SOON"]);
  });

  it("shows finance only when permitted", () => {
    const report = buildProductionReport([job({})], new Date("2026-08-04T00:00:00Z"), { canViewFinance: true });
    expect(report.finance).toEqual({ payableCents: 10000, paidCents: 4000, refundedCents: 0, netCollectedCents: 4000, owingCents: 6000, artistFeeCents: 1000, materialCostCents: 500, actualProfitCents: 2500 });
  });

  it("separates refunds from gross paid and never reports terminal orders as owing", () => {
    const report = buildProductionReport([
      job({ id: "paid", paymentStatus: "paid", finance: { amountPayableCents: 10000, amountPaidCents: 10000, amountOwingCents: 0, artistFeeCents: 1000, materialCostCents: 500, actualProfitCents: 8500 } }),
      job({ id: "refunded", paymentStatus: "refunded", finance: { amountPayableCents: 8000, amountPaidCents: 8000, amountOwingCents: 0, artistFeeCents: 800, materialCostCents: 400, actualProfitCents: 6800 } }),
      job({ id: "cancelled", paymentStatus: "cancelled", finance: { amountPayableCents: 6000, amountPaidCents: 0, amountOwingCents: 6000, artistFeeCents: 0, materialCostCents: 0, actualProfitCents: 0 } }),
    ], new Date("2026-08-04T00:00:00Z"), { canViewFinance: true });

    expect(report.finance).toEqual({
      payableCents: 24000,
      paidCents: 18000,
      refundedCents: 8000,
      netCollectedCents: 10000,
      owingCents: 0,
      artistFeeCents: 1800,
      materialCostCents: 900,
      actualProfitCents: 7300,
    });
  });

  it("escapes spreadsheet formulas and quotes in CSV exports", () => {
    const csv = createProductionCsv([job({ customerName: "=HYPERLINK(\"bad\")", customerEmail: " +SUM(1,1)" })]);
    expect(csv).toContain("\"'=HYPERLINK(\"\"bad\"\")\"");
    expect(csv).toContain("\"' +SUM(1,1)\"");
    expect(csv.split("\n")).toHaveLength(2);
  });
});
