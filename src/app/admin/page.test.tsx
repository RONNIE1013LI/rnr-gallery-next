import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminDashboardPage from "./page";

const { requireAdminPage, summary } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  summary: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-dashboard-runtime", () => ({
  getAdminDashboardRuntime: () => ({ summary }),
}));

describe("admin dashboard", () => {
  it("shows real operational counts and recent orders", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    summary.mockResolvedValue({
      metrics: { totalOrders: 12, todayOrders: 2, openOrders: 7, urgentOrders: 2, awaitingPayment: 3, paidAwaitingFulfilment: 4, designing: 2, awaitingCustomer: 1, readyToPrint: 1, shipped: 3, refundOrException: 0, paidRevenueInclGstCents: 987600 },
      recentOrders: [{ id: "order-1", orderNumber: "RNR-2026-TEST", customerEmail: "customer@example.test", totalInclGstCents: 23000, paymentStatus: "paid", fulfilmentStatus: "designing", createdAt: new Date("2026-08-04T01:00:00Z") }],
      attentionOrders: [],
      catalogue: { productCount: 9, activeGalleryDesigns: 32, customerCount: 6, publishedProducts: 8, featuredProducts: 3 },
      deliveryTimes: { production: "5 business days", nz: "NZ 2–3 business days", au: "AU about 5 business days" },
      paymentProviders: [{ label: "Card", enabled: true, environment: "production" }],
      shippingProvider: { label: "GoSweetSpot", enabled: true, environment: "production" },
    });

    render(await AdminDashboardPage());

    expect(requireAdminPage).toHaveBeenCalledWith("/admin", "access_admin");
    expect(screen.getByRole("heading", { name: "Operations overview" })).toBeInTheDocument();
    expect(screen.getByText("RNR-2026-TEST")).toBeInTheDocument();
    expect(screen.getByText("GoSweetSpot")).toBeInTheDocument();
    expect(screen.getByText("$9,876.00")).toBeInTheDocument();
  });
});
