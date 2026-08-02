import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripePaymentForm } from "./stripe-payment-form";

const { confirmPayment, elementsValue, loadStripe, useElements, useStripe } = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  elementsValue: { id: "elements-instance" },
  loadStripe: vi.fn().mockResolvedValue({ id: "stripe-instance" }),
  useElements: vi.fn(),
  useStripe: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({ loadStripe }));
vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  return {
    Elements: ({ children, options, stripe }: { children: React.ReactNode; options: unknown; stripe: unknown }) => <div data-testid="elements" data-options={JSON.stringify(options)} data-stripe={String(Boolean(stripe))}>{children}</div>,
    PaymentElement: () => <div data-testid="payment-element" />,
    useElements,
    useStripe,
  };
});

const props = {
  clientSecret: "pi_123_secret_client",
  publishableKey: "pk_test_public",
  returnUrl: "https://shop.example.test/api/payments/returns/stripe?state=safe",
};

describe("StripePaymentForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStripe.mockReturnValue({ confirmPayment });
    useElements.mockReturnValue(elementsValue);
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    window.sessionStorage.clear();
  });

  it("mounts official Elements with the response-only client secret", () => {
    render(<StripePaymentForm {...props} />);

    expect(loadStripe).toHaveBeenCalledWith(props.publishableKey);
    expect(screen.getByTestId("elements")).toHaveAttribute(
      "data-options",
      JSON.stringify({ clientSecret: props.clientSecret }),
    );
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull();
  });

  it("confirms with the trusted return URL and only reports pending confirmation", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    render(<StripePaymentForm {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm card payment" }));

    await waitFor(() => expect(confirmPayment).toHaveBeenCalledWith({
      elements: elementsValue,
      confirmParams: { return_url: props.returnUrl },
      redirect: "if_required",
    }));
    expect(await screen.findByText("Payment confirmation is pending")).toBeInTheDocument();
    expect(screen.queryByText("Payment confirmed.")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a client validation message but redacts other Stripe errors", async () => {
    confirmPayment.mockResolvedValueOnce({
      error: { type: "validation_error", message: "Enter a complete card number." },
    });
    const { rerender } = render(<StripePaymentForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm card payment" }));
    expect(await screen.findByText("Enter a complete card number.")).toBeInTheDocument();

    confirmPayment.mockResolvedValueOnce({
      error: { type: "api_error", message: "provider sk_live_private_value" },
    });
    rerender(<StripePaymentForm {...props} clientSecret="pi_456_secret_client" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm card payment" }));
    expect(await screen.findByText("Card payment could not be confirmed. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/sk_live_private_value/)).not.toBeInTheDocument();
  });

  it("fails closed when the public Stripe key is unavailable", () => {
    render(<StripePaymentForm {...props} publishableKey="" />);
    expect(screen.getByText("Card payment is unavailable.")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-element")).not.toBeInTheDocument();
  });
});
