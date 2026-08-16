import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewProductionJobPage from "./page";

const { requireAdminPage, assignees } = vi.hoisted(() => ({ requireAdminPage: vi.fn(), assignees: vi.fn() }));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-production-runtime", () => ({ getAdminProductionRuntime: () => ({ assignees }) }));
vi.mock("@/server/admin/admin-production-field-runtime", () => ({ getAdminProductionFieldRuntime: () => ({ list: vi.fn().mockResolvedValue([]) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("new production job page", () => {
  it("gives staff the manual intake form without restricted finance fields", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" });
    assignees.mockResolvedValue([]);
    render(await NewProductionJobPage());
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/jobs/new", "create_manual_jobs");
    expect(screen.getByRole("heading", { name: "New manual job" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Payment" })).not.toBeInTheDocument();
  });
});
