import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followPaymentAction, OrderPaymentPanel, parsePaymentStartResponse } from "./order-payment-panel";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("./stripe-payment-form", () => ({
  StripePaymentForm: ({ clientSecret, confirmationUrl, publishableKey, returnUrl, totalInclGstCents, onPaymentUpdated }: {
    clientSecret: string;
    confirmationUrl: string;
    publishableKey: string;
    returnUrl: string;
    totalInclGstCents: number;
    onPaymentUpdated: (status: "paid" | "failed" | "cancelled" | "processing") => void;
  }) => <div
      data-testid="stripe-payment-form"
      data-client-secret={clientSecret}
      data-confirmation-url={confirmationUrl}
      data-publishable-key={publishableKey}
      data-return-url={returnUrl}
      data-total-incl-gst-cents={totalInclGstCents}
    >
      <button type="button" onClick={() => onPaymentUpdated("paid")}>Simulate Stripe paid</button>
      <button type="button" onClick={() => onPaymentUpdated("failed")}>Simulate Stripe failed</button>
    </div>,
}));

const methods = [
  { method: "card" as const, label: "Test card — no real payment", isTest: true },
  { method: "afterpay" as const, label: "Test Afterpay — no real payment", isTest: true },
];

const pendingCart = { version: 1, items: [{
  id: "30000000-0000-4000-8000-000000000001",
  productKey: "photo-print-canvas",
  productSlug: "photo-print-canvas",
  productTitle: "Photo Print Canvas",
  imageSrc: "/test.jpg",
  sizeKey: "a4",
  sizeLabel: "A4",
  orientation: "landscape",
  peoplePets: 0,
  photoSubmissionMethod: "later",
  designText: "Family",
  notes: "",
  neededDate: "2026-08-20",
  urgentServiceConfirmed: false,
  deliveryPreference: "pickup",
  quantity: 1,
  price: { lines: [], subtotalExGstCents: 6500, gstCents: 975, totalInclGstCents: 7475 },
  uploadReferences: [],
}] } as const;

const durableIntent = {
  schemaVersion: 1,
  phase: "starting_payment",
  orderIdempotencyKey: "70000000-0000-4000-8000-000000000001",
  paymentIdempotencyKey: "80000000-0000-4000-8000-000000000001",
  method: "card",
  checkoutVersion: 2,
  cartDigest: "a".repeat(64),
  shipping: { method: "pickup", serviceCode: "pickup", amountExGstCents: 0, gstCents: 0, amountInclGstCents: 0, isTest: false },
  orderNumber: "RNR-2026-ABC",
} as const;

function seedDurablePendingCheckout() {
  window.localStorage.setItem("rnr-cart-v1", JSON.stringify(pendingCart));
  window.localStorage.setItem("rnr-pending-checkout-v1", JSON.stringify({
    schemaVersion: 1,
    intent: durableIntent,
    cart: pendingCart,
  }));
}

describe("OrderPaymentPanel", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("resumes the same Stripe payment from durable storage after the browser is reopened", async () => {
    seedDurablePendingCheckout();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_reopened", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={{ method: "card", status: "processing", isTest: false, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    expect(await screen.findByTestId("stripe-payment-form")).toHaveAttribute("data-client-secret", "pi_secret_reopened");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      method: "card",
      idempotencyKey: durableIntent.paymentIdempotencyKey,
    });
    expect(window.localStorage.getItem("rnr-cart-v1")).toBe(JSON.stringify(pendingCart));
  });

  it("clears the matching retained cart only after payment is confirmed", async () => {
    seedDurablePendingCheckout();

    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="paid"
      payment={{ method: "card", status: "paid", isTest: false, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    await waitFor(() => expect(window.localStorage.getItem("rnr-cart-v1")).toBeNull());
    expect(window.localStorage.getItem("rnr-pending-checkout-v1")).toBeNull();
  });

  it.each(["failed", "cancelled"] as const)(
    "retains the ordered-cart association after %s so a successful retry clears it",
    async (paymentStatus) => {
      seedDurablePendingCheckout();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          payment: { method: "card", status: "paid", isTest: false, canRetry: false },
          action: null,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<OrderPaymentPanel
        orderNumber="RNR-2026-ABC"
        paymentStatus={paymentStatus}
        payment={{ method: "card", status: paymentStatus, isTest: false, canRetry: true }}
        methods={methods}
        orderHref="/orders/RNR-2026-ABC"
      />);

      await waitFor(() => expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull());
      expect(window.localStorage.getItem("rnr-pending-checkout-v1")).not.toBeNull();
      expect(window.localStorage.getItem("rnr-cart-v1")).toBe(JSON.stringify(pendingCart));

      fireEvent.click(screen.getByRole("button", { name: "Continue to secure card payment" }));

      await waitFor(() => expect(window.localStorage.getItem("rnr-cart-v1")).toBeNull());
      expect(window.localStorage.getItem("rnr-pending-checkout-v1")).toBeNull();
    },
  );

  it("keeps the durable cart association when Stripe reports a failed confirmation", async () => {
    seedDurablePendingCheckout();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_failed", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) }));
    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={{ method: "card", status: "processing", isTest: false, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    await screen.findByTestId("stripe-payment-form");
    fireEvent.click(screen.getByRole("button", { name: "Simulate Stripe failed" }));

    expect(window.localStorage.getItem("rnr-pending-checkout-v1")).not.toBeNull();
    expect(window.localStorage.getItem("rnr-cart-v1")).toBe(JSON.stringify(pendingCart));
  });

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
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));

    expect(await screen.findByText("Afterpay is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeEnabled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("afterpay");
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("shows truthful processing copy without claiming payment succeeded", () => {
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="processing" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByText("Payment is processing. Your order is not yet confirmed.")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue to/ })).not.toBeInTheDocument();
  });

  it("shows pending confirmation when the current attempt is processing before the order snapshot catches up", () => {
    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={{ method: "card", status: "processing", isTest: false, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    expect(screen.getByText("Complete payment to confirm your order.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Test Afterpay — no real payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to secure card payment" })).toBeEnabled();
  });

  it("continues the same authoritative processing method after an order refresh", () => {
    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="processing"
      payment={{ method: "card", status: "processing", isTest: true, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    expect(screen.getByText("Complete payment to confirm your order.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Test Afterpay — no real payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeEnabled();
    expect(screen.queryByText("Payment confirmed.")).not.toBeInTheDocument();
  });

  it("locks an existing actionable attempt to its authoritative method", () => {
    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={{ method: "afterpay", status: "requires_action", isTest: true, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    expect(screen.getByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Test card — no real payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeEnabled();
  });

  it("rebinds the controls when an authoritative attempt appears without changing order status", () => {
    const view = render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={null}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);
    expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();

    view.rerender(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={{ method: "afterpay", status: "requires_action", isTest: true, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    expect(screen.getByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Test card — no real payment" })).not.toBeInTheDocument();
  });

  it.each(["failed", "cancelled"] as const)(
    "defaults a retryable %s attempt to the method that failed",
    (status) => {
      render(<OrderPaymentPanel
        orderNumber="RNR-2026-ABC"
        paymentStatus={status}
        payment={{ method: "afterpay", status, isTest: true, canRetry: true }}
        methods={methods}
        orderHref="/orders/RNR-2026-ABC"
      />);

      expect(screen.getByRole("radio", { name: "Test Afterpay — no real payment" })).toBeChecked();
      expect(screen.getByRole("button", { name: /Continue to/ })).toBeEnabled();
    },
  );

  it.each(["paid", "refunded"] as const)(
    "lets authoritative order status %s suppress retry even if a stale attempt says failed",
    (paymentStatus) => {
      render(<OrderPaymentPanel
        orderNumber="RNR-2026-ABC"
        paymentStatus={paymentStatus}
        payment={{ method: "afterpay", status: "failed", isTest: true, canRetry: true }}
        methods={methods}
        orderHref="/orders/RNR-2026-ABC"
      />);

      expect(screen.queryByRole("radiogroup", { name: "Payment method" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /payment/i })).not.toBeInTheDocument();
    },
  );

  it.each(["failed", "cancelled"] as const)(
    "lets authoritative %s order status override a stale processing attempt",
    (paymentStatus) => {
      render(<OrderPaymentPanel
        orderNumber="RNR-2026-ABC"
        paymentStatus={paymentStatus}
        payment={{ method: "afterpay", status: "processing", isTest: true, canRetry: false }}
        methods={methods}
        orderHref="/orders/RNR-2026-ABC"
      />);

      expect(screen.getByText(paymentStatus === "failed"
        ? "Payment failed. Choose a payment method and try again."
        : "Payment cancelled. Choose a payment method and try again.")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Test card — no real payment" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "Test Afterpay — no real payment" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Continue to/ })).toBeEnabled();
    },
  );

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
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull();
  });

  it("keeps payment disabled when no methods are configured", () => {
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={[]} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByText("Payment methods are not configured yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to/ })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
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

  it.each(["paid", "failed", "cancelled", "refunded"] as const)(
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
      fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
      await screen.findByText("Payment response was lost");
      fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
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
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("retains recovery state while following a non-terminal action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_123", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" totalInclGstCents={39725} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await screen.findByTestId("stripe-payment-form");
    expect(push).not.toHaveBeenCalled();
    const stored = window.sessionStorage.getItem("rnr-checkout-payment-intent-v1");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("pi_secret_123");
    expect(screen.getByTestId("stripe-payment-form")).toHaveAttribute("data-client-secret", "pi_secret_123");
    expect(screen.getByTestId("stripe-payment-form")).toHaveAttribute("data-confirmation-url", "/api/orders/RNR-2026-ABC/payment");
    expect(screen.getByTestId("stripe-payment-form")).toHaveAttribute("data-return-url", "http://localhost:3000/api/payments/returns/stripe?state=safe");
    expect(screen.getByTestId("stripe-payment-form")).toHaveAttribute("data-total-incl-gst-cents", "39725");
    expect(screen.queryByRole("button", { name: "Continue to secure card payment" })).not.toBeInTheDocument();
  });

  it("reopens Stripe Elements for a stored processing card attempt instead of confirming it empty", async () => {
    const paymentIdempotencyKey = "70000000-0000-4000-8000-000000000002";
    window.sessionStorage.setItem("rnr-checkout-payment-intent-v1", JSON.stringify({
      schemaVersion: 1,
      phase: "starting_payment",
      orderNumber: "RNR-2026-ABC",
      paymentIdempotencyKey,
      method: "card",
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_resume", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrderPaymentPanel
      orderNumber="RNR-2026-ABC"
      paymentStatus="awaiting_payment"
      payment={{ method: "card", status: "processing", isTest: false, canRetry: false }}
      methods={methods}
      orderHref="/orders/RNR-2026-ABC"
    />);

    expect(await screen.findByTestId("stripe-payment-form")).toHaveAttribute(
      "data-client-secret",
      "pi_secret_resume",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      method: "card",
      idempotencyKey: paymentIdempotencyKey,
    });
  });

  it("removes a stale Stripe form when the customer changes payment method", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_123", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    expect(await screen.findByTestId("stripe-payment-form")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Test Afterpay — no real payment" }));

    expect(screen.queryByTestId("stripe-payment-form")).not.toBeInTheDocument();
  });

  it.each(["paid", "failed", "cancelled", "refunded"] as const)(
    "removes Stripe Elements and recovery when the authoritative order status becomes %s",
    async (paymentStatus) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
        payment: { method: "card", status: "processing", isTest: false, canRetry: false },
        action: { kind: "elements", method: "card", clientSecret: "pi_secret_123", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
      }) }));
      const view = render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
      fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
      expect(await screen.findByTestId("stripe-payment-form")).toBeInTheDocument();
      expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).not.toBeNull();

      view.rerender(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus={paymentStatus} methods={methods} orderHref="/orders/RNR-2026-ABC" />);

      await waitFor(() => {
        expect(screen.queryByTestId("stripe-payment-form")).not.toBeInTheDocument();
        expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull();
      });
    },
  );

  it("shows one final card action after Stripe Elements opens", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_first", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to secure card payment" }));
    const firstForm = await screen.findByTestId("stripe-payment-form");
    expect(firstForm).toHaveAttribute("data-client-secret", "pi_secret_first");
    expect(screen.queryByRole("button", { name: "Continue to secure card payment" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "cancelled"] as const)(
    "creates a fresh Stripe form for a manual card retry after %s",
    async (paymentStatus) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          payment: { method: "card", status: "processing", isTest: false, canRetry: false },
          action: { kind: "elements", method: "card", clientSecret: "pi_secret_first", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
        }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({
          payment: { method: "card", status: "processing", isTest: false, canRetry: false },
          action: { kind: "elements", method: "card", clientSecret: "pi_secret_second", returnUrl: "http://localhost:3000/api/payments/returns/stripe?state=safe" },
        }) });
      vi.stubGlobal("fetch", fetchMock);
      const view = render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
      fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
      const firstForm = await screen.findByTestId("stripe-payment-form");

      view.rerender(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus={paymentStatus} methods={methods} orderHref="/orders/RNR-2026-ABC" />);
      await waitFor(() => expect(screen.queryByTestId("stripe-payment-form")).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));

      const secondForm = await screen.findByTestId("stripe-payment-form");
      expect(secondForm).toHaveAttribute("data-client-secret", "pi_secret_second");
      expect(secondForm).not.toBe(firstForm);
    },
  );

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
    expect(parsePaymentStartResponse({
      payment: { method: "card", status: "requires_action", isTest: true, canRetry: false },
      action: { kind: "test", method: "card", redirectUrl: "http://192.168.4.199:3000/test-payment", isTest: true },
    }, "card", { nodeEnv: "development", currentOrigin: "http://192.168.4.199:3000" }))
      .toMatchObject({ action: { kind: "test" } });
    expect(parsePaymentStartResponse({
      payment: { method: "card", status: "processing", isTest: false, canRetry: false },
      action: { kind: "elements", method: "card", clientSecret: "pi_secret_lan", returnUrl: "http://192.168.4.199:3000/api/payments/returns/stripe?state=safe" },
    }, "card", { nodeEnv: "development", currentOrigin: "http://192.168.4.199:3000" }))
      .toMatchObject({ action: { kind: "elements" } });
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
    fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
    await waitFor(() => expect(screen.getByText("Payment is processing. Your order is not yet confirmed.")).toBeInTheDocument());
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });
});
