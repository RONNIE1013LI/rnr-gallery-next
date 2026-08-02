import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { ReviewedPaymentCheckoutRepository } from "@/server/checkout/checkout-repository";
import type { PaymentAttemptRecord, PaymentRepository } from "./payment-repository";
import { createPaymentService, PaymentServiceError } from "./payment-service";
import type { PaymentProviderRegistration } from "./provider-registry";
import type { PaymentOrder, PaymentProvider, VerifiedProviderEvent } from "./types";

const address: NormalizedAddress = {
  country: "NZ", fullName: "Test Customer", building: "",
  street: "1 Test Street", suburb: "Auckland Central", region: "Auckland",
  postcode: "1010", phone: "+64210000000", email: "customer@example.test",
};
const order: PaymentOrder = {
  id: "00000000-0000-4000-8000-000000000010",
  orderNumber: "RNR-2026-PAY1001",
  amountCents: 12_075,
  currency: "NZD",
  customer: { fullName: address.fullName, email: address.email, phone: address.phone },
  billingAddress: address,
  deliveryAddress: address,
};
const access = {
  kind: "guest" as const,
  orderNumber: order.orderNumber,
  tokenDigest: "guest-token-digest",
};
const browserKey = "10000000-0000-4000-8000-000000000001";
const attempt: PaymentAttemptRecord = {
  id: "20000000-0000-4000-8000-000000000001",
  orderId: order.id,
  provider: "local-test",
  method: "card",
  idempotencyKey: "a".repeat(64),
  providerReference: null,
  returnStateDigest: null,
  returnStateConsumedAt: null,
  expectedAmountCents: order.amountCents,
  currency: "NZD",
  country: "NZ",
  status: "created",
  sanitizedFailureCode: null,
  createdAt: new Date("2026-08-02T00:00:00.000Z"),
  updatedAt: new Date("2026-08-02T00:00:00.000Z"),
};

function provider(method: PaymentMethodKey = "card"): PaymentProvider {
  return {
    key: "local-test",
    method,
    refundCapability: "unsupported",
    availability: vi.fn().mockResolvedValue({ available: true }),
    createOrReuse: vi.fn().mockImplementation(async (input) => {
      const url = new URL(input.returnUrl);
      return {
        kind: "test" as const,
        provider: "local-test" as const,
        method,
        providerReference: `local-${method}-reference`,
        providerStatus: "TEST_REQUIRES_ACTION",
        url: url.toString(),
      };
    }),
    completeReturn: vi.fn(),
    retrieve: vi.fn(),
  };
}

function registration(paymentProvider = provider()): PaymentProviderRegistration {
  return {
    method: paymentProvider.method,
    label: paymentProvider.method === "card"
      ? "Test card — no real payment"
      : "Test Afterpay — no real payment",
    isTest: true,
    provider: paymentProvider,
  };
}

function repository(overrides: Partial<PaymentRepository> = {}): PaymentRepository {
  return {
    findPayableOrder: vi.fn().mockResolvedValue(order),
    createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({
      outcome: "claimed", attempt, claimId: "30000000-0000-4000-8000-000000000001",
    }),
    bindProviderSession: vi.fn().mockImplementation(async (input) => ({
      ...attempt,
      providerReference: input.providerReference,
      returnStateDigest: input.returnStateDigest,
      status: input.status,
    })),
    consumeReturnState: vi.fn(),
    applyVerifiedWebhookEventAtomically: vi.fn(),
    applyVerifiedResult: vi.fn(),
    listReconciliationCandidates: vi.fn(),
    ...overrides,
  };
}

function service(input: {
  repository?: PaymentRepository;
  providers?: readonly PaymentProviderRegistration[];
  checkoutAuthority?: ReviewedPaymentCheckoutRepository;
  deriveReturnState?: (input: {
    attemptId: string;
    idempotencyKey: string;
    provider: string;
    method: string;
  }) => string;
  returnBaseUrl?: string;
} = {}) {
  return createPaymentService({
    repository: input.repository ?? repository(),
    providers: input.providers ?? [registration()],
    checkoutAuthority: input.checkoutAuthority ?? {
      findReviewedPaymentContext: vi.fn().mockResolvedValue({
        amountCents: order.amountCents,
        currency: order.currency,
        customer: order.customer,
        billingAddress: order.billingAddress,
        deliveryAddress: order.deliveryAddress,
      }),
    },
    returnBaseUrl: input.returnBaseUrl ?? "https://trusted.example.test",
    deriveReturnState: input.deriveReturnState ?? (() => "a".repeat(64)),
  });
}

describe("payment service", () => {
  it("hashes exact webhook bytes server-side and atomically applies only a registered provider event", async () => {
    const applyVerifiedWebhookEventAtomically = vi.fn().mockResolvedValue("applied");
    const repo = repository({ applyVerifiedWebhookEventAtomically });
    const stripe: PaymentProvider = {
      ...provider(),
      key: "stripe",
      verifyWebhook: vi.fn(),
    };
    const paymentService = service({
      repository: repo,
      providers: [{ method: "card", label: "Card", isTest: false, provider: stripe }],
    });
    const rawBody = new Uint8Array([0, 255, 13, 10, 123, 125]);
    const event: VerifiedProviderEvent = {
      provider: "stripe",
      providerEventId: "evt_exact_123",
      result: {
        providerReference: "pi_exact_123",
        providerStatus: "succeeded",
        amountCents: order.amountCents,
        currency: order.currency,
        orderNumber: order.orderNumber,
        status: "paid",
      },
    };

    await expect(paymentService.applyVerifiedWebhook(event, rawBody)).resolves.toBe("applied");
    expect(applyVerifiedWebhookEventAtomically).toHaveBeenCalledWith({
      ...event,
      payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    });
  });

  it("rejects webhook events from providers without a registered verifier", async () => {
    const repo = repository();
    const paymentService = service({ repository: repo });
    const event: VerifiedProviderEvent = {
      provider: "stripe",
      providerEventId: "evt_unregistered",
      result: {
        providerReference: "pi_unregistered",
        providerStatus: "succeeded",
        amountCents: order.amountCents,
        currency: order.currency,
        orderNumber: order.orderNumber,
        status: "paid",
      },
    };

    await expect(paymentService.applyVerifiedWebhook(event, new Uint8Array()))
      .rejects.toThrow("Payment webhook provider is unavailable");
    expect(repo.applyVerifiedWebhookEventAtomically).not.toHaveBeenCalled();
  });

  it("passes only a freshly constructed eligibility DTO to providers", async () => {
    const enriched = {
      ...order,
      internalSecret: "must-not-reach-provider",
      providerMetadata: { token: "internal" },
    };
    const card = provider();
    const repo = repository({ findPayableOrder: vi.fn().mockResolvedValue(enriched) });
    const authority = {
      findReviewedPaymentContext: vi.fn().mockResolvedValue(enriched),
    };
    const paymentService = service({
      repository: repo,
      checkoutAuthority: authority,
      providers: [registration(card)],
    });

    await paymentService.availableMethods({
      sessionId: "checkout-id", checkoutVersion: 1, cartDigest: "b".repeat(64),
    });
    await paymentService.start(access, "card", browserKey);

    const expected = {
      amountCents: order.amountCents,
      currency: order.currency,
      customer: order.customer,
      billingAddress: order.billingAddress,
      deliveryAddress: order.deliveryAddress,
    };
    expect(card.availability).toHaveBeenNthCalledWith(1, expected);
    expect(card.availability).toHaveBeenNthCalledWith(2, expected);
    for (const [context] of vi.mocked(card.availability).mock.calls) {
      expect(context).not.toHaveProperty("id");
      expect(context).not.toHaveProperty("orderNumber");
      expect(context).not.toHaveProperty("internalSecret");
      expect(context).not.toHaveProperty("providerMetadata");
    }
  });

  it("rejects duplicate or malformed provider registrations before use", () => {
    const card = provider();
    expect(() => service({
      providers: [registration(card), registration(provider())],
    })).toThrow("Duplicate payment method registration");

    const malformed: PaymentProviderRegistration[] = [
      { ...registration(card), method: "afterpay" },
      {
        ...registration(card),
        provider: { ...card, key: "stripe", method: "afterpay" },
        method: "afterpay",
        isTest: false,
      },
      {
        ...registration(card),
        provider: { ...card, key: "afterpay", method: "card" },
        isTest: false,
      },
      {
        ...registration(card),
        provider: { ...card, key: "zip", method: "afterpay" },
        method: "afterpay",
        isTest: false,
      },
      { ...registration(card), isTest: false },
      {
        ...registration(card),
        provider: { ...card, key: "stripe" },
        isTest: true,
      },
      {
        ...registration(card),
        provider: { ...card, key: "unknown-provider" as never },
      },
    ];
    for (const entry of malformed) {
      expect(() => service({ providers: [entry] }))
        .toThrow("Invalid payment provider registration");
    }
  });

  it("discovers methods only from the exact persisted checkout context", async () => {
    const card = provider();
    const authority = { findReviewedPaymentContext: vi.fn().mockResolvedValue({
      amountCents: order.amountCents,
      currency: order.currency,
      customer: order.customer,
      billingAddress: order.billingAddress,
      deliveryAddress: order.deliveryAddress,
    }) };
    const paymentService = service({ checkoutAuthority: authority, providers: [registration(card)] });

    await expect(paymentService.availableMethods({
      sessionId: "checkout-id", checkoutVersion: 4, cartDigest: "b".repeat(64),
    })).resolves.toEqual([
      { method: "card", label: "Test card — no real payment", isTest: true },
    ]);
    expect(authority.findReviewedPaymentContext).toHaveBeenCalledWith({
      sessionId: "checkout-id", checkoutVersion: 4, cartDigest: "b".repeat(64),
    });
    expect(card.availability).toHaveBeenCalledWith({
      amountCents: order.amountCents,
      currency: "NZD",
      customer: order.customer,
      billingAddress: order.billingAddress,
      deliveryAddress: order.deliveryAddress,
    });
  });

  it("filters owner-scoped order methods through the same immutable availability context", async () => {
    const australianAddress = { ...address, country: "AU" as const, region: "NSW", postcode: "2000", phone: "+61400000000" };
    const australianOrder = {
      ...order,
      billingAddress: australianAddress,
      deliveryAddress: australianAddress,
      customer: { fullName: australianAddress.fullName, email: australianAddress.email, phone: australianAddress.phone },
    };
    const card = provider();
    const zip = provider("zip");
    vi.mocked(zip.availability).mockImplementation(async (context) => context.currency === "NZD"
      ? { available: false, reason: "currency" }
      : { available: true });
    const repo = repository({ findPayableOrder: vi.fn().mockResolvedValue(australianOrder) });

    await expect(service({
      repository: repo,
      providers: [registration(card), registration(zip)],
    }).availableMethodsForOrder(access)).resolves.toEqual([
      { method: "card", label: "Test card — no real payment", isTest: true },
    ]);

    expect(repo.findPayableOrder).toHaveBeenCalledWith(access);
    expect(zip.availability).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: order.amountCents,
      currency: "NZD",
      deliveryAddress: australianAddress,
    }));
  });

  it("starts from the immutable order, binds a state digest and returns a safe action", async () => {
    const repo = repository();
    const card = provider();
    const paymentService = service({ repository: repo, providers: [registration(card)] });
    const result = await paymentService.start(access, "card", browserKey);

    expect(repo.findPayableOrder).toHaveBeenCalledWith(access);
    expect(card.availability).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 12_075, currency: "NZD",
    }));
    expect(repo.createOrClaimNonterminalAttempt).toHaveBeenCalledWith({
      orderId: order.id,
      provider: "local-test",
      method: "card",
      expectedAmountCents: 12_075,
      currency: "NZD",
      clientKey: browserKey,
    });
    expect(card.createOrReuse).toHaveBeenCalledWith(expect.objectContaining({
      order,
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotencyKey,
      returnState: "a".repeat(64),
      returnUrl: expect.stringContaining("trusted.example.test/api/payments/returns/local-test"),
      cancelUrl: expect.stringContaining("trusted.example.test/api/payments/returns/local-test"),
    }));
    const createInput = vi.mocked(card.createOrReuse).mock.calls[0][0];
    expect(createInput.returnUrl).toContain(encodeURIComponent(order.orderNumber));
    expect(createInput.cancelUrl).toContain(encodeURIComponent(order.orderNumber));
    expect(new URL(createInput.returnUrl).searchParams).toMatchObject(expect.any(URLSearchParams));
    expect(new URL(createInput.returnUrl).searchParams.get("flow")).toBe("return");
    expect(new URL(createInput.cancelUrl).searchParams.get("flow")).toBe("cancel");
    expect(new URL(createInput.returnUrl).searchParams.get("state")).toBe("a".repeat(64));
    expect(new URL(createInput.cancelUrl).searchParams.get("state")).toBe("a".repeat(64));
    expect(repo.bindProviderSession).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: attempt.id,
      claimId: "30000000-0000-4000-8000-000000000001",
      providerReference: "local-card-reference",
      returnStateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      status: "requires_action",
    }));
    expect(result).toMatchObject({
      payment: { method: "card", status: "requires_action", isTest: true },
      action: { kind: "test", method: "card", isTest: true },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /orderId|attemptId|claimId|providerReference|providerStatus|returnStateDigest|idempotencyKey/,
    );
  });

  it.each(["test", "redirect", "elements"] as const)(
    "binds the service-generated return state for a %s session",
    async (kind) => {
      const card = provider();
      const base = {
        provider: kind === "elements" ? "stripe" as const : "local-test" as const,
        method: "card" as const,
        providerReference: `${kind}-reference`,
        providerStatus: "REQUIRES_ACTION",
      };
      vi.mocked(card.createOrReuse).mockResolvedValue(
        kind === "elements"
          ? { ...base, kind, provider: "stripe", clientSecret: "secret", returnUrl: "https://trusted.example.test/payment-return" }
          : kind === "redirect"
            ? { ...base, kind, provider: "afterpay", method: "afterpay", redirectUrl: "https://provider.test" }
            : { ...base, kind, provider: "local-test", url: "https://trusted.example.test/test" },
      );
      const matchingProvider = kind === "elements"
        ? { ...card, key: "stripe" as const }
        : kind === "redirect"
          ? { ...card, key: "afterpay" as const, method: "afterpay" as const }
          : card;
      const method = matchingProvider.method;
      const repo = repository({
        createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({
          outcome: "claimed", attempt: { ...attempt, provider: matchingProvider.key, method },
          claimId: "30000000-0000-4000-8000-000000000001",
        }),
      });
      await service({
        repository: repo,
        providers: [{
          ...registration(matchingProvider),
          isTest: kind === "test",
        }],
        deriveReturnState: () => "b".repeat(64),
      }).start(access, method, browserKey);

      expect(repo.bindProviderSession).toHaveBeenCalledWith(expect.objectContaining({
        returnStateDigest: "a0fab1377f49a759b57f63318262ebe89fabfc990e8e93ceac2984561482b9d4",
      }));
    },
  );

  it("rejects malformed injected state and non-origin return bases before provider use", async () => {
    for (const deriveReturnState of [
      () => "",
      () => "short",
      () => "!".repeat(64),
    ]) {
      await expect(service({ deriveReturnState }).start(access, "card", browserKey))
        .rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    }
    for (const returnBaseUrl of [
      "https://trusted.example.test/payments",
      "https://user:pass@trusted.example.test",
      "https://trusted.example.test/?next=bad",
      "https://trusted.example.test/#bad",
      "http://remote.example.test",
    ]) {
      expect(() => service({ returnBaseUrl })).toThrow("Payment return base URL is invalid");
    }
  });

  it("fails closed on provider session identity or kind mismatch without binding", async () => {
    const cases = [
      { kind: "test", provider: "stripe", method: "card", url: "https://provider.test" },
      { kind: "elements", provider: "local-test", method: "card", clientSecret: "secret", returnUrl: "https://shop.example.test/payment-return" },
      { kind: "redirect", provider: "local-test", method: "card", redirectUrl: "https://provider.test" },
      { kind: "test", provider: "local-test", method: "afterpay", url: "https://provider.test" },
    ] as const;
    for (const session of cases) {
      const card = provider();
      vi.mocked(card.createOrReuse).mockResolvedValue({
        ...session,
        providerReference: "mismatched",
        providerStatus: "BAD",
      } as never);
      const repo = repository();
      await expect(service({ repository: repo, providers: [registration(card)] })
        .start(access, "card", browserKey))
        .rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
      expect(repo.bindProviderSession).not.toHaveBeenCalled();
    }
  });

  it("isolates method discovery failures and wraps provider/bind failures safely", async () => {
    const card = provider();
    const afterpay = provider("afterpay");
    vi.mocked(card.availability).mockRejectedValue(new Error("raw availability secret"));
    await expect(service({ providers: [registration(card), registration(afterpay)] })
      .availableMethods({
        sessionId: "checkout-id", checkoutVersion: 1, cartDigest: "b".repeat(64),
      })).resolves.toEqual([
        { method: "afterpay", label: "Test Afterpay — no real payment", isTest: true },
      ]);

    const createFailure = repository();
    const bindFailure = repository({
      bindProviderSession: vi.fn().mockRejectedValue(new Error("raw bind secret")),
    });
    for (const [repo, phase] of [
      [createFailure, "create"],
      [bindFailure, "bind"],
    ] as const) {
      const failing = provider();
      if (phase === "create") {
        vi.mocked(failing.createOrReuse).mockRejectedValue(new Error("raw create secret"));
      }
      await expect(service({ repository: repo, providers: [registration(failing)] })
        .start(access, "card", browserKey))
        .rejects.toEqual(new PaymentServiceError(
          "PAYMENT_UNAVAILABLE",
          "Payment could not be started",
        ));
    }
  });

  it("fails closed before provider or claim for inaccessible and unavailable orders", async () => {
    const card = provider();
    const missingRepo = repository({ findPayableOrder: vi.fn().mockResolvedValue(null) });
    await expect(service({ repository: missingRepo, providers: [registration(card)] })
      .start(access, "card", browserKey))
      .rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect(card.availability).not.toHaveBeenCalled();
    expect(missingRepo.createOrClaimNonterminalAttempt).not.toHaveBeenCalled();

    vi.mocked(card.availability).mockResolvedValue({ available: false, reason: "currency" });
    const unavailableRepo = repository();
    await expect(service({ repository: unavailableRepo, providers: [registration(card)] })
      .start(access, "card", browserKey))
      .rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    expect(unavailableRepo.createOrClaimNonterminalAttempt).not.toHaveBeenCalled();
  });

  it("never calls a losing provider and never falls back across methods", async () => {
    const card = provider();
    const afterpay = provider("afterpay");
    const repo = repository({
      createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({
        outcome: "existing_conflict", attempt, claimId: null,
      }),
    });
    const paymentService = service({
      repository: repo,
      providers: [registration(card), registration(afterpay)],
    });
    await expect(paymentService.start(access, "afterpay", browserKey))
      .rejects.toMatchObject({ code: "PAYMENT_ATTEMPT_IN_PROGRESS" });
    expect(afterpay.createOrReuse).not.toHaveBeenCalled();
    expect(card.createOrReuse).not.toHaveBeenCalled();
  });

  it("lets exactly one provider create a session under cross-method start concurrency", async () => {
    const card = provider();
    const afterpay = provider("afterpay");
    let arrivals = 0;
    let releaseClaims!: () => void;
    const claimsReady = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });
    let winningAttempt: PaymentAttemptRecord | null = null;
    const claim = vi.fn(async (input: Parameters<PaymentRepository["createOrClaimNonterminalAttempt"]>[0]) => {
      arrivals += 1;
      if (arrivals === 2) releaseClaims();
      await claimsReady;
      if (!winningAttempt) {
        winningAttempt = {
          ...attempt,
          method: input.method,
          provider: input.provider,
        };
        return {
          outcome: "claimed" as const,
          attempt: winningAttempt,
          claimId: "30000000-0000-4000-8000-000000000001",
        };
      }
      return {
        outcome: "existing_conflict" as const,
        attempt: winningAttempt,
        claimId: null,
      };
    });
    const repo = repository({ createOrClaimNonterminalAttempt: claim });
    const paymentService = service({
      repository: repo,
      providers: [registration(card), registration(afterpay)],
    });

    const settled = await Promise.allSettled([
      paymentService.start(access, "card", "10000000-0000-4000-8000-000000000011"),
      paymentService.start(access, "afterpay", "10000000-0000-4000-8000-000000000012"),
    ]);

    expect(claim).toHaveBeenCalledTimes(2);
    expect(vi.mocked(card.createOrReuse).mock.calls.length +
      vi.mocked(afterpay.createOrReuse).mock.calls.length).toBe(1);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const [loser] = settled.filter(({ status }) => status === "rejected");
    expect(loser).toMatchObject({
      status: "rejected",
      reason: { code: "PAYMENT_ATTEMPT_IN_PROGRESS" },
    });
    if (vi.mocked(card.createOrReuse).mock.calls.length === 1) {
      expect(afterpay.createOrReuse).not.toHaveBeenCalled();
    } else {
      expect(card.createOrReuse).not.toHaveBeenCalled();
    }
  });

  it("keeps an unbound active lease pending without calling the provider", async () => {
    const card = provider();
    const bound = { ...attempt, providerReference: null, returnStateDigest: null, status: "created" as const };
    const repo = repository({
      createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({
        outcome: "existing", attempt: bound, claimId: null,
      }),
    });
    await expect(service({ repository: repo, providers: [registration(card)] })
      .start(access, "card", browserKey)).resolves.toEqual({
        payment: { method: "card", status: "created", isTest: true, canRetry: false },
        action: null,
      });
    expect(card.createOrReuse).not.toHaveBeenCalled();
  });

  it.each([
    ["afterpay", "afterpay", "redirect", "requires_action"],
    ["stripe", "card", "elements", "processing"],
  ] as const)("rehydrates the same %s action after the bound response is lost", async (key, method, kind, status) => {
    const returnState = "c".repeat(64);
    const providerReference = `${key}-reference`;
    const paymentProvider: PaymentProvider = {
      key,
      method,
      refundCapability: "unsupported",
      availability: vi.fn().mockResolvedValue({ available: true }),
      createOrReuse: vi.fn().mockImplementation(async (input) => kind === "elements"
        ? { kind, provider: "stripe", method: "card", providerReference, providerStatus: "PROCESSING", clientSecret: "client_secret_same" }
        : { kind, provider: "afterpay", method: "afterpay", providerReference, providerStatus: "REQUIRES_ACTION", redirectUrl: input.returnUrl }),
      completeReturn: vi.fn(),
      retrieve: vi.fn(),
    };
    const bound = {
      ...attempt,
      provider: key,
      method,
      providerReference,
      returnStateDigest: createHash("sha256").update(returnState).digest("hex"),
      status,
    };
    const repo = repository({
      createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({ outcome: "existing", attempt: bound, claimId: null }),
    });
    const paymentService = service({
      repository: repo,
      providers: [{ method, label: method, isTest: false, provider: paymentProvider }],
      deriveReturnState: () => returnState,
    });

    const result = await paymentService.start(access, method, browserKey);

    expect(paymentProvider.createOrReuse).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotencyKey,
      returnState,
    }));
    expect(result).toMatchObject({ payment: { method, status }, action: { kind, method } });
    expect(repo.bindProviderSession).not.toHaveBeenCalled();
  });

  it.each(["digest", "reference", "kind"] as const)("fails closed when a rebound provider %s mismatches", async (mismatch) => {
    const returnState = "d".repeat(64);
    const paymentProvider: PaymentProvider = {
      key: "afterpay",
      method: "afterpay",
      refundCapability: "unsupported",
      availability: vi.fn().mockResolvedValue({ available: true }),
      createOrReuse: vi.fn().mockResolvedValue({
        kind: mismatch === "kind" ? "test" : "redirect",
        provider: mismatch === "kind" ? "local-test" : "afterpay",
        method: "afterpay",
        providerReference: mismatch === "reference" ? "wrong-reference" : "afterpay-reference",
        providerStatus: "REQUIRES_ACTION",
        ...(mismatch === "kind" ? { url: "https://provider.test" } : { redirectUrl: "https://provider.test" }),
      } as never),
      completeReturn: vi.fn(),
      retrieve: vi.fn(),
    };
    const bound = {
      ...attempt,
      provider: "afterpay" as const,
      method: "afterpay" as const,
      providerReference: "afterpay-reference",
      returnStateDigest: mismatch === "digest" ? "e".repeat(64) : createHash("sha256").update(returnState).digest("hex"),
      status: "requires_action" as const,
    };
    const repo = repository({
      createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({ outcome: "existing", attempt: bound, claimId: null }),
    });

    await expect(service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: paymentProvider }],
      deriveReturnState: () => returnState,
    }).start(access, "afterpay", browserKey)).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE" });
    expect(repo.bindProviderSession).not.toHaveBeenCalled();
  });

  it("keeps a timed-out claimed attempt recoverable with the same provider key", async () => {
    const card = provider();
    vi.mocked(card.createOrReuse)
      .mockRejectedValueOnce(new Error("provider timeout"))
      .mockImplementationOnce(async (input) => ({
        kind: "test", provider: "local-test", method: "card",
        providerReference: "recovered-reference", providerStatus: "TEST_REQUIRES_ACTION",
        url: `${input.returnUrl}&state=recovered-state`,
      }));
    const repo = repository();
    const paymentService = service({ repository: repo, providers: [registration(card)] });

    await expect(paymentService.start(access, "card", browserKey))
      .rejects.toEqual(new PaymentServiceError(
        "PAYMENT_UNAVAILABLE",
        "Payment could not be started",
      ));
    expect(repo.bindProviderSession).not.toHaveBeenCalled();
    await expect(paymentService.start(access, "card", browserKey)).resolves.toBeDefined();
    expect(vi.mocked(card.createOrReuse).mock.calls.map(([input]) => input.idempotencyKey))
      .toEqual([attempt.idempotencyKey, attempt.idempotencyKey]);
  });

  it("allows a new claimed attempt after failure but rejects an already paid order", async () => {
    const card = provider();
    const repo = repository();
    await expect(service({ repository: repo, providers: [registration(card)] })
      .start(access, "card", browserKey)).resolves.toBeDefined();
    expect(repo.createOrClaimNonterminalAttempt).toHaveBeenCalledOnce();

    const paidRepo = repository({ findPayableOrder: vi.fn().mockResolvedValue(null) });
    await expect(service({ repository: paidRepo, providers: [registration(card)] })
      .start(access, "card", browserKey)).rejects.toBeInstanceOf(PaymentServiceError);
    expect(paidRepo.createOrClaimNonterminalAttempt).not.toHaveBeenCalled();
  });
});
