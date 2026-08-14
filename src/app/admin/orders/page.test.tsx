import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminOrdersPage from "./page";

const { requireAdminPage, list } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/admin/admin-order-runtime", () => ({
  getAdminOrderRuntime: () => ({ list }),
}));

describe("admin orders page", () => {
  it("shows real operational fields and preserves active filters", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    list.mockResolvedValue({
      items: [{
        id: "63f77c27-fd7b-4c65-a834-886c128b6cc1",
        orderNumber: "RNR-2026-ABC123",
        createdAt: new Date("2026-08-04T02:00:00.000Z"),
        updatedAt: new Date("2026-08-04T03:00:00.000Z"),
        customerName: "A Customer With A Long Name",
        customerEmail: "customer.with.a.long.address@example.test",
        country: "AU",
        productTitles: ["Digital Oil Painting Canvas"],
        totalInclGstCents: 34500,
        paymentMethod: "card",
        paymentStatus: "paid",
        fulfilmentStatus: "designing",
        deliveryMethod: "post",
        urgent: true,
      }],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });

    render(await AdminOrdersPage({ searchParams: Promise.resolve({
      q: "ABC123",
      payment: "paid",
      country: "AU",
    }) }));

    expect(requireAdminPage).toHaveBeenCalledWith(
      "/admin/orders?q=ABC123&payment=paid&country=AU",
      "view_orders",
    );
    expect(screen.getByRole("heading", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("ABC123")).toBeInTheDocument();
    expect(screen.getByText("RNR-2026-ABC123")).toBeInTheDocument();
    expect(screen.getByText("Digital Oil Painting Canvas")).toBeInTheDocument();
    expect(screen.getAllByText("Urgent")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open RNR-2026-ABC123" })).toHaveAttribute(
      "href",
      "/admin/orders/63f77c27-fd7b-4c65-a834-886c128b6cc1",
    );
  });

  it("renders a genuine empty state", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "staff-1" }, adminRole: "staff" });
    list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 });

    render(await AdminOrdersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("No orders match these filters.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/admin/orders");
  });

  it("shows a validation message and omits impossible dates from the query", async () => {
    requireAdminPage.mockResolvedValue({ user: { id: "admin-1" }, adminRole: "admin" });
    list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 });

    render(await AdminOrdersPage({ searchParams: Promise.resolve({
      from: "2026-02-30",
      to: "9999-99-99",
    }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter valid From and To dates.");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      validationMessage: "Enter valid From and To dates.",
    }));
    expect(list.mock.calls[0][0]).not.toHaveProperty("from");
    expect(list.mock.calls[0][0]).not.toHaveProperty("to");
  });
});
