import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { AfterpayPaymentConfig } from "./config";
import {
  createAfterpayProvider,
  formatAfterpayAmount,
} from "./afterpay-provider";
import type {
  CompleteProviderReturnInput,
  CreateProviderSessionInput,
  PaymentOrder,
  PaymentTargetSnapshot,
} from "./types";

const token = "002.checkout_token_123456789";
const state = "s".repeat(64);
const idempotencyKey = "i".repeat(64);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function address(country: "NZ" | "AU" = "NZ"): NormalizedAddress {
  return Object.freeze({
    country,
    fullName: "Aroha Ngata",
    building: "Studio 2",
    street: "1 Test Street",
    suburb: country === "NZ" ? "Auckland Central" : "Sydney",
    region: country === "NZ" ? "Auckland" : "NSW",
    postcode: country === "NZ" ? "1010" : "2000",
    phone: country === "NZ" ? "+64210000000" : "+61400000000",
    email: "aroha@example.test",
  });
}

function order(country: "NZ" | "AU" = "NZ"): PaymentOrder {
  const customerAddress = address(country);
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000010",
    orderNumber: "RNR-TEST-1001",
    amountCents: 12_075,
    currency: country === "NZ" ? "NZD" : "AUD",
    customer: Object.freeze({
      fullName: customerAddress.fullName,
      email: customerAddress.email,
      phone: customerAddress.phone,
    }),
    billingAddress: customerAddress,
    deliveryAddress: Object.freeze({ ...customerAddress, building: "" }),
  });
}

function config(
  environment: "sandbox" | "production" = "sandbox",
  country: "NZ" | "AU" = "NZ",
): Extract<AfterpayPaymentConfig, { enabled: true }> {
  return Object.freeze({
    enabled: true,
    merchantId: "merchant-id",
    secretKey: "server-secret",
    environment,
    merchantCountry: country,
    currency: country === "NZ" ? "NZD" : "AUD",
  });
}

function configuration(currency: "NZD" | "AUD" = "NZD") {
  return {
    minimumAmount: { amount: "1.00", currency },
    maximumAmount: { amount: "2000.00", currency },
  };
}

function checkoutResponse(
  environment: "sandbox" | "production" = "sandbox",
  country: "NZ" | "AU" = "NZ",
) {
  const host = environment === "sandbox"
    ? "portal.sandbox.afterpay.com"
    : "portal.afterpay.com";
  return {
    token,
    redirectCheckoutUrl: `https://${host}/${country.toLowerCase()}/checkout/?token=${encodeURIComponent(token)}`,
  };
}

function capturedPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-id",
    token,
    merchantReference: "RNR-TEST-1001",
    status: "APPROVED",
    paymentState: "CAPTURED",
    originalAmount: { amount: "120.75", currency: "NZD" },
    openToCaptureAmount: { amount: "0.00", currency: "NZD" },
    ...overrides,
  };
}

function sessionInput(paymentOrder = order()): CreateProviderSessionInput {
  return Object.freeze({
    order: paymentOrder,
    attemptId: "00000000-0000-4000-8000-000000000020",
    idempotencyKey,
    returnState: state,
    returnUrl: `https://shop.example.test/api/payments/returns/afterpay?flow=return&orderNumber=${paymentOrder.orderNumber}&method=afterpay&state=${state}`,
    cancelUrl: `https://shop.example.test/api/payments/returns/afterpay?flow=cancel&orderNumber=${paymentOrder.orderNumber}&method=afterpay&state=${state}`,
  });
}

function completeInput(
  paymentOrder = order(),
  status = "SUCCESS",
): CompleteProviderReturnInput & { idempotencyKey: string } {
  return Object.freeze({
    order: paymentOrder,
    providerReference: token,
    idempotencyKey,
    attemptCreatedAt: new Date(),
    returnState: state,
    returnUrl: new URL(
      `https://shop.example.test/payments/afterpay/return?state=${state}&status=${status}&orderToken=${encodeURIComponent(token)}`,
    ),
  });
}

describe("Afterpay provider", () => {
  it("uses the fixed Payment Request reference and amount", async () => {
    const payerAddress = address();
    const target: PaymentTargetSnapshot = {
      targetKind: "payment_request",
      targetId: "request-id",
      merchantReference: "PAY-08001",
      amountCents: 20_000,
      currency: "NZD",
      customer: {
        fullName: payerAddress.fullName,
        email: payerAddress.email,
        phone: payerAddress.phone,
      },
      billingAddress: payerAddress,
      deliveryAddress: payerAddress,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configuration()))
      .mockResolvedValueOnce(jsonResponse({
        ...checkoutResponse(),
        amount: { amount: "200.00", currency: "NZD" },
        merchantReference: "PAY-08001",
      }));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });
    const input: CreateProviderSessionInput = {
      ...sessionInput(),
      order: target,
      returnUrl: `https://shop.example.test/api/payments/returns/afterpay?flow=return&orderNumber=PAY-08001&method=afterpay&state=${state}`,
      cancelUrl: `https://shop.example.test/api/payments/returns/afterpay?flow=cancel&orderNumber=PAY-08001&method=afterpay&state=${state}`,
    };

    await provider.createOrReuse(input);
    const body = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body));
    expect(body.amount).toEqual({ amount: "200.00", currency: "NZD" });
    expect(body.merchantReference).toBe("PAY-08001");
    expect(body).not.toHaveProperty("quantity");
  });

  it.each([
    [1, "0.01"],
    [100, "1.00"],
    [12_075, "120.75"],
    [100_000, "1000.00"],
  ])("formats %i cents without floating point drift", (amountCents, expected) => {
    expect(formatAfterpayAmount(amountCents)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid cent amount: %s",
    (amountCents) => {
      expect(() => formatAfterpayAmount(amountCents))
        .toThrow("Afterpay payment verification failed");
    },
  );

  it.each([
    ["sandbox", "NZ", "https://global-api-sandbox.afterpay.com", "portal.sandbox.afterpay.com"],
    ["production", "AU", "https://global-api.afterpay.com", "portal.afterpay.com"],
  ] as const)(
    "uses only the official %s environment hosts",
    async (environment, country, apiBase, portalHost) => {
      const paymentOrder = order(country);
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(configuration(paymentOrder.currency as "NZD" | "AUD")))
        .mockResolvedValueOnce(jsonResponse(checkoutResponse(environment, country)));
      const provider = createAfterpayProvider({
        config: config(environment, country),
        fetchImpl,
      });

      const session = await provider.createOrReuse(sessionInput(paymentOrder));

      expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${apiBase}/v2/configuration`);
      expect(fetchImpl.mock.calls[1]?.[0]).toBe(`${apiBase}/v2/checkouts`);
      expect(new URL(session.kind === "redirect" ? session.redirectUrl : "https://invalid.test").host)
        .toBe(portalHost);
    },
  );

  it("creates a checkout with exact money, customer, immutable addresses and trusted returns", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configuration()))
      .mockResolvedValueOnce(jsonResponse(configuration()))
      .mockResolvedValueOnce(jsonResponse({
        ...checkoutResponse(),
        amount: { amount: "120.75", currency: "NZD" },
        merchantReference: "RNR-TEST-1001",
      }));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });
    const input = sessionInput();

    await expect(provider.availability(input.order)).resolves.toEqual({ available: true });
    const session = await provider.createOrReuse(input);

    expect(session).toEqual({
      kind: "redirect",
      provider: "afterpay",
      method: "afterpay",
      providerReference: token,
      providerStatus: "CREATED",
      redirectUrl: checkoutResponse().redirectCheckoutUrl,
    });
    const checkoutCall = fetchImpl.mock.calls[2];
    expect(checkoutCall?.[0]).toBe("https://global-api-sandbox.afterpay.com/v2/checkouts");
    expect(JSON.parse(String((checkoutCall?.[1] as RequestInit).body))).toEqual({
      amount: { amount: "120.75", currency: "NZD" },
      consumer: {
        givenNames: "Aroha",
        surname: "Ngata",
        email: "aroha@example.test",
        phoneNumber: "+64210000000",
      },
      billing: {
        name: "Aroha Ngata",
        line1: "Studio 2",
        line2: "1 Test Street",
        area1: "Auckland Central",
        region: "Auckland",
        postcode: "1010",
        countryCode: "NZ",
        phoneNumber: "+64210000000",
      },
      shipping: {
        name: "Aroha Ngata",
        line1: "1 Test Street",
        area1: "Auckland Central",
        region: "Auckland",
        postcode: "1010",
        countryCode: "NZ",
        phoneNumber: "+64210000000",
      },
      merchant: {
        redirectConfirmUrl: input.returnUrl,
        redirectCancelUrl: input.cancelUrl,
      },
      merchantReference: "RNR-TEST-1001",
    });
    expect(Object.isFrozen(input.order.billingAddress)).toBe(true);
    expect(input.order.billingAddress).toEqual(address());
  });

  it("sends the authoritative stored Australian Banner Bundle total in AUD", async () => {
    const australianOrder = Object.freeze({
      ...order("AU"),
      amountCents: 33_999,
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configuration("AUD")))
      .mockResolvedValueOnce(jsonResponse({
        ...checkoutResponse("sandbox", "AU"),
        amount: { amount: "339.99", currency: "AUD" },
        merchantReference: australianOrder.orderNumber,
      }));
    const provider = createAfterpayProvider({
      config: config("sandbox", "AU"),
      fetchImpl,
    });

    await expect(provider.createOrReuse(sessionInput(australianOrder)))
      .resolves.toMatchObject({ providerReference: token });
    const request = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      amount: { amount: "339.99", currency: "AUD" },
      merchantReference: australianOrder.orderNumber,
    });
  });

  it("enforces remote inclusive limits before checkout", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configuration()))
      .mockResolvedValueOnce(jsonResponse(configuration()));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });

    await expect(provider.availability({ ...order(), amountCents: 99 }))
      .resolves.toEqual({ available: false, reason: "amount" });
    await expect(provider.createOrReuse(sessionInput({ ...order(), amountCents: 200_001 })))
      .rejects.toThrow("Afterpay payment verification failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["wrong portal", { ...checkoutResponse(), redirectCheckoutUrl: `https://evil.example.test/checkout?token=${token}` }],
    ["token mismatch", { ...checkoutResponse(), redirectCheckoutUrl: "https://portal.sandbox.afterpay.com/nz/checkout?token=other-token" }],
    ["amount mismatch", { ...checkoutResponse(), amount: { amount: "120.76", currency: "NZD" } }],
    ["currency mismatch", { ...checkoutResponse(), amount: { amount: "120.75", currency: "AUD" } }],
    ["reference mismatch", { ...checkoutResponse(), merchantReference: "RNR-OTHER" }],
  ])("rejects an untrusted checkout response: %s", async (_name, response) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configuration()))
      .mockResolvedValueOnce(jsonResponse(response));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });

    await expect(provider.createOrReuse(sessionInput()))
      .rejects.toThrow("Afterpay payment verification failed");
  });

  it("treats browser SUCCESS only as authority to capture server-side", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(capturedPayment()));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });

    await expect(provider.completeReturn(completeInput())).resolves.toEqual({
      providerReference: token,
      providerStatus: "APPROVED:CAPTURED",
      amountCents: 12_075,
      currency: "NZD",
      orderNumber: "RNR-TEST-1001",
      status: "paid",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0])
      .toBe("https://global-api-sandbox.afterpay.com/v2/payments/capture");
    const capture = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
    expect(capture).toMatchObject({
      token,
      merchantReference: "RNR-TEST-1001",
      amount: { amount: "120.75", currency: "NZD" },
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    });
  });

  it.each([
    ["token", { token: "002.different" }],
    ["merchant reference", { merchantReference: "RNR-OTHER" }],
    ["amount", { originalAmount: { amount: "120.74", currency: "NZD" } }],
    ["currency", { originalAmount: { amount: "120.75", currency: "AUD" } }],
  ])("rejects an independently mismatched captured %s", async (_name, mismatch) => {
    const provider = createAfterpayProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(capturedPayment(mismatch))),
    });

    await expect(provider.completeReturn(completeInput()))
      .rejects.toThrow("Afterpay payment verification failed");
  });

  it.each([
    [capturedPayment({ openToCaptureAmount: { amount: "1.00", currency: "NZD" } }), "processing"],
    [capturedPayment({ paymentState: "AUTH_APPROVED" }), "processing"],
    [capturedPayment({ status: "DECLINED", paymentState: "DECLINED" }), "failed"],
  ] as const)("maps non-terminal authority conservatively to %s", async (response, expectedStatus) => {
    const provider = createAfterpayProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(response)),
    });

    await expect(provider.completeReturn(completeInput()))
      .resolves.toMatchObject({ status: expectedStatus });
  });

  it("treats an official cancellation with authoritative absence as cancelled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });

    await expect(provider.completeReturn(completeInput(order(), "CANCELLED")))
      .resolves.toMatchObject({
        providerReference: token,
        providerStatus: "CANCELLED:NOT_FOUND",
        status: "cancelled",
      });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/v2/payments/token/");
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe("GET");
  });

  it.each([
    ["cancelled", capturedPayment({ status: "CANCELLED", paymentState: "CANCELLED" }), "cancelled"],
    ["paid", capturedPayment(), "paid"],
    ["failed", capturedPayment({ status: "DECLINED", paymentState: "DECLINED" }), "failed"],
    ["processing", capturedPayment({ paymentState: "AUTH_APPROVED" }), "processing"],
  ] as const)(
    "uses provider authority, not browser cancellation, for %s",
    async (_name, response, expectedStatus) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(response));
      const provider = createAfterpayProvider({ config: config(), fetchImpl });

      await expect(provider.completeReturn(completeInput(order(), "CANCELLED")))
        .resolves.toMatchObject({ status: expectedStatus });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe("GET");
    },
  );

  it("reports only a 404 retrieval as authoritative absence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });

    await expect(provider.retrieve({ order: order(), providerReference: token }))
      .resolves.toEqual({ kind: "authoritative_not_found" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("captures only after authoritative absence and reuses the stable request ID", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse(capturedPayment()))
      .mockResolvedValueOnce(jsonResponse(capturedPayment()));
    const provider = createAfterpayProvider({ config: config(), fetchImpl });

    await expect(provider.retryCompletion?.({
      order: order(),
      providerReference: token,
      idempotencyKey,
      attemptCreatedAt: new Date(),
      source: "reconciliation",
    })).resolves.toMatchObject({ status: "paid" });
    await provider.completeReturn(completeInput());

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://global-api-sandbox.afterpay.com/v2/payments/token/${encodeURIComponent(token)}`,
    );
    const retryCapture = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body));
    const returnCapture = JSON.parse(String((fetchImpl.mock.calls[2]?.[1] as RequestInit).body));
    expect(retryCapture.requestId).toBe(returnCapture.requestId);
  });

  it.each([
    ["authorized", capturedPayment({ paymentState: "AUTH_APPROVED" }), "processing"],
    ["partially captured", capturedPayment({
      paymentState: "PARTIALLY_CAPTURED",
      openToCaptureAmount: { amount: "50.00", currency: "NZD" },
    }), "processing"],
    ["captured with open amount", capturedPayment({
      openToCaptureAmount: { amount: "1.00", currency: "NZD" },
    }), "processing"],
    ["unknown", capturedPayment({ status: "PENDING", paymentState: "UNKNOWN" }), "processing"],
    ["paid", capturedPayment(), "paid"],
    ["declined", capturedPayment({ status: "DECLINED", paymentState: "DECLINED" }), "failed"],
    ["cancelled", capturedPayment({ status: "CANCELLED", paymentState: "CANCELLED" }), "cancelled"],
  ] as const)(
    "never captures after reconciliation finds %s authority",
    async (_name, response, expectedStatus) => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(response));
      const provider = createAfterpayProvider({ config: config(), fetchImpl });

      await expect(provider.retryCompletion?.({
        order: order(),
        providerReference: token,
        idempotencyKey,
        attemptCreatedAt: new Date(),
        source: "reconciliation",
      })).resolves.toMatchObject({ status: expectedStatus });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe("GET");
    },
  );

  it.each([
    ["timeout", () => Promise.reject(new Error("server-secret timeout"))],
    ["provider 5xx", () => Promise.resolve(jsonResponse({ error: "server-secret" }, 503))],
    ["invalid response", () => Promise.resolve(jsonResponse({ unsafe: "server-secret" }))],
  ] as const)(
    "does not capture after an ambiguous retrieval %s",
    async (_name, responseFactory) => {
      const fetchImpl = vi.fn((
        request: string | URL | Request,
        init?: RequestInit,
      ) => {
        void request;
        void init;
        return responseFactory();
      });
      const provider = createAfterpayProvider({ config: config(), fetchImpl });

      await expect(provider.retryCompletion?.({
        order: order(),
        providerReference: token,
        idempotencyKey,
        attemptCreatedAt: new Date(),
        source: "reconciliation",
      })).rejects.toThrow("Afterpay payment request failed");
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe("GET");
    },
  );

  it("redacts credentials and response bodies from request failures", async () => {
    const provider = createAfterpayProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(new Response("server-secret body", {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })),
    });

    const error = await provider.availability(order()).catch((caught) => caught);
    expect(String(error)).toBe("Error: Afterpay payment request failed");
    expect(String(error)).not.toMatch(/server-secret|body|401/);
  });
});
