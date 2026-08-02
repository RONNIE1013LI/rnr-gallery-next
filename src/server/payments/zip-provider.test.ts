import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { ZipPaymentConfig } from "./config";
import { createZipProvider, formatZipAmount } from "./zip-provider";
import type {
  CompleteProviderReturnInput,
  CreateProviderSessionInput,
  PaymentOrder,
} from "./types";

const checkoutId = "co_P9GOgSVE9qMnL0VA6Jy8z6";
const state = "z".repeat(64);
const idempotencyKey = "k".repeat(64);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function address(country: "AU" | "NZ" = "AU"): NormalizedAddress {
  return Object.freeze({
    country,
    fullName: "Aroha Ngata",
    building: "Unit 2",
    street: "10 Test Street",
    suburb: country === "AU" ? "Sydney" : "Auckland Central",
    region: country === "AU" ? "NSW" : "Auckland",
    postcode: country === "AU" ? "2000" : "1010",
    phone: country === "AU" ? "+61400000000" : "+64210000000",
    email: "aroha@example.test",
  });
}

function order(
  currency: PaymentOrder["currency"] = "AUD",
  billingCountry: "AU" | "NZ" = "AU",
  deliveryCountry: "AU" | "NZ" = "AU",
): PaymentOrder {
  const billingAddress = address(billingCountry);
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000110",
    orderNumber: "RNR-AU-1001",
    amountCents: 12_075,
    currency,
    customer: Object.freeze({
      fullName: billingAddress.fullName,
      email: billingAddress.email,
      phone: billingAddress.phone,
    }),
    billingAddress,
    deliveryAddress: Object.freeze({ ...address(deliveryCountry), building: "" }),
  });
}

function config(
  environment: "sandbox" | "production" = "sandbox",
): Extract<ZipPaymentConfig, { enabled: true }> {
  return Object.freeze({
    enabled: true,
    apiKey: "zip-server-secret",
    environment,
    merchantCountry: "AU",
    allowedCurrencies: Object.freeze(["AUD", "USD", "CAD"] as const),
  });
}

function checkoutResponse(
  overrides: Record<string, unknown> = {},
  environment: "sandbox" | "production" = "sandbox",
) {
  const host = environment === "sandbox"
    ? "account.sandbox.zipmoney.com.au"
    : "account.zipmoney.com.au";
  return {
    id: checkoutId,
    uri: `https://${host}/?co=${encodeURIComponent(checkoutId)}&m=merchant`,
    type: "standard",
    state: "created",
    order: {
      reference: "RNR-AU-1001",
      amount: 120.75,
      currency: "AUD",
    },
    ...overrides,
  };
}

function checkoutAuthority(
  checkoutState: string,
  overrides: Record<string, unknown> = {},
) {
  return checkoutResponse({ state: checkoutState, ...overrides });
}

function chargeResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch_AKS81QxsiKUSnr281pX7z4",
    amount: 120.75,
    captured_amount: 120.75,
    currency: "AUD",
    state: "captured",
    metadata: { order_number: "RNR-AU-1001" },
    ...overrides,
  };
}

function sessionInput(paymentOrder = order()): CreateProviderSessionInput {
  return Object.freeze({
    order: paymentOrder,
    attemptId: "00000000-0000-4000-8000-000000000120",
    idempotencyKey,
    returnState: state,
    returnUrl: `https://shop.example.test/api/payments/returns/zip?flow=return&orderNumber=${paymentOrder.orderNumber}&method=zip&state=${state}`,
    cancelUrl: `https://shop.example.test/api/payments/returns/zip?flow=cancel&orderNumber=${paymentOrder.orderNumber}&method=zip&state=${state}`,
  });
}

function completeInput(
  result = "Approved",
  attemptCreatedAt = new Date(),
): CompleteProviderReturnInput {
  return Object.freeze({
    order: order(),
    providerReference: checkoutId,
    idempotencyKey,
    attemptCreatedAt,
    returnState: state,
    returnUrl: new URL(
      `https://shop.example.test/api/payments/returns/zip?state=${state}&result=${result}&checkoutId=${encodeURIComponent(checkoutId)}`,
    ),
  });
}

describe("Zip AU provider", () => {
  it.each([
    [1, 0.01],
    [100, 1],
    [12_075, 120.75],
    [100_000, 1000],
  ])("formats %i cents as the exact Zip JSON amount", (amountCents, expected) => {
    expect(formatZipAmount(amountCents)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid cents before a request: %s",
    (amountCents) => {
      expect(() => formatZipAmount(amountCents))
        .toThrow("Zip payment verification failed");
    },
  );

  it.each([
    ["NZD", "AU", "AU", "currency"],
    ["AUD", "NZ", "AU", "country"],
    ["AUD", "AU", "NZ", "country"],
  ] as const)(
    "fails closed before network for %s with %s/%s addresses",
    async (currency, billingCountry, deliveryCountry, reason) => {
      const fetchImpl = vi.fn();
      const provider = createZipProvider({ config: config(), fetchImpl });
      const paymentOrder = order(currency, billingCountry, deliveryCountry);

      await expect(provider.availability(paymentOrder)).resolves.toEqual({
        available: false,
        reason,
      });
      await expect(provider.createOrReuse(sessionInput(paymentOrder)))
        .rejects.toThrow("Zip payment verification failed");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("fails closed before network for invalid or disallowed amounts and currencies", async () => {
    const fetchImpl = vi.fn();
    const provider = createZipProvider({
      config: Object.freeze({ ...config(), allowedCurrencies: ["AUD"] as const }),
      fetchImpl,
    });

    await expect(provider.availability({ ...order(), amountCents: 0 }))
      .resolves.toEqual({ available: false, reason: "amount" });
    await expect(provider.availability(order("USD")))
      .resolves.toEqual({ available: false, reason: "currency" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["sandbox", "https://sand.merchant-api.com/merchant", "account.sandbox.zipmoney.com.au"],
    ["production", "https://merchant-api.com/merchant", "account.zipmoney.com.au"],
  ] as const)(
    "uses only official %s API and redirect hosts",
    async (environment, apiBase, redirectHost) => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse(checkoutResponse({}, environment)),
      );
      const provider = createZipProvider({ config: config(environment), fetchImpl });

      const session = await provider.createOrReuse(sessionInput());

      expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${apiBase}/checkouts`);
      expect(new URL(session.kind === "redirect" ? session.redirectUrl : "https://invalid.test").host)
        .toBe(redirectHost);
    },
  );

  it("creates an exact AU checkout with Bearer auth, stable headers and official fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(checkoutResponse()))
      .mockResolvedValueOnce(jsonResponse(checkoutResponse()));
    const provider = createZipProvider({ config: config(), fetchImpl });
    const input = sessionInput();

    const first = await provider.createOrReuse(input);
    const second = await provider.createOrReuse(input);

    expect(first).toEqual(second);
    expect(first).toEqual({
      kind: "redirect",
      provider: "zip",
      method: "zip",
      providerReference: checkoutId,
      providerStatus: "created",
      redirectUrl: checkoutResponse().uri,
    });
    const request = fetchImpl.mock.calls[0];
    expect(request?.[0]).toBe("https://sand.merchant-api.com/merchant/checkouts");
    expect((request?.[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer zip-server-secret",
      "Zip-Version": "2021-08-25",
      "Idempotency-Key": expect.any(String),
    });
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).headers)
      .toMatchObject({
        "Idempotency-Key": ((request?.[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"],
      });
    expect(JSON.parse(String((request?.[1] as RequestInit).body))).toEqual({
      type: "standard",
      shopper: {
        first_name: "Aroha",
        last_name: "Ngata",
        email: "aroha@example.test",
        phone: "+61400000000",
        billing_address: {
          first_name: "Aroha",
          last_name: "Ngata",
          line1: "Unit 2",
          line2: "10 Test Street",
          city: "Sydney",
          state: "NSW",
          postal_code: "2000",
          country: "AU",
        },
      },
      order: {
        reference: "RNR-AU-1001",
        amount: 120.75,
        currency: "AUD",
        shipping: {
          pickup: false,
          address: {
            line1: "10 Test Street",
            city: "Sydney",
            state: "NSW",
            postal_code: "2000",
            country: "AU",
          },
        },
      },
      metadata: { order_number: "RNR-AU-1001" },
      config: { redirect_uri: input.returnUrl },
    });
  });

  it.each([
    ["checkout id", { id: "wrong_checkout" }],
    ["redirect host", { uri: `https://evil.example.test/?co=${checkoutId}` }],
    ["redirect checkout", { uri: "https://account.sandbox.zipmoney.com.au/?co=other" }],
    ["state", { state: "" }],
    ["order reference", { order: { reference: "RNR-OTHER", amount: 120.75, currency: "AUD" } }],
    ["order amount", { order: { reference: "RNR-AU-1001", amount: 120.76, currency: "AUD" } }],
    ["order currency", { order: { reference: "RNR-AU-1001", amount: 120.75, currency: "USD" } }],
  ])("rejects a mismatched checkout %s", async (_name, mismatch) => {
    const provider = createZipProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(checkoutResponse(mismatch))),
    });

    await expect(provider.createOrReuse(sessionInput()))
      .rejects.toThrow("Zip payment verification failed");
  });

  it("uses browser approval only to retrieve and then charge exact server authority", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(checkoutAuthority("approved")))
      .mockResolvedValueOnce(jsonResponse(chargeResponse()));
    const provider = createZipProvider({ config: config(), fetchImpl });

    await expect(provider.completeReturn(completeInput())).resolves.toEqual({
      providerReference: checkoutId,
      providerStatus: "CHARGE:captured",
      amountCents: 12_075,
      currency: "AUD",
      orderNumber: "RNR-AU-1001",
      status: "paid",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0])
      .toBe(`https://sand.merchant-api.com/merchant/checkouts/${checkoutId}`);
    expect(fetchImpl.mock.calls[1]?.[0])
      .toBe("https://sand.merchant-api.com/merchant/charges");
    expect(JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body)))
      .toEqual({
        authority: { type: "checkout_id", value: checkoutId },
        reference: "RNR-AU-1001",
        amount: 120.75,
        currency: "AUD",
        capture: true,
      });
    const chargeHeaders = (fetchImpl.mock.calls[1]?.[1] as RequestInit)
      .headers as Record<string, string>;
    const chargeKey = chargeHeaders["Idempotency-Key"];
    expect(chargeKey).toEqual(expect.any(String));
    expect(chargeHeaders).toMatchObject({
      Authorization: "Bearer zip-server-secret",
      "Zip-Version": "2021-08-25",
    });
  });

  it("uses browser Referred only to retrieve authoritative state and never charges", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(checkoutAuthority("referred")),
    );
    const provider = createZipProvider({ config: config(), fetchImpl });

    await expect(provider.completeReturn(completeInput("Referred"))).resolves.toEqual({
      providerReference: checkoutId,
      providerStatus: "CHECKOUT:referred",
      amountCents: 12_075,
      currency: "AUD",
      orderNumber: "RNR-AU-1001",
      status: "failed",
      sanitizedFailureCode: "declined",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://sand.merchant-api.com/merchant/checkouts/${checkoutId}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl.mock.calls.map(([url]) => String(url)))
      .not.toContain("https://sand.merchant-api.com/merchant/charges");
  });

  it.each([
    ["metadata", { metadata: { order_number: "RNR-OTHER" } }],
    ["amount", { amount: 120.76 }],
    ["currency", { currency: "USD" }],
    ["state", { state: "" }],
  ])("rejects an independently mismatched charge %s", async (_name, mismatch) => {
    const provider = createZipProvider({
      config: config(),
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(jsonResponse(checkoutAuthority("approved")))
        .mockResolvedValueOnce(jsonResponse(chargeResponse(mismatch))),
    });

    await expect(provider.completeReturn(completeInput()))
      .rejects.toThrow("Zip payment verification failed");
  });

  it.each([
    [chargeResponse({ captured_amount: 100 }), "processing"],
    [chargeResponse({ state: "approved" }), "processing"],
    [chargeResponse({ state: "authorised" }), "processing"],
    [chargeResponse({ state: "CAPTURED" }), "paid"],
    [chargeResponse({ state: "declined", captured_amount: 0 }), "failed"],
    [chargeResponse({ state: "referred", captured_amount: 0 }), "failed"],
    [chargeResponse({ state: "expired", captured_amount: 0 }), "cancelled"],
    [chargeResponse({ state: "cancelled", captured_amount: 0 }), "cancelled"],
    [chargeResponse({ state: "unknown", captured_amount: 0 }), "processing"],
  ] as const)("maps a provider charge conservatively to %s", async (response, expectedStatus) => {
    const provider = createZipProvider({
      config: config(),
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(jsonResponse(checkoutAuthority("approved")))
        .mockResolvedValueOnce(jsonResponse(response)),
    });

    await expect(provider.completeReturn(completeInput()))
      .resolves.toMatchObject({ status: expectedStatus });
  });

  it.each([
    ["completed", "Declined", "paid"],
    ["approved", "Declined", "processing"],
    ["created", "Approved", "processing"],
    ["expired", "Approved", "cancelled"],
    ["cancelled", "Approved", "cancelled"],
  ] as const)(
    "uses checkout state %s conservatively for browser %s",
    async (checkoutState, browserResult, expectedStatus) => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(checkoutAuthority(checkoutState)),
      );
      const provider = createZipProvider({ config: config(), fetchImpl });

      await expect(provider.completeReturn(completeInput(browserResult)))
        .resolves.toMatchObject({ status: expectedStatus });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("reports only a 404 checkout retrieval as authoritative absence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    const provider = createZipProvider({ config: config(), fetchImpl });

    await expect(provider.retrieve({ order: order(), providerReference: checkoutId }))
      .resolves.toEqual({ kind: "authoritative_not_found" });
    await expect(provider.completeReturn(completeInput()))
      .resolves.toMatchObject({ providerStatus: "NOT_FOUND", status: "processing" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a validated approved checkout as authoritative charge not received", async () => {
    const provider = createZipProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(checkoutAuthority("approved"))),
    });

    await expect(provider.retrieve({ order: order(), providerReference: checkoutId }))
      .resolves.toEqual({ kind: "authoritative_not_received" });
  });

  it("treats a validated completed AUD checkout as captured authority", async () => {
    const provider = createZipProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(checkoutAuthority("completed"))),
    });

    await expect(provider.retrieve({ order: order(), providerReference: checkoutId }))
      .resolves.toMatchObject({
        kind: "verified",
        result: {
          providerReference: checkoutId,
          providerStatus: "CHECKOUT:completed",
          amountCents: order().amountCents,
          currency: "AUD",
          orderNumber: order().orderNumber,
          status: "paid",
        },
      });
  });

  it.each([
    ["created", "processing"],
    ["completed", "paid"],
    ["expired", "cancelled"],
    ["cancelled", "cancelled"],
    ["unknown", "processing"],
  ] as const)(
    "never charges retry after authoritative checkout %s",
    async (checkoutState, expectedStatus) => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        jsonResponse(checkoutAuthority(checkoutState)),
      );
      const provider = createZipProvider({ config: config(), fetchImpl });

      await expect(provider.retryCompletion?.({
        order: order(),
        providerReference: checkoutId,
        idempotencyKey,
        attemptCreatedAt: new Date(),
        source: "reconciliation",
      })).resolves.toMatchObject({ status: expectedStatus });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("retries a server-approved checkout with the same stable charge key", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(checkoutAuthority("approved")))
      .mockResolvedValueOnce(jsonResponse(chargeResponse()))
      .mockResolvedValueOnce(jsonResponse(checkoutAuthority("approved")))
      .mockResolvedValueOnce(jsonResponse(chargeResponse()));
    const provider = createZipProvider({ config: config(), fetchImpl });

    const retryInput = {
      order: order(),
      providerReference: checkoutId,
      idempotencyKey,
      attemptCreatedAt: new Date(),
      source: "reconciliation" as const,
    };
    await provider.retryCompletion?.(retryInput);
    await provider.retryCompletion?.(retryInput);

    const firstKey = (fetchImpl.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    const secondKey = (fetchImpl.mock.calls[3]?.[1] as RequestInit).headers as Record<string, string>;
    expect(firstKey["Idempotency-Key"]).toBe(secondKey["Idempotency-Key"]);
  });

  it.each([
    ["timeout", () => Promise.reject(new Error("zip-server-secret timeout"))],
    ["provider 5xx", () => Promise.resolve(jsonResponse({ error: "zip-server-secret" }, 503))],
    ["invalid response", () => Promise.resolve(jsonResponse({ unsafe: "zip-server-secret" }))],
  ] as const)("does not charge an ambiguous retry %s", async (_name, responseFactory) => {
    const fetchImpl = vi.fn((request: string | URL | Request, init?: RequestInit) => {
      void request;
      void init;
      return responseFactory();
    });
    const provider = createZipProvider({ config: config(), fetchImpl });

    await expect(provider.retryCompletion?.({
      order: order(),
      providerReference: checkoutId,
      idempotencyKey,
      attemptCreatedAt: new Date(),
      source: "reconciliation",
    })).rejects.toThrow("Zip payment request failed");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("redacts credentials and provider bodies", async () => {
    const provider = createZipProvider({
      config: config(),
      fetchImpl: vi.fn().mockResolvedValue(new Response("zip-server-secret body", {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })),
    });

    const error = await provider.createOrReuse(sessionInput()).catch((caught) => caught);
    expect(String(error)).toBe("Error: Zip payment request failed");
    expect(String(error)).not.toMatch(/zip-server-secret|body|401/);
  });

  it("allows a charge at the exact server-side 15-minute boundary", async () => {
    const createdAt = new Date("2026-08-03T00:00:00.000Z");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(checkoutAuthority("approved")))
      .mockResolvedValueOnce(jsonResponse(chargeResponse()));
    const provider = createZipProvider({
      config: config(),
      fetchImpl,
      now: () => new Date("2026-08-03T00:15:00.000Z"),
    });

    await expect(provider.completeReturn(completeInput("Approved", createdAt)))
      .resolves.toMatchObject({ status: "paid" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["outside 15 minutes", new Date("2026-08-03T00:00:00.000Z"), new Date("2026-08-03T00:15:00.001Z")],
    ["future attempt", new Date("2026-08-03T00:00:00.001Z"), new Date("2026-08-03T00:00:00.000Z")],
    ["invalid attempt", new Date(Number.NaN), new Date("2026-08-03T00:00:00.000Z")],
  ])("never charges completion with an %s timestamp", async (_name, createdAt, currentTime) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(checkoutAuthority("approved")),
    );
    const provider = createZipProvider({
      config: config(),
      fetchImpl,
      now: () => currentTime,
    });

    await expect(provider.completeReturn(completeInput("Approved", createdAt)))
      .resolves.toMatchObject({ status: "processing" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("never charges completion without a persisted attempt timestamp", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(checkoutAuthority("approved")),
    );
    const provider = createZipProvider({ config: config(), fetchImpl });
    const unprovenInput: Record<string, unknown> = { ...completeInput() };
    Reflect.deleteProperty(unprovenInput, "attemptCreatedAt");

    await expect(provider.completeReturn(unprovenInput as CompleteProviderReturnInput))
      .resolves.toMatchObject({ status: "processing" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("never charges reconciliation outside the 15-minute window", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(checkoutAuthority("approved")),
    );
    const provider = createZipProvider({
      config: config(),
      fetchImpl,
      now: () => new Date("2026-08-03T00:15:00.001Z"),
    });

    await expect(provider.retryCompletion?.({
      order: order(),
      providerReference: checkoutId,
      idempotencyKey,
      attemptCreatedAt: new Date("2026-08-03T00:00:00.000Z"),
      source: "reconciliation",
    })).resolves.toMatchObject({ status: "processing" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
