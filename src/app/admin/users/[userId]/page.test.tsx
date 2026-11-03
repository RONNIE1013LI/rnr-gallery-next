import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminEmployeeDetailPage from "./page";

const { requireAdminPage, getById, getUserShoppingHistory } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), getById: vi.fn(), getUserShoppingHistory: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-user-runtime", () => ({ getAdminUserRuntime: () => ({ getById }) }));
vi.mock("@/components/admin/employee-access-form", () => ({ EmployeeAccessForm: () => <div>Employee access form</div> }));

vi.mock("@/server/analytics/user-shopping-history", () => ({ getUserShoppingHistory }));

describe("employee detail page", () => {
  beforeEach(() => { vi.clearAllMocks(); getUserShoppingHistory.mockResolvedValue({ status: "available", events: [], hasMore: false }); });
  it("loads linked history only with all customer, analytics and order permissions", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin", adminPermissions: [] });
    getById.mockResolvedValue({ id: "customer-1", name: "Customer", role: "customer" });
    render(await AdminEmployeeDetailPage({ params: Promise.resolve({ userId: "customer-1" }) }));
    expect(getUserShoppingHistory).toHaveBeenCalledWith("customer-1");
    expect(screen.getByRole("heading", { name: "Browsing & shopping history" })).toBeInTheDocument();
  });
  it.each(["view_customers", "view_analytics", "view_orders"])("does not load or expose history without %s", async missing => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff",
      adminPermissions: ["manage_roles", "view_customers", "view_analytics", "view_orders"].filter(p => p !== missing) });
    getById.mockResolvedValue({ id: "customer-1", name: "Customer", role: "customer" });
    render(await AdminEmployeeDetailPage({ params: Promise.resolve({ userId: "customer-1" }) }));
    expect(getUserShoppingHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Browsing & shopping history" })).not.toBeInTheDocument();
  });
  it("requires administrator role management and loads the selected account", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    getById.mockResolvedValue({ id: "employee-1", name: "Studio Employee", email: "studio@example.test", role: "staff" });
    render(await AdminEmployeeDetailPage({ params: Promise.resolve({ userId: "employee-1" }) }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/users/employee-1", "manage_roles", { readOnly: true });
    expect(getById).toHaveBeenCalledWith("employee-1");
    expect(screen.getByRole("heading", { name: "Studio Employee" })).toBeInTheDocument();
  });
});
