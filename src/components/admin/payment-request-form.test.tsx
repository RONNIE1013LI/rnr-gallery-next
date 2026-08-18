import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentRequestForm } from "./payment-request-form";

describe("Admin PaymentRequestForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", { randomUUID: () => "admin-idempotency-key" });
  });

  it("uses the linked Order currency and defaults to its unreserved balance", () => {
    render(<PaymentRequestForm linkedOrder={{
      id: "order-1", orderNumber: "08001", currency: "NZD", unreservedCents: 15_000,
    }} />);
    expect(screen.getByText("Order 08001")).toBeInTheDocument();
    expect(screen.getByLabelText("Currency")).toHaveValue("NZD");
    expect(screen.getByLabelText("Currency")).toBeDisabled();
    expect(screen.getByLabelText("Amount")).toHaveValue(150);
    expect(screen.getByRole("checkbox", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Afterpay" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /zip/i })).not.toBeInTheDocument();
  });

  it("keeps standalone name and email optional and reveals the one-time link", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        request: { id: "request-1", requestNumber: "PAY-2026-ABC" },
        paymentUrl: "https://rrgallery.co.nz/pay/safe-token",
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PaymentRequestForm />);

    expect(screen.getByLabelText("Customer name (optional)")).not.toBeRequired();
    expect(screen.getByLabelText("Customer email (optional)")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Custom balance" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("https://rrgallery.co.nz/pay/safe-token")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });
});
