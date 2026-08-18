import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductionReportPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-production-runtime", () => ({ getAdminProductionRuntime: () => ({ list }) }));

describe("production operations report page", () => {
  it("shows attention and workload without finance for staff", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff", adminPermissions: ["view_production_reports"] });
    list.mockResolvedValue({ items: [{
      id: "job-1", jobNumber: "RNR-1", source: "manual", orderNumber: null,
      customerName: "Customer", customerEmail: "customer@example.com", customerPhone: "021",
      status: "designing", paymentStatus: "paid", urgent: true, neededDate: "2026-08-03",
      deliveryMethod: "post", assignedUserId: null, assignedUserName: null,
      productTitles: ["Canvas"], sizeLabels: ["A2"], finance: null,
      createdAt: new Date(), updatedAt: new Date(),
    }], total: 1, page: 1, pageSize: 5000, pageCount: 1 });
    render(await ProductionReportPage());
    expect(screen.getByRole("heading", { name: "Production report" })).toBeInTheDocument();
    expect(screen.getByText("RNR-1")).toBeInTheDocument();
    expect(screen.queryByText("Amount owing")).not.toBeInTheDocument();
  });
});
