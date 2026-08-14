import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminCustomersPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-customer-runtime", () => ({ getAdminCustomerRuntime: () => ({ list }) }));

describe("admin customers page", () => {
  it("shows real customer order summaries", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" });
    list.mockResolvedValue({
      items: [{ key: "customer-1", accountId: "customer-1", name: "Test Customer", email: "test@example.test", registered: true, emailVerified: true, orderCount: 3, paidSpentInclGstCents: 69000, lastOrderAt: new Date("2026-08-04T01:00:00Z") }],
      total: 1, page: 1, pageSize: 30, pageCount: 1,
    });
    render(await AdminCustomersPage({ searchParams: Promise.resolve({}) }));
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/customers", "view_customers");
    expect(screen.getByText("Test Customer")).toBeInTheDocument();
    expect(screen.getByText("$690.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Test Customer" })).toHaveAttribute("href", "/admin/customers/customer-1");
  });
});
