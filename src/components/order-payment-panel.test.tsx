import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followPaymentAction, OrderPaymentPanel, parsePaymentStartResponse } from "./order-payment-panel";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./stripe-payment-form", () => ({
  StripePaymentForm: ({ clientSecret, publishableKey, returnUrl }: {
    clientSecret: string;
    publishableKey: string;
    returnUrl: string;
  }) => <div
    data-testid="stripe-payment-form"
    data-client-secret={clientSecret}
    data-publishable-key={publishableKey}
    data-return-url={returnUrl}
  />,
}));

const methods = [
  { method: "card" as const, label: "Test card — no real payment", isTest: true },
  { method: "afterpay" as const, label: "Test Afterpay — no real payment", isTest: true },
];

describe("OrderPaymentPanel", () => {
  beforeEach(() => { push.mockReset(); vi.restoreAllMocks(); window.sessionStorage.clear(); });

  it("resumes the checkout payment attempt for the same order with the same key and method", async () => {
    const paymentIdempotencyKey = "70000000-0000-4000-8000-000000000002";
    window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify({
      schemaVersion: 1,
      phase: "starting_payment",
      orderIdempotencyKey: "70000000-0000-4000-8000-000000000001",
      paymentIdempotencyKey,
      method: "afterpay",
      checkoutVersion: 3,
      cartDigest: "a".repeat(64),
      shipping: { method: "post", serviceCode: "NZ-NORTH", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, isTest: true },
      orderNumber: "RNR-2026-ABC",
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "afterpay", status: "processing", isTest: true, canRetry: false },
      action: null,
    }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);

    expect(screen.getByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ method: "afterpay", idempotencyKey: paymentIdempotencyKey });
    expect(JSON.parse(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1") ?? "null")).toMatchObject({
      phase: "starting_payment",
      method: "afterpay",
      paymentIdempotencyKey,
    });
  });

  it("persists a minimal direct-order recovery record before sending the request", async () => {
    let resolveRequest!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);

    fireEvent.click(screen.getByRole("radio", { name: "Test Afterpay — no real payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1") ?? "null");
    expect(stored).toEqual({
      schemaVersion: 1,
      phase: "starting_payment",
      orderNumber: "RNR-2026-ABC",
      paymentIdempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      method: "afterpay",
    });
    expect(JSON.stringify(stored)).not.toMatch(/clientSecret|redirectUrl|providerReference|returnState/);
    resolveRequest({ ok: true, json: async () => ({
      payment: { method: "afterpay", status: "processing", isTest: true, canRetry: false },
      action: null,
    }) });
  });

  it("ignores a stored payment attempt for another order", () => {
    window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify({
      phase: "starting_payment",
      paymentIdempotencyKey: "70000000-0000-4000-8000-000000000002",
      method: "afterpay",
      orderNumber: "RNR-2026-OTHER",
    }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
  });

  it("uses a new key when the stored method is no longer available", async () => {
    const storedKey = "70000000-0000-4000-8000-000000000002";
    window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify({
      schemaVersion: 1,
      phase: "starting_payment",
      orderIdempotencyKey: "70000000-0000-4000-8000-000000000001",
      paymentIdempotencyKey: storedKey,
      method: "afterpay",
      checkoutVersion: 3,
      cartDigest: "a".repeat(64),
      shipping: { method: "post", serviceCode: "NZ-NORTH", amountExGstCents: 2000, gstCents: 300, amountInclGstCents: 2300, isTest: true },
      orderNumber: "RNR-2026-ABC",
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: "Unavailable" } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={[methods[0]]} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));

    await screen.findByText("Unavailable");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.method).toBe("card");
    expect(request.idempotencyKey).not.toBe(storedKey);
  });

  it("starts an enabled alternative with a stable browser key and retains choices after failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: "Afterpay is unavailable" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);

    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Test Afterpay — no real payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));

    expect(await screen.findByText("Afterpay is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeEnabled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("afterpay");
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("shows truthful processing copy without claiming payment succeeded", () => {
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="processing" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByText("Payment confirmation is pending")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay for order" })).not.toBeInTheDocument();
  });

  it.each([
    ["paid" as const, "Payment confirmed."],
    ["failed" as const, "Payment failed. Choose a payment method and try again."],
    ["cancelled" as const, "Payment cancelled. Choose a payment method and try again."],
    ["refunded" as const, "Payment refunded."],
  ])("shows truthful copy for %s order status", (paymentStatus, expected) => {
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus={paymentStatus} methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each([
    ["paid" as const, "Payment confirmed."],
    ["failed" as const, "Payment failed. Choose a payment method and try again."],
    ["cancelled" as const, "Payment cancelled. Choose a payment method and try again."],
  ])("clears recovery only for terminal %s start responses", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status, isTest: true, canRetry: status !== "paid" },
      action: null,
    }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull();
  });

  it("keeps payment disabled when no methods are configured", () => {
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={[]} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByText("Payment methods are not configured yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay for order" })).toBeDisabled();
  });

  it("loads owner-scoped order methods instead of trusting configured-only options", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ methods: [methods[1]] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" orderHref="/orders/RNR-2026-ABC" />);

    expect(screen.getByText("Loading payment methods…")).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Test card — no real payment" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/RNR-2026-ABC/payment", expect.objectContaining({ cache: "no-store" }));
  });

  it("retries a dynamically resumed request with the exact stored key after a lost response", async () => {
    const storedKey = "70000000-0000-4000-8000-000000000002";
    const storedIntent = {
      schemaVersion: 1,
      phase: "starting_payment",
      orderNumber: "RNR-2026-ABC",
      paymentIdempotencyKey: storedKey,
      method: "afterpay",
    };
    window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify(storedIntent));
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ methods: [methods[1]] }) });
      }
      return Promise.reject(new TypeError("Payment response was lost"));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" orderHref="/orders/RNR-2026-ABC" />);

    expect(await screen.findByText("Payment response was lost")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(2));
    const requests = fetchMock.mock.calls
      .filter(([, init]) => init.method === "POST")
      .map(([, init]) => JSON.parse(init.body));
    expect(requests).toEqual([
      { method: "afterpay", idempotencyKey: storedKey },
      { method: "afterpay", idempotencyKey: storedKey },
    ]);
    expect(JSON.parse(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1") ?? "null")).toEqual(storedIntent);
  });

  it.each(["processing", "paid", "failed", "cancelled", "refunded"] as const)(
    "clears a retained starting intent and sends zero POSTs on initial %s status",
    async (paymentStatus) => {
      window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify({
        schemaVersion: 1,
        phase: "starting_payment",
        orderNumber: "RNR-2026-ABC",
        paymentIdempotencyKey: "70000000-0000-4000-8000-000000000002",
        method: "afterpay",
      }));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus={paymentStatus} methods={methods} orderHref="/orders/RNR-2026-ABC" />);

      await waitFor(() => expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull());
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "cancelled"] as const)(
    "starts initial %s manual retries with one new stable key",
    async (paymentStatus) => {
      const oldKey = "70000000-0000-4000-8000-000000000002";
      window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify({
        schemaVersion: 1,
        phase: "starting_payment",
        orderNumber: "RNR-2026-ABC",
        paymentIdempotencyKey: oldKey,
        method: "afterpay",
      }));
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Payment response was lost"));
      vi.stubGlobal("fetch", fetchMock);
      render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus={paymentStatus} methods={methods} orderHref="/orders/RNR-2026-ABC" />);

      expect(screen.getByText(paymentStatus === "failed"
        ? "Payment failed. Choose a payment method and try again."
        : "Payment cancelled. Choose a payment method and try again.")).toBeInTheDocument();
      await waitFor(() => expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
      await screen.findByText("Payment response was lost");
      fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
      expect(requests[0].idempotencyKey).not.toBe(oldKey);
      expect(requests[1]).toEqual(requests[0]);
    },
  );

  it("routes public payment actions without interpreting them as paid", async () => {
    const assign = vi.fn();
    const navigate = vi.fn();
    await followPaymentAction({ kind: "redirect", method: "afterpay", redirectUrl: "https://pay.example.test/start" }, "/orders/RNR-2026-ABC", { assign, navigate });
    expect(assign).toHaveBeenCalledWith("https://pay.example.test/start");

    await followPaymentAction({ kind: "elements", method: "card", clientSecret: "client-secret", returnUrl: "https://shop.example.test/payment-return" }, "/account/orders/RNR-2026-ABC", { assign, navigate });
    expect(navigate).toHaveBeenCalledWith("/account/orders/RNR-2026-ABC#payment");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("retains recovery state while following a non-terminal action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_123", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/RNR-2026-ABC#payment"));
    const stored = window.sessionStorage.getItem("rnr-checkout-payment-intent-v1");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("pi_secret_123");
    expect(screen.getByTestId("stripe-payment-form")).toHaveAttribute("data-client-secret", "pi_secret_123");
    expect(screen.getByTestId("stripe-payment-form")).toHaveAttribute("data-return-url", "http://localhost:3000/api/payments/returns/stripe?state=safe");
  });

  it("removes a stale Stripe form when the customer changes payment method", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_123", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    expect(await screen.findByTestId("stripe-payment-form")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Test Afterpay — no real payment" }));

    expect(screen.queryByTestId("stripe-payment-form")).not.toBeInTheDocument();
  });

  it("accepts only exact method-compatible payment responses and trusted action URLs", () => {
    expect(parsePaymentStartResponse({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_safe", returnUrl: "https://shop.example.test/api/payments/returns/stripe?state=safe" },
    }, "card", { nodeEnv: "production", currentOrigin: "https://shop.example.test" })).toMatchObject({ action: { kind: "elements" } });
    expect(parsePaymentStartResponse({
      payment: { method: "afterpay", status: "requires_action", isTest: false, canRetry: false },
      action: { kind: "redirect", method: "afterpay", redirectUrl: "https://pay.example.test/start" },
    }, "afterpay", { nodeEnv: "production", currentOrigin: "https://shop.example.test" })).toMatchObject({ action: { kind: "redirect" } });
    expect(parsePaymentStartResponse({
      payment: { method: "card", status: "requires_action", isTest: true, canRetry: false },
      action: { kind: "test", method: "card", redirectUrl: "http://127.0.0.1:3000/test-payment", isTest: true },
    }, "card", { nodeEnv: "test", currentOrigin: "http://127.0.0.1:3000" })).toMatchObject({ action: { kind: "test" } });
    expect(() => parsePaymentStartResponse({
      payment: { method: "card", status: "requires_action", isTest: true, canRetry: false },
      action: { kind: "test", method: "card", redirectUrl: "https://shop.example.test/test-payment", isTest: true },
    }, "card", { nodeEnv: "production", currentOrigin: "https://shop.example.test" })).toThrow("Payment response is invalid");
    expect(() => parsePaymentStartResponse({
      payment: { method: "card", status: "requires_action", isTest: true, canRetry: false },
      action: { kind: "test", method: "card", redirectUrl: "https://other.example.test/test-payment", isTest: true },
    }, "card", { nodeEnv: "test", currentOrigin: "https://shop.example.test" })).toThrow("Payment response is invalid");

    const invalid = [
      { payment: { method: "card", status: "processing", isTest: false, canRetry: false }, action: null, extra: true },
      { payment: { method: "card", status: "unknown", isTest: false, canRetry: false }, action: null },
      { payment: { method: "card", status: "failed", isTest: false, canRetry: false }, action: null },
      { payment: { method: "card", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "redirect", method: "afterpay", redirectUrl: "https://pay.example.test" } },
      { payment: { method: "afterpay", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "elements", method: "card", clientSecret: "secret", returnUrl: "https://shop.example.test/payment-return" } },
      { payment: { method: "card", status: "processing", isTest: false, canRetry: false }, action: { kind: "elements", method: "card", clientSecret: "secret" } },
      { payment: { method: "card", status: "processing", isTest: false, canRetry: false }, action: { kind: "elements", method: "card", clientSecret: "secret", returnUrl: "https://other.example.test/payment-return" } },
      { payment: { method: "card", status: "processing", isTest: false, canRetry: false }, action: { kind: "elements", method: "card", clientSecret: "secret", returnUrl: "javascript:alert(1)" } },
      { payment: { method: "card", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "test", method: "card", redirectUrl: "https://shop.example.test/test", isTest: true } },
      { payment: { method: "afterpay", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "redirect", method: "afterpay", redirectUrl: "javascript:alert(1)" } },
      { payment: { method: "afterpay", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "redirect", method: "afterpay", redirectUrl: "data:text/html,bad" } },
      { payment: { method: "afterpay", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "redirect", method: "afterpay", redirectUrl: "http://pay.example.test/start" } },
      { payment: { method: "afterpay", status: "requires_action", isTest: false, canRetry: false }, action: { kind: "redirect", method: "afterpay", redirectUrl: "not a url" } },
    ];
    for (const payload of invalid) {
      expect(() => parsePaymentStartResponse(payload, "card", {
        nodeEnv: "production", currentOrigin: "https://shop.example.test",
      })).toThrow("Payment response is invalid");
    }
  });

  it("shows pending confirmation when the start response has no immediate action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ payment: { method: "card", status: "processing", isTest: true, canRetry: false }, action: null }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    await waitFor(() => expect(screen.getByText("Payment confirmation is pending")).toBeInTheDocument());
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });
});
