import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { requireAdminPage, listAdmin } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(), listAdmin: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/payment-requests/payment-request-runtime", () => ({
  getPaymentRequestRuntime: () => ({ listAdmin }),
}));
import AdminPaymentRequestsPage from "./page";

describe("Admin payment requests page", () => {
  it("uses manage_payment and lists no private identity columns", async () => {
    listAdmin.mockResolvedValue([{
      id: "request-1", requestNumber: "PAY-2026-ABC", kind: "standalone",
      description: "Custom balance", amountCents: 20_000, currency: "NZD",
      status: "pending", methods: ["card"], customerName: "Private Name",
      customerEmail: "private@example.test", internalNote: "Private note",
      createdByName: "Ronnie Lee",
      createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z",
    }]);
    render(await AdminPaymentRequestsPage());
    expect(requireAdminPage).toHaveBeenCalledWith("/admin/payment-requests", "manage_payment");
    expect(screen.getByText("PAY-2026-ABC")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Created by" })).toBeInTheDocument();
    expect(screen.getByText("Ronnie Lee")).toBeInTheDocument();
    expect(screen.queryByText("Private Name")).not.toBeInTheDocument();
    expect(screen.queryByText("private@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("Private note")).not.toBeInTheDocument();
  });
});
