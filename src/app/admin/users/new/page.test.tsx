import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewAdminEmployeePage from "./page";

const { requireAdminPage } = vi.hoisted(() => ({ requireAdminPage: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/components/admin/employee-create-form", () => ({ EmployeeCreateForm: () => <div>Employee create form</div> }));

describe("new employee page", () => {
  it("requires administrator role management before rendering", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" } });
    render(await NewAdminEmployeePage());

    expect(requireAdminPage).toHaveBeenCalledWith("/admin/users/new", "manage_roles");
    expect(screen.getByRole("heading", { name: "Add employee" })).toBeInTheDocument();
  });
});
