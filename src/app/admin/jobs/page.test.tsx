import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import styles from "@/components/admin/admin.module.css";
import AdminProductionJobsPage from "./page";

const { requireAdminPage, list, assignees } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  list: vi.fn(),
  assignees: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-production-runtime", () => ({
  getAdminProductionRuntime: () => ({ list, assignees }),
}));
vi.mock("@/server/admin/admin-production-saved-view-runtime", () => ({
  getAdminProductionSavedViewRuntime: () => ({ list: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("admin production jobs page", () => {
  it("shows linked and manual work in one operational queue with admin finance", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin", adminPermissions: [] });
    assignees.mockResolvedValue([{ id: "staff-1", name: "Artist", email: "artist@example.test", role: "staff" }]);
    list.mockResolvedValue({
      items: [{
        id: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        jobNumber: "RNR-2026-ABC123",
        orderId: "73f77c27-fd7b-4c65-a834-886c128b6cc2",
        orderNumber: "RNR-2026-ABC123",
        source: "web",
        customerName: "Example Customer",
        customerEmail: "customer@example.test",
        customerPhone: "0210000000",
        customerSource: "web",
        urgent: true,
        neededDate: "2026-08-11",
        deliveryMethod: "post",
        assignedUserId: "staff-1",
        assignedUserName: "Artist",
        status: "designing",
        paymentStatus: "paid",
        productTitles: ["Digital Oil Painting Canvas"],
        sizeLabels: ["A0"],
        finance: { amountPayableCents: 34500, amountPaidCents: 34500, amountOwingCents: 0, artistFeeCents: null, materialCostCents: null, actualProfitCents: null },
        createdAt: new Date("2026-08-04T02:00:00Z"),
        updatedAt: new Date("2026-08-04T03:00:00Z"),
      }],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });

    render(await AdminProductionJobsPage({ searchParams: Promise.resolve({ q: "ABC123" }) }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/jobs?q=ABC123", "view_production_jobs");
    expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByText("1 job")).toBeInTheDocument();
    for (const name of ["Operations report", "Form fields", "Export CSV"]) {
      expect(screen.getByRole("link", { name })).toHaveClass(styles.productionHeaderLink);
    }
    expect(screen.getByRole("link", { name: "New manual job" })).toHaveAttribute("href", "/admin/jobs/new");
    expect(screen.getByText("Digital Oil Painting Canvas")).toBeInTheDocument();
    expect(screen.getByText("$345.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RNR-2026-ABC123" })).toHaveAttribute(
      "href",
      "/admin/jobs/63f77c27-fd7b-4c65-a834-886c128b6cc1",
    );
  });

  it("does not render finance values returned as redacted for staff", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff", adminPermissions: ["view_production_jobs"] });
    assignees.mockResolvedValue([]);
    list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 });
    render(await AdminProductionJobsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("No production jobs match these filters.")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.any(Object), { canViewFinance: false });
  });
});
