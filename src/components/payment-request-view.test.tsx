import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";
import { PaymentRequestView } from "./payment-request-view";

const request: PublicPaymentRequestDTO = Object.freeze({
  requestNumber: "PAY-2026-ABC123",
  kind: "standalone",
  description: "Outstanding design balance",
  amountCents: 20_000,
  currency: "NZD",
  status: "pending",
  methods: ["card", "afterpay"] as const,
});

describe("PaymentRequestView", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/pay/A234567890123456789012345678901234567890123");
  });

  it("shows only the public fixed-payment details and does not expose editable amount controls", () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    expect(screen.getByRole("heading", { name: "Payment request" })).toBeInTheDocument();
    expect(screen.getByText("PAY-2026-ABC123")).toBeInTheDocument();
    expect(screen.getByText("Outstanding design balance")).toBeInTheDocument();
    expect(screen.getByText("NZ$200.00")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
  });

  it("requires no address for Card and reveals address only for Afterpay", () => {
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
      { method: "afterpay", label: "Afterpay", isTest: false },
    ]} />);

    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Afterpay" }));
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
  });

  it("submits payer details without an amount or raw token in the JSON body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        payment: { method: "card", status: "processing", isTest: false, canRetry: false },
        action: { kind: "redirect", method: "card", redirectUrl: "https://payments.example.test/session" },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, pathname: "/pay/A234567890123456789012345678901234567890123", assign },
    });
    render(<PaymentRequestView request={request} methods={[
      { method: "card", label: "Card", isTest: false },
    ]} />);

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Test Payer" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "payer@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay NZ$200.00" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ method: "card", fullName: "Test Payer", email: "payer@example.test" });
    expect(body).not.toHaveProperty("amountCents");
    expect(body).not.toHaveProperty("token");
  });

  it.each(["paid", "expired", "cancelled", "invalidated"] as const)(
    "shows no payment controls when status is %s",
    (status) => {
      render(<PaymentRequestView request={{ ...request, status }} methods={[]} />);
      expect(screen.getByText(/no longer payable|has been paid/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Pay / })).not.toBeInTheDocument();
    },
  );

  it("formats Australian requests explicitly in AUD", () => {
    render(<PaymentRequestView request={{ ...request, currency: "AUD" }} methods={[
      { method: "card", label: "Card", isTest: false },
    ]} />);
    expect(screen.getAllByText("A$200.00 AUD").length).toBeGreaterThan(0);
  });
});
