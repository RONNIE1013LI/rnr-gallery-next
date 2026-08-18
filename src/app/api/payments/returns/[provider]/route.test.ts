import { describe, expect, it, vi } from "vitest";
import { PaymentServiceError } from "@/server/payments/payment-service";
import { createPaymentReturnRoute } from "./route-handler";

const trustedOrigin = "https://shop.example.test";
const orderNumber = "RNR-2026-PAY1001";
const state = "a".repeat(64);

function request(
  provider: "stripe" | "afterpay" | "zip" | "local-test",
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
  it("returns a Payment Request callback to the same public token page", async () => {
    const paymentToken = "A".repeat(43);
    const handleReturn = vi.fn().mockResolvedValue({ paymentToken });
    const route = createPaymentReturnRoute({
      trustedOrigin,
      paymentService: { handleReturn },
    });
    const incoming = request("afterpay", {
      flow: "return",
      orderNumber: "PAY-08001",
      state,
      method: "afterpay",
      paymentToken,
      status: "SUCCESS",
      orderToken: "afterpay_request_123",
    });

    const response = await route(incoming, {
      params: Promise.resolve({ provider: "afterpay" }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location"))
      .toBe(`${trustedOrigin}/pay/${paymentToken}`);
    expect(handleReturn).toHaveBeenCalledWith(expect.objectContaining({
      orderNumber: "PAY-08001",
      paymentToken,
    }));
  });

  it("completes a strict local-test return and redirects to the created order", async () => {
    const { route, handleReturn } = handler();
    const providerReference = "local-test.v1.card.00000000-0000-4000-8000-000000000001.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const incoming = request("local-test", {
      ...common,
      method: "card",
      provider: "local-test",
      providerReference,
    });

    const response = await route(incoming, {
      params: Promise.resolve({ provider: "local-test" }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`${trustedOrigin}/orders/${orderNumber}`);
    expect(handleReturn).toHaveBeenCalledWith({
      provider: "local-test",
      method: "card",
      orderNumber,
      returnState: state,
      providerReference,
      returnUrl: new URL(incoming.url),
    });
  });

  it("accepts a trusted public host when the framework exposes its internal bind origin", async () => {
    const { route, handleReturn } = handler();
    const providerReference = "local-test.v1.card.00000000-0000-4000-8000-000000000001.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const internal = request("local-test", {
      ...common,
      method: "card",
      provider: "local-test",
      providerReference,
    }, "http://0.0.0.0:3000");
    const incoming = new Request(internal, {
      headers: {
        Host: "shop.example.test",
        "X-Forwarded-Proto": "https",
      },
    });

    const response = await route(incoming, {
      params: Promise.resolve({ provider: "local-test" }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`${trustedOrigin}/orders/${orderNumber}`);
    expect(handleReturn).toHaveBeenCalledWith(expect.objectContaining({
      returnUrl: new URL(new URL(internal.url).pathname + new URL(internal.url).search, trustedOrigin),
    }));
  });

  it.each([
    ["missing reference", { ...common, method: "card", provider: "local-test" }],
    ["wrong provider marker", { ...common, method: "card", provider: "stripe", providerReference: "local-test.reference" }],
    ["unknown method", { ...common, method: "cash", provider: "local-test", providerReference: "local-test.reference" }],
    ["cancel flow", { ...common, flow: "cancel", method: "card", provider: "local-test", providerReference: "local-test.reference" }],
  ])("rejects a local-test return with %s before consuming state", async (_name, params) => {
    const { route, handleReturn } = handler();
    const response = await route(request("local-test", params), {
      params: Promise.resolve({ provider: "local-test" }),
    });

    expect(response.status).toBe(404);
    expect(handleReturn).not.toHaveBeenCalled();
  });

  it("fails a local-test return closed when the provider is not registered", async () => {
    const handleReturn = vi.fn().mockRejectedValue(new PaymentServiceError(
      "PAYMENT_RETURN_NOT_FOUND",
      "Payment return is unavailable",
    ));
    const { route } = handler(handleReturn);
    const response = await route(request("local-test", {
      ...common,
      method: "afterpay",
      provider: "local-test",
      providerReference: "local-test.reference",
    }), { params: Promise.resolve({ provider: "local-test" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PAYMENT_RETURN_NOT_FOUND", message: "Payment return is unavailable" },
    });
  });

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

  it("accepts an Afterpay cancellation for a numeric production order number", async () => {
    const numericOrderNumber = "08000";
    const handleReturn = vi.fn().mockResolvedValue({
      orderNumber: numericOrderNumber,
    });
    const route = createPaymentReturnRoute({
      trustedOrigin,
      paymentService: { handleReturn },
    });
    const incoming = request("afterpay", {
      ...common,
      flow: "cancel",
      orderNumber: numericOrderNumber,
      method: "afterpay",
      status: "CANCELLED",
      orderToken: "afterpay_persisted_123",
    });

    const response = await route(incoming, {
      params: Promise.resolve({ provider: "afterpay" }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location"))
      .toBe(`${trustedOrigin}/orders/${numericOrderNumber}`);
    expect(handleReturn).toHaveBeenCalledWith(expect.objectContaining({
      orderNumber: numericOrderNumber,
    }));
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

  it("rejects duplicate Zip result values before consuming", async () => {
    const { route, handleReturn } = handler();
    const incoming = request("zip", {
      ...common, method: "zip", result: "Approved", checkoutId: "zip_checkout_123",
    });
    const url = new URL(incoming.url);
    url.searchParams.append("result", "Referred");

    expect((await route(new Request(url), {
      params: Promise.resolve({ provider: "zip" }),
    })).status).toBe(404);
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
    ["cancel result", { ...common, flow: "cancel", method: "zip", result: "Cancelled", checkoutId: "zip_checkout_123" }],
    ["cancelled on return", { ...common, method: "zip", result: "Cancelled", checkoutId: "zip_checkout_123" }],
    ["lower-case referred", { ...common, method: "zip", result: "referred", checkoutId: "zip_checkout_123" }],
    ["upper-case approved", { ...common, method: "zip", result: "APPROVED", checkoutId: "zip_checkout_123" }],
  ])("rejects Zip %s before consuming", async (_name, params) => {
    const { route, handleReturn } = handler();
    expect((await route(request("zip", params), {
      params: Promise.resolve({ provider: "zip" }),
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
