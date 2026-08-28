import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parsePaymentMethodsResponse, PaymentMethods } from "./payment-methods";

const methods = [
  { method: "afterpay" as const, label: "Test Afterpay — no real payment", isTest: true },
  { method: "card" as const, label: "Test card — no real payment", isTest: true },
];

describe("PaymentMethods", () => {
  it("accepts only an exact public payment-method response", () => {
    expect(parsePaymentMethodsResponse({ methods })).toEqual(methods);
    for (const payload of [
      null,
      { methods, extra: true },
      { methods: [{ method: "cash", label: "Cash", isTest: false }] },
      { methods: [{ method: "zip", label: "Zip", isTest: false }] },
      { methods: [{ method: "card", label: "", isTest: false }] },
      { methods: [{ method: "card", label: "Card", isTest: "false" }] },
      { methods: [methods[0], methods[0]] },
      { methods: [{ ...methods[0], providerReference: "secret" }] },
    ]) expect(() => parsePaymentMethodsResponse(payload)).toThrow("Payment methods response is invalid");
  });

  it("renders an accessible payment radiogroup and truthful test copy", () => {
    render(<PaymentMethods methods={methods} value="card" onChange={vi.fn()} />);

    expect(screen.getByRole("radiogroup", { name: "Payment method" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    expect(screen.getByText("Test Afterpay — no real payment")).toBeInTheDocument();
    expect(document.querySelector('[data-payment-brand="afterpay"]')).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /zip/i })).not.toBeInTheDocument();
    expect(screen.getByText("No real payment will be taken.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Accepted cards: Visa, Mastercard and American Express" })).toBeInTheDocument();
    expect(screen.getByText("Secure payment powered by Stripe")).toBeInTheDocument();
    expect(screen.getByText(
      "Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.",
    )).toBeInTheDocument();
  });

  it("only shows Stripe card trust information when Card is selected", () => {
    render(<PaymentMethods methods={methods} value="afterpay" onChange={vi.fn()} />);

    expect(screen.queryByText("Secure payment powered by Stripe")).not.toBeInTheDocument();
    expect(screen.queryByText(
      "Card, Apple Pay and Google Pay are supported. Wallets appear only on eligible devices.",
    )).not.toBeInTheDocument();
  });

  it("reports selection and has at least 44px interaction targets through the shared class", () => {
    const onChange = vi.fn();
    const { container } = render(<PaymentMethods methods={methods} value="card" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Test Afterpay — no real payment" }));
    expect(onChange).toHaveBeenCalledWith("afterpay");
    expect(container.querySelectorAll("label")[0]?.className).toContain("paymentMethodOption");
  });

  it("shows a clear unavailable state instead of an empty group", () => {
    render(<PaymentMethods methods={[]} value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Payment methods are not configured yet")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Payment method" })).not.toBeInTheDocument();
  });
});
