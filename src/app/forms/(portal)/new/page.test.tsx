import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NewFormsJobPage from "./page";

const { requireFormsPage, assignees, listFields } = vi.hoisted(() => ({
  requireFormsPage: vi.fn(),
  assignees: vi.fn().mockResolvedValue([{ id: "artist-1", name: "Artist", email: "artist@example.test" }]),
  listFields: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("@/server/admin/admin-production-runtime", () => ({ getAdminProductionRuntime: () => ({ assignees }) }));
vi.mock("@/server/admin/admin-production-field-runtime", () => ({ getAdminProductionFieldRuntime: () => ({ list: listFields }) }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getSafePublicProductRegistry: vi.fn().mockResolvedValue({ registry: {} }) }));
vi.mock("@/domain/catalogue/product-registry", () => ({ getRegistryProducts: () => [{ active: true, title: "Canvas" }] }));

describe("forms manual entry page", () => {
  it("gates manual entry and renders the complete mature production form", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-1", name: "Ronnie Li", email: "operator@example.test" },
      formRole: "form_staff",
      formProfile: { preset: "manager", assignedOnly: false, permissions: { create_jobs: true, update_finance: false } },
    });
    render(await NewFormsJobPage());
    expect(requireFormsPage).toHaveBeenCalledWith("/order-system/new", "create_jobs");
    expect(screen.getByRole("heading", { name: "Order entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cust.Name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Product")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Web order number")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Payment" })).not.toBeInTheDocument();
    expect(screen.getByText("Ronnie Li")).toBeInTheDocument();
    expect(screen.queryByText("operator@example.test")).not.toBeInTheDocument();
  });
});
