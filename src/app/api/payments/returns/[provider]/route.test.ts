import { describe, expect, it, vi } from "vitest";
import { PaymentServiceError } from "@/server/payments/payment-service";
import { createPaymentReturnRoute } from "./route";

const trustedOrigin = "https://shop.example.test";
const orderNumber = "RNR-2026-PAY1001";
const state = "a".repeat(64);

function request(
  provider: "stripe" | "afterpay" | "zip",
  params: Readonly<Record<string, string>>,
  origin = trustedOrigin,
) {
  const url = new URL(`/api/payments/returns/${provider}`, origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

function handler(handleReturn = vi.fn().mockResolvedValue({ orderNumber })) {
  return {
    handleReturn,
    route: createPaymentReturnRoute({ trustedOrigin, paymentService: { handleReturn } }),
  };
}

const common = { flow: "return", orderNumber, state };

describe("GET /api/payments/returns/[provider]", () => {
  it.each([
    [
      "stripe",
      { ...common, method: "card", payment_intent: "pi_persisted_123", redirect_status: "succeeded" },
      "pi_persisted_123",
    ],
    [
      "afterpay",
      { ...common, method: "afterpay", status: "SUCCESS", orderToken: "afterpay_persisted_123" },
      "afterpay_persisted_123",
    ],
    [
      "zip",
      { ...common, method: "zip", result: "Approved", checkoutId: "zip_checkout_123" },
      "zip_checkout_123",
    ],
  ] as const)("passes only strict persisted-authority inputs for %s and redirects safely", async (
    provider,
    params,
    providerReference,
  ) => {
    const { route, handleReturn } = handler();
    const incoming = request(provider, params);

    const response = await route(incoming, {
      params: Promise.resolve({ provider }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Location"))
      .toBe(`${trustedOrigin}/orders/${orderNumber}`);
    expect(response.headers.get("Location")).not.toMatch(/state|token|intent|checkout/i);
    expect(handleReturn).toHaveBeenCalledWith({
      provider,
      method: params.method,
      orderNumber,
      returnState: state,
      providerReference,
      returnUrl: new URL(incoming.url),
    });
  });

  it("accepts Stripe's optional client-secret field without forwarding it as authority", async () => {
    const { route, handleReturn } = handler();
    const incoming = request("stripe", {
      ...common,
      method: "card",
      payment_intent: "pi_persisted_123",
      payment_intent_client_secret: "pi_persisted_123_secret_private_browser_value",
      redirect_status: "processing",
    });

    expect((await route(incoming, {
      params: Promise.resolve({ provider: "stripe" }),
    })).status).toBe(303);
    expect(handleReturn).toHaveBeenCalledWith(expect.not.objectContaining({
      clientSecret: expect.anything(),
    }));
  });

  it.each([
    ["unknown provider", "unknown", request("stripe", { ...common, method: "card", payment_intent: "pi_12345678", redirect_status: "succeeded" })],
    ["path mismatch", "afterpay", request("stripe", { ...common, method: "card", payment_intent: "pi_12345678", redirect_status: "succeeded" })],
    ["untrusted origin", "stripe", request("stripe", { ...common, method: "card", payment_intent: "pi_12345678", redirect_status: "succeeded" }, "https://evil.example.test")],
  ])("returns 404 for %s before consuming state", async (_name, provider, incoming) => {
    const { route, handleReturn } = handler();
    const response = await route(incoming, {
      params: Promise.resolve({ provider }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PAYMENT_RETURN_NOT_FOUND", message: "Payment return is unavailable" },
    });
    expect(handleReturn).not.toHaveBeenCalled();
  });

  it.each([
    ["amount authority", "amount", "120.75"],
    ["currency authority", "currency", "NZD"],
    ["order id authority", "orderId", "00000000-0000-4000-8000-000000000001"],
    ["paid authority", "paid", "true"],
    ["open redirect", "returnUrl", "https://evil.example.test"],
  ])("rejects extra %s query input without consuming", async (_name, key, value) => {
    const { route, handleReturn } = handler();
    const incoming = request("afterpay", {
      ...common,
      method: "afterpay",
      status: "SUCCESS",
      orderToken: "afterpay_persisted_123",
      [key]: value,
    });

    expect((await route(incoming, {
      params: Promise.resolve({ provider: "afterpay" }),
    })).status).toBe(404);
    expect(handleReturn).not.toHaveBeenCalled();
  });

  it("rejects duplicate query keys without consuming", async () => {
    const { route, handleReturn } = handler();
    const incoming = request("afterpay", {
      ...common,
      method: "afterpay",
      status: "SUCCESS",
      orderToken: "afterpay_persisted_123",
    });
    const url = new URL(incoming.url);
    url.searchParams.append("state", "b".repeat(64));

    expect((await route(new Request(url), {
      params: Promise.resolve({ provider: "afterpay" }),
    })).status).toBe(404);
    expect(handleReturn).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong method", { ...common, method: "card", status: "SUCCESS", orderToken: "afterpay_persisted_123" }],
    ["cancel flow claiming success", { ...common, flow: "cancel", method: "afterpay", status: "SUCCESS", orderToken: "afterpay_persisted_123" }],
    ["return flow claiming cancellation", { ...common, method: "afterpay", status: "CANCELLED", orderToken: "afterpay_persisted_123" }],
    ["short state", { ...common, state: "short", method: "afterpay", status: "SUCCESS", orderToken: "afterpay_persisted_123" }],
    ["bad order", { ...common, orderNumber: "../admin", method: "afterpay", status: "SUCCESS", orderToken: "afterpay_persisted_123" }],
    ["bad status", { ...common, method: "afterpay", status: "PAID", orderToken: "afterpay_persisted_123" }],
    ["missing token", { ...common, method: "afterpay", status: "SUCCESS" }],
  ])("rejects %s before consuming", async (_name, params) => {
    const { route, handleReturn } = handler();
    expect((await route(request("afterpay", params), {
      params: Promise.resolve({ provider: "afterpay" }),
    })).status).toBe(404);
    expect(handleReturn).not.toHaveBeenCalled();
  });

  it("maps an invalid, expired or mismatched persisted state to a safe 404", async () => {
    const handleReturn = vi.fn().mockRejectedValue(new PaymentServiceError(
      "PAYMENT_RETURN_NOT_FOUND",
      "Payment return is unavailable",
    ));
    const { route } = handler(handleReturn);
    const incoming = request("zip", {
      ...common, method: "zip", result: "Approved", checkoutId: "zip_checkout_123",
    });

    const response = await route(incoming, {
      params: Promise.resolve({ provider: "zip" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PAYMENT_RETURN_NOT_FOUND", message: "Payment return is unavailable" },
    });
  });

  it("never reflects private service failures", async () => {
    const { route } = handler(vi.fn().mockRejectedValue(
      new Error("private provider response and credentials"),
    ));
    const response = await route(request("stripe", {
      ...common, method: "card", payment_intent: "pi_persisted_123", redirect_status: "failed",
    }), { params: Promise.resolve({ provider: "stripe" }) });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/private|credential|provider response/);
  });
});
