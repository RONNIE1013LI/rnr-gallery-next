import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaymentMethods } from "./payment-methods";

const methods = [
  { method: "afterpay" as const, label: "Test Afterpay — no real payment", isTest: true },
  { method: "card" as const, label: "Test card — no real payment", isTest: true },
];

describe("PaymentMethods", () => {
  it("renders an accessible payment radiogroup and truthful test copy", () => {
    render(<PaymentMethods methods={methods} value="card" onChange={vi.fn()} />);

    expect(screen.getByRole("radiogroup", { name: "Payment method" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    expect(screen.getByText("Test Afterpay — no real payment")).toBeInTheDocument();
    expect(screen.getByText("No real payment will be taken.")).toBeInTheDocument();
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
