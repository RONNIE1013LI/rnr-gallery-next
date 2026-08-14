import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formOrderRow } from "@/components/forms/forms-test-data";
import FormsDataListPage from "./page";

const { requireFormsPage, listFormOrders, getDatabase } = vi.hoisted(() => ({
  requireFormsPage: vi.fn(),
  listFormOrders: vi.fn(),
  getDatabase: vi.fn(() => ({ kind: "database" })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/forms/require-forms-page", () => ({ requireFormsPage }));
vi.mock("@/server/forms/drizzle-forms-workbench-repository", () => ({ listFormOrders }));
vi.mock("@/server/db/client", () => ({ getDatabase }));

describe("forms data list page", () => {
  it("loads the protected source-parity workbench with field-level access", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-1", email: "operator@example.test" },
      formRole: "form_staff",
      formProfile: {
        preset: "finance",
        assignedOnly: false,
        permissions: {
          view_jobs: true,
          view_finance: true,
          view_customer_contact: true,
          export_jobs: true,
        },
      },
    });
    listFormOrders.mockResolvedValue({
      items: [formOrderRow], total: 1, page: 1, pageSize: 20, pageCount: 1,
    });

    render(await FormsDataListPage({ searchParams: Promise.resolve({ q: "07188" }) }));

    expect(requireFormsPage).toHaveBeenCalledWith("/order-system?q=07188", "view_jobs");
    expect(listFormOrders).toHaveBeenCalledWith(
      { kind: "database" },
      expect.objectContaining({ query: "07188" }),
      expect.objectContaining({
        actorUserId: "operator-1",
        assignedOnly: false,
        canViewCustomerContact: true,
        canViewFinance: true,
      }),
    );
    expect(screen.getByRole("table", { name: "Orders data list" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("preserves repeated operational filters in the sign-in return path", async () => {
    requireFormsPage.mockResolvedValue({
      user: { id: "operator-2", email: "readonly@example.test" },
      formRole: "form_staff",
      formProfile: { preset: "readOnly", assignedOnly: false, permissions: { view_jobs: true } },
    });
    listFormOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
    await FormsDataListPage({
      searchParams: Promise.resolve({
        match: "or",
        filter: ["urgent~equals~true", "status~equals~designing"],
      }),
    });
    expect(requireFormsPage).toHaveBeenCalledWith(
      "/order-system?match=or&filter=urgent%7Eequals%7Etrue&filter=status%7Eequals%7Edesigning",
      "view_jobs",
    );
  });
});
