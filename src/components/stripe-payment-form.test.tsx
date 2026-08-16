import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripePaymentForm } from "./stripe-payment-form";

const { confirmPayment, elementsValue, loadStripe, paymentElement, useElements, useStripe } = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  elementsValue: { id: "elements-instance" },
  loadStripe: vi.fn().mockResolvedValue({ id: "stripe-instance" }),
  paymentElement: {
    onChange: undefined as undefined | ((event: { complete: boolean }) => void),
    onReady: undefined as undefined | (() => void),
    options: undefined as unknown,
  },
  useElements: vi.fn(),
  useStripe: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({ loadStripe }));
vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  return {
    Elements: ({ children, options, stripe }: { children: React.ReactNode; options: unknown; stripe: unknown }) => <div data-testid="elements" data-options={JSON.stringify(options)} data-stripe={String(Boolean(stripe))}>{children}</div>,
    PaymentElement: ({ onChange, onReady, options }: {
      onChange?: (event: { complete: boolean }) => void;
      onReady?: () => void;
      options?: unknown;
    }) => {
      paymentElement.onChange = onChange;
      paymentElement.onReady = onReady;
      paymentElement.options = options;
      return <div data-testid="payment-element" />;
    },
    useElements,
    useStripe,
  };
});

const props = {
  clientSecret: "pi_123_secret_client",
  confirmationUrl: "/api/orders/RNR-2026-ABC/payment",
  publishableKey: "pk_test_public",
  returnUrl: "https://shop.example.test/api/payments/returns/stripe?state=safe",
  totalInclGstCents: 39725,
};

describe("StripePaymentForm", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useStripe.mockReturnValue({ confirmPayment });
    useElements.mockReturnValue(elementsValue);
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    paymentElement.onChange = undefined;
    paymentElement.onReady = undefined;
    paymentElement.options = undefined;
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
    expect(paymentElement.options).toEqual({
      wallets: { applePay: "auto", googlePay: "auto" },
    });
    expect(window.sessionStorage.getItem("rnr:commerce:v1:guest:checkout:payment-intent")).toBeNull();
  });

  it("does not submit Stripe while the card details are empty", () => {
    render(<StripePaymentForm {...props} />);

    const confirm = screen.getByRole("button", { name: "Pay NZ$397.25 and place order" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(confirmPayment).not.toHaveBeenCalled();

    act(() => paymentElement.onChange?.({ complete: true }));
    expect(confirm).toBeDisabled();
    act(() => paymentElement.onReady?.());
    expect(confirm).toBeEnabled();
  });

  it("labels an Australian fixed-price payment in AUD", () => {
    render(<StripePaymentForm {...props} currency="AUD" />);

    expect(screen.getByRole("button", { name: "Pay A$397.25 AUD and place order" }))
      .toBeDisabled();
  });

  it("confirms with the trusted return URL and applies the server-verified result", async () => {
    const onPaymentUpdated = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payment: { status: "paid" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<StripePaymentForm {...props} onPaymentUpdated={onPaymentUpdated} />);

    act(() => paymentElement.onReady?.());
    act(() => paymentElement.onChange?.({ complete: true }));
    fireEvent.click(screen.getByRole("button", { name: "Pay NZ$397.25 and place order" }));

    await waitFor(() => expect(confirmPayment).toHaveBeenCalledWith({
      elements: elementsValue,
      confirmParams: { return_url: props.returnUrl },
      redirect: "if_required",
    }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      props.confirmationUrl,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "confirm" }),
      }),
    ));
    expect(onPaymentUpdated).toHaveBeenCalledWith("paid");
    expect(await screen.findByText("Payment confirmed. Your order has been placed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay NZ$397.25 and place order" })).toBeDisabled();
  });

  it("shows a client validation message without locking the editable card form", async () => {
    confirmPayment.mockResolvedValueOnce({
      error: { type: "validation_error", message: "Enter a complete card number." },
    });
    render(<StripePaymentForm {...props} />);
    act(() => paymentElement.onReady?.());
    act(() => paymentElement.onChange?.({ complete: true }));
    const button = screen.getByRole("button", { name: "Pay NZ$397.25 and place order" });
    fireEvent.click(button);
    expect(await screen.findByText("Enter a complete card number.")).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("recovers an ambiguous client error by verifying the payment on the server", async () => {
    const onPaymentUpdated = vi.fn();
    confirmPayment.mockResolvedValueOnce({
      error: { type: "api_error", message: "The confirmation response was interrupted." },
    });
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ payment: { status: "paid" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<StripePaymentForm
      {...props}
      onPaymentUpdated={onPaymentUpdated}
    />);

    act(() => paymentElement.onReady?.());
    act(() => paymentElement.onChange?.({ complete: true }));
    fireEvent.click(screen.getByRole("button", { name: "Pay NZ$397.25 and place order" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      props.confirmationUrl,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(onPaymentUpdated).toHaveBeenCalledWith("paid");
    expect(screen.queryByText("Card payment could not be confirmed. Try again.")).not.toBeInTheDocument();
    expect(screen.queryByText(/interrupted/)).not.toBeInTheDocument();
  });

  it("prevents a duplicate confirmation when server verification is temporarily unavailable", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetchSpy);
    render(<StripePaymentForm {...props} />);

    act(() => paymentElement.onReady?.());
    act(() => paymentElement.onChange?.({ complete: true }));
    const button = screen.getByRole("button", { name: "Pay NZ$397.25 and place order" });
    fireEvent.click(button);

    expect(await screen.findByText(
      "Payment was submitted and is being verified. Do not submit it again.",
    )).toBeInTheDocument();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the public Stripe key is unavailable", () => {
    render(<StripePaymentForm {...props} publishableKey="" />);
    expect(screen.getByText("Card payment is unavailable.")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-element")).not.toBeInTheDocument();
  });
});
