import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followPaymentAction, OrderPaymentPanel } from "./order-payment-panel";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ method: "afterpay", idempotencyKey: paymentIdempotencyKey });
    expect(window.sessionStorage.getItem("rnr-checkout-payment-intent-v1")).toBeNull();
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

  it("keeps payment disabled when no methods are configured", () => {
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={[]} orderHref="/orders/RNR-2026-ABC" />);
    expect(screen.getByText("Payment methods are not configured yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay for order" })).toBeDisabled();
  });

  it("routes public payment actions without interpreting them as paid", async () => {
    const assign = vi.fn();
    const navigate = vi.fn();
    await followPaymentAction({ kind: "redirect", method: "afterpay", redirectUrl: "https://pay.example.test/start" }, "/orders/RNR-2026-ABC", { assign, navigate });
    expect(assign).toHaveBeenCalledWith("https://pay.example.test/start");

    await followPaymentAction({ kind: "elements", method: "card", clientSecret: "client-secret" }, "/account/orders/RNR-2026-ABC", { assign, navigate });
    expect(navigate).toHaveBeenCalledWith("/account/orders/RNR-2026-ABC#payment");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("shows pending confirmation when the start response has no immediate action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ payment: { method: "card", status: "processing", isTest: true, canRetry: false }, action: null }) }));
    render(<OrderPaymentPanel orderNumber="RNR-2026-ABC" paymentStatus="awaiting_payment" methods={methods} orderHref="/orders/RNR-2026-ABC" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay for order" }));
    await waitFor(() => expect(screen.getByText("Payment confirmation is pending")).toBeInTheDocument());
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });
});
