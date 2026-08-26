import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formOrderRow } from "@/components/forms/forms-test-data";
import { normalizeStaffAccessProfile } from "@/server/auth/staff-access-profile";
import { buildFormAccessProfile } from "@/server/forms/forms-permissions";
import { FormsDataListContent } from "./page";

const { requireFormsPage, listFormOrders, getDatabase, listFields, productRegistry, listAssignees, listSavedViews } = vi.hoisted(() => ({
  requireFormsPage: vi.fn(),
  listFormOrders: vi.fn(),
  getDatabase: vi.fn(() => ({ kind: "database" })),
  listFields: vi.fn(),
  productRegistry: vi.fn(),
  listAssignees: vi.fn(),
  listSavedViews: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("@/server/forms/drizzle-forms-workbench-repository", () => ({ listFormOrders }));
vi.mock("@/server/db/client", () => ({ getDatabase }));
vi.mock("@/server/admin/admin-production-field-runtime", () => ({ getAdminProductionFieldRuntime: () => ({ list: listFields }) }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getSafePublicProductRegistry: productRegistry }));
vi.mock("@/domain/catalogue/product-registry", () => ({ getRegistryProducts: () => [{ active: true, title: "Canvas" }, { active: false, title: "Hidden" }] }));
vi.mock("@/server/production/drizzle-production-job-repository", () => ({ listProductionAssignees: listAssignees }));
vi.mock("@/server/forms/forms-saved-view-runtime", () => ({
  getFormsSavedViewRuntime: () => ({ list: listSavedViews }),
}));

describe("forms data list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFields.mockResolvedValue([]);
    productRegistry.mockResolvedValue({ registry: {} });
    listAssignees.mockResolvedValue([{ id: "artist-1", name: "Artist", email: "artist@example.test", role: "staff" }]);
    listSavedViews.mockResolvedValue([]);
  });

  it("loads the protected source-parity workbench with field-level access", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-1", email: "operator@example.test" },
      formRole: "form_staff",
      formProfile: buildFormAccessProfile("finance"),
    });
    listFormOrders.mockResolvedValue({
      items: [formOrderRow], total: 1, page: 1, pageSize: 20, pageCount: 1,
    });

    render(await FormsDataListContent({ raw: { q: "07188" } }));

    expect(requireFormsPage).toHaveBeenCalledWith("/order-system?q=07188", "view_jobs");
    expect(listFormOrders).toHaveBeenCalledWith(
      { kind: "database" },
      expect.objectContaining({ query: "07188" }),
      expect.objectContaining({
        actorUserId: "operator-1",
        assignedOnly: false,
        canViewCustomerContact: true,
        canViewFinance: true,
        canViewPaymentProof: true,
      }),
    );
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("scopes custom Staff listing to assigned jobs", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "staff-1", email: "staff@example.test" },
      formRole: "staff",
      formProfile: normalizeStaffAccessProfile({
        adminPermissions: [],
        formPermissions: { view_jobs: true },
        assignedOnly: true,
      }),
    });
    listFormOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });

    await FormsDataListContent({ raw: {} });

    expect(listFormOrders).toHaveBeenCalledWith(
      { kind: "database" },
      expect.anything(),
      expect.objectContaining({ actorUserId: "staff-1", assignedOnly: true }),
    );
  });

  it("preserves repeated operational filters in the sign-in return path", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-2", email: "readonly@example.test" },
      formRole: "form_staff",
      formProfile: buildFormAccessProfile("readOnly"),
    });
    listFormOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
    await FormsDataListContent({
      raw: {
        match: "or",
        filter: ["urgent~equals~true", "status~equals~designing"],
      },
    });
    expect(requireFormsPage).toHaveBeenCalledWith(
      "/order-system?match=or&filter=urgent%7Eequals%7Etrue&filter=status%7Eequals%7Edesigning",
      "view_jobs",
    );
  });

  it("loads manual-entry data only for an authorised drawer request", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-3", email: "entry@example.test" },
      formRole: "form_staff",
      formProfile: buildFormAccessProfile("manager"),
    });
    listFormOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
    listFields.mockResolvedValue([{ id: "field-1", label: "Source", fieldType: "text", options: [], required: false, enabled: true, showOnCreate: true, legacyOnly: false, section: "order" }]);

    await FormsDataListContent({ raw: { q: "07188", entry: "new" } });

    expect(requireFormsPage).toHaveBeenCalledWith("/order-system?q=07188&entry=new", "view_jobs");
    expect(productRegistry).toHaveBeenCalledOnce();
    expect(listFields).toHaveBeenCalledOnce();
    expect(listAssignees).toHaveBeenCalledOnce();
  });

  it("loads filter metadata but not manual-entry product data when create permission is absent", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-4", email: "viewer@example.test" },
      formRole: "form_staff",
      formProfile: buildFormAccessProfile("readOnly"),
    });
    listFormOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });

    await FormsDataListContent({ raw: { entry: "new" } });

    expect(productRegistry).not.toHaveBeenCalled();
    expect(listFields).toHaveBeenCalledOnce();
    expect(listAssignees).toHaveBeenCalledOnce();
  });
});
