import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminEmployeeDetailPage from "./page";

const { requireAdminPage, getById } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), getById: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-user-runtime", () => ({ getAdminUserRuntime: () => ({ getById }) }));
vi.mock("@/components/admin/employee-access-form", () => ({ EmployeeAccessForm: () => <div>Employee access form</div> }));

describe("employee detail page", () => {
  it("requires administrator role management and loads the selected account", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    getById.mockResolvedValue({ id: "employee-1", name: "Studio Employee", email: "studio@example.test", role: "staff" });
    render(await AdminEmployeeDetailPage({ params: Promise.resolve({ userId: "employee-1" }) }));

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/users/employee-1", "manage_roles");
    expect(getById).toHaveBeenCalledWith("employee-1");
    expect(screen.getByRole("heading", { name: "Studio Employee" })).toBeInTheDocument();
  });
});
