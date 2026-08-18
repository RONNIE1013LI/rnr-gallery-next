import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { requireAdminPage, orderSummary } = vi.hoisted(() => ({
  requireAdminPage: vi.fn(), orderSummary: vi.fn(),
}));
vi.mock("@/server/auth/require-admin-page", () => ({ requireAdminPage }));
vi.mock("@/server/payment-requests/payment-request-runtime", () => ({
  getPaymentRequestRuntime: () => ({ orderSummary }),
}));
import NewPaymentRequestPage from "./page";

describe("New Payment Request page", () => {
  it("loads the authoritative Order balance and guards with manage_payment", async () => {
    orderSummary.mockResolvedValue({
      orderId: "order-1", orderNumber: "08001", currency: "AUD",
      totalCents: 40_000, netPaidCents: 10_000, outstandingCents: 30_000,
      reservedCents: 5_000, unreservedCents: 25_000, ledger: [],
    });
    render(await NewPaymentRequestPage({
      searchParams: Promise.resolve({ orderId: "order-1" }),
    }));
    expect(requireAdminPage).toHaveBeenCalledWith(
      "/admin/payment-requests/new?orderId=order-1", "manage_payment",
    );
    expect(orderSummary).toHaveBeenCalledWith("order-1");
    expect(screen.getByLabelText("Amount")).toHaveValue(250);
    expect(screen.getByLabelText("Currency")).toHaveValue("AUD");
  });
});
