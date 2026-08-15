import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { PaymentMethodKey } from "@/server/db/schema/payments";
import type { ReviewedPaymentCheckoutRepository } from "@/server/checkout/checkout-repository";
import type { PaymentAttemptRecord, PaymentRepository } from "./payment-repository";
import { createPaymentService, PaymentServiceError } from "./payment-service";
import type { PaymentProviderRegistration } from "./provider-registry";
import type {
  PaymentOrder,
  PaymentProvider,
  VerifiedPaymentResult,
  VerifiedProviderEvent,
} from "./types";
import {
  PaymentProviderRequestError,
  PaymentProviderVerificationError,
} from "./types";

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
    findCurrentPayment: vi.fn().mockResolvedValue(null),
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
    claimReconciliationCandidates: vi.fn().mockResolvedValue([]),
    applyReconciliationResult: vi.fn(),
    recordReconciliationOutcome: vi.fn(),
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
      providerReference,
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

  it("consumes a Stripe return once without treating browser input as payment authority", async () => {
    const state = "b".repeat(64);
    const stripe: PaymentProvider = {
      ...provider(), key: "stripe", method: "card",
      completeReturn: vi.fn(),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "stripe", method: "card",
      providerReference: "pi_persisted_123",
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "processing",
    };
    const repo = repository({
      consumeReturnState: vi.fn().mockResolvedValue({
        outcome: "consumed", attempt: boundAttempt, order,
      }),
    });
    const paymentService = service({
      repository: repo,
      providers: [{ method: "card", label: "Card", isTest: false, provider: stripe }],
    });

    await expect(paymentService.handleReturn({
      provider: "stripe",
      method: "card",
      orderNumber: order.orderNumber,
      returnState: state,
      providerReference: "pi_persisted_123",
      returnUrl: new URL(
        `https://trusted.example.test/api/payments/returns/stripe?flow=return&orderNumber=${order.orderNumber}&method=card&state=${state}`,
      ),
    })).resolves.toEqual({ orderNumber: order.orderNumber });

    expect(repo.consumeReturnState).toHaveBeenCalledWith({
      provider: "stripe",
      method: "card",
      orderNumber: order.orderNumber,
      providerReference: "pi_persisted_123",
      digest: createHash("sha256").update(state).digest("hex"),
    });
    expect(stripe.completeReturn).not.toHaveBeenCalled();
    expect(repo.applyVerifiedResult).not.toHaveBeenCalled();
  });

  it("confirms an owned Stripe payment only from server-retrieved provider authority", async () => {
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt,
      provider: "stripe",
      method: "card",
      providerReference: "pi_server_verified_123",
      status: "processing",
    };
    const paidResult: VerifiedPaymentResult = {
      providerReference: boundAttempt.providerReference!,
      providerStatus: "succeeded",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "paid",
    };
    const findCurrentPayment = vi.fn().mockResolvedValue({
      attempt: boundAttempt,
      order: { ...order, paymentStatus: "awaiting_payment" },
    });
    const applyVerifiedResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "paid" },
      order: { ...order, paymentStatus: "paid" },
    });
    const repo = repository({ applyVerifiedResult }) as PaymentRepository & {
      findCurrentPayment: typeof findCurrentPayment;
    };
    repo.findCurrentPayment = findCurrentPayment;
    const stripe: PaymentProvider = {
      ...provider(),
      key: "stripe",
      method: "card",
      retrieve: vi.fn().mockResolvedValue({ kind: "verified", result: paidResult }),
    };
    const paymentService = service({
      repository: repo,
      providers: [{ method: "card", label: "Card", isTest: false, provider: stripe }],
    });
    const confirmPayment = (paymentService as unknown as {
      confirmPayment?: (ownedAccess: typeof access) => Promise<unknown>;
    }).confirmPayment;

    expect(confirmPayment).toBeDefined();
    if (!confirmPayment) return;
    await expect(confirmPayment(access)).resolves.toEqual({
      payment: { method: "card", status: "paid", isTest: false, canRetry: false },
      orderNumber: order.orderNumber,
    });
    expect(findCurrentPayment).toHaveBeenCalledWith(access);
    expect(stripe.retrieve).toHaveBeenCalledWith({
      order,
      providerReference: boundAttempt.providerReference,
    });
    expect(applyVerifiedResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      result: paidResult,
      source: "reconciliation",
    });
  });

  it("lets only the first Afterpay return capture with immutable persisted authority", async () => {
    const state = "c".repeat(64);
    const reference = "afterpay_persisted_123";
    const result: VerifiedPaymentResult = {
      providerReference: reference,
      providerStatus: "CAPTURED",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "paid",
    };
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      completeReturn: vi.fn().mockResolvedValue(result),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "afterpay", method: "afterpay",
      providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action",
    };
    const consumeReturnState = vi.fn()
      .mockResolvedValueOnce({ outcome: "consumed", attempt: boundAttempt, order })
      .mockResolvedValueOnce({ outcome: "already_consumed", orderNumber: order.orderNumber });
    const applyVerifiedResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "paid" },
      order: { ...order, paymentStatus: "paid" },
    });
    const repo = repository({ consumeReturnState, applyVerifiedResult });
    const paymentService = service({
      repository: repo,
      providers: [{
        method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay,
      }],
    });
    const returnUrl = new URL(
      `https://trusted.example.test/api/payments/returns/afterpay?flow=return&orderNumber=${order.orderNumber}&method=afterpay&state=${state}&status=SUCCESS&orderToken=${reference}`,
    );
    const input = {
      provider: "afterpay" as const,
      method: "afterpay" as const,
      orderNumber: order.orderNumber,
      returnState: state,
      providerReference: reference,
      returnUrl,
    };

    await expect(Promise.all([
      paymentService.handleReturn(input),
      paymentService.handleReturn(input),
    ])).resolves.toEqual([
      { orderNumber: order.orderNumber },
      { orderNumber: order.orderNumber },
    ]);
    expect(afterpay.completeReturn).toHaveBeenCalledOnce();
    expect(afterpay.completeReturn).toHaveBeenCalledWith({
      order,
      providerReference: reference,
      idempotencyKey: boundAttempt.idempotencyKey,
      attemptCreatedAt: boundAttempt.createdAt,
      returnState: state,
      returnUrl,
    });
    expect(applyVerifiedResult).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      result,
      source: "server_capture",
    });
  });

  it("lets only the first local-test return mark the order paid", async () => {
    const state = "9".repeat(64);
    const reference = "local-test.reference";
    const result: VerifiedPaymentResult = {
      providerReference: reference,
      providerStatus: "TEST_CAPTURED",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "paid",
    };
    const local = {
      ...provider(),
      completeReturn: vi.fn().mockResolvedValue(result),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt,
      providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action",
    };
    const consumeReturnState = vi.fn()
      .mockResolvedValueOnce({ outcome: "consumed", attempt: boundAttempt, order })
      .mockResolvedValueOnce({ outcome: "already_consumed", orderNumber: order.orderNumber });
    const applyVerifiedResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "paid" },
      order: { ...order, paymentStatus: "paid" },
    });
    const paymentService = service({
      repository: repository({ consumeReturnState, applyVerifiedResult }),
      providers: [registration(local)],
    });
    const returnUrl = new URL(
      `https://trusted.example.test/api/payments/returns/local-test?flow=return&orderNumber=${order.orderNumber}&method=card&state=${state}&provider=local-test&providerReference=${reference}`,
    );
    const input = {
      provider: "local-test" as const,
      method: "card" as const,
      orderNumber: order.orderNumber,
      returnState: state,
      providerReference: reference,
      returnUrl,
    };

    await expect(paymentService.handleReturn(input))
      .resolves.toEqual({ orderNumber: order.orderNumber });
    await expect(paymentService.handleReturn(input))
      .resolves.toEqual({ orderNumber: order.orderNumber });
    expect(local.completeReturn).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledOnce();
  });

  it("persists an unknown return result after provider timeout and never reopens it", async () => {
    const state = "d".repeat(64);
    const reference = "afterpay_timeout_123";
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      completeReturn: vi.fn().mockRejectedValue(new PaymentProviderRequestError()),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "afterpay", method: "afterpay",
      providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action",
    };
    const consumeReturnState = vi.fn()
      .mockResolvedValueOnce({ outcome: "consumed", attempt: boundAttempt, order })
      .mockResolvedValueOnce({ outcome: "already_consumed", orderNumber: order.orderNumber });
    const applyVerifiedResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "processing" },
      order: { ...order, paymentStatus: "processing" },
    });
    const paymentService = service({
      repository: repository({ consumeReturnState, applyVerifiedResult }),
      providers: [{
        method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay,
      }],
    });
    const returnUrl = new URL(
      `https://trusted.example.test/api/payments/returns/afterpay?flow=return&orderNumber=${order.orderNumber}&method=afterpay&state=${state}&status=SUCCESS&orderToken=${reference}`,
    );
    const input = {
      provider: "afterpay" as const, method: "afterpay" as const,
      orderNumber: order.orderNumber, returnState: state,
      providerReference: reference, returnUrl,
    };

    await expect(paymentService.handleReturn(input))
      .resolves.toEqual({ orderNumber: order.orderNumber });
    await expect(paymentService.handleReturn(input))
      .resolves.toEqual({ orderNumber: order.orderNumber });
    expect(afterpay.completeReturn).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      result: {
        providerReference: reference,
        providerStatus: "RETURN_STATUS_UNKNOWN",
        amountCents: boundAttempt.expectedAmountCents,
        currency: boundAttempt.currency,
        orderNumber: order.orderNumber,
        status: "processing",
      },
      source: "browser_return",
    });
  });

  it("does not invoke Zip completion for the current NZD service path", async () => {
    const state = "e".repeat(64);
    const reference = "zip_checkout_123";
    const zip: PaymentProvider = {
      ...provider("zip"), key: "zip", method: "zip", completeReturn: vi.fn(),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "zip", method: "zip", providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action",
    };
    const repo = repository({
      consumeReturnState: vi.fn().mockResolvedValue({
        outcome: "consumed", attempt: boundAttempt, order,
      }),
    });
    const paymentService = service({
      repository: repo,
      providers: [{ method: "zip", label: "Zip", isTest: false, provider: zip }],
    });

    await expect(paymentService.handleReturn({
      provider: "zip", method: "zip", orderNumber: order.orderNumber,
      returnState: state, providerReference: reference,
      returnUrl: new URL(
        `https://trusted.example.test/api/payments/returns/zip?flow=return&orderNumber=${order.orderNumber}&method=zip&state=${state}&result=Approved&checkoutId=${reference}`,
      ),
    })).resolves.toEqual({ orderNumber: order.orderNumber });
    expect(zip.completeReturn).not.toHaveBeenCalled();
    expect(repo.applyVerifiedResult).not.toHaveBeenCalled();
  });

  it("fails closed instead of recording a deterministic provider verification error as unknown", async () => {
    const state = "2".repeat(64);
    const reference = "afterpay_verification_123";
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      completeReturn: vi.fn().mockRejectedValue(new PaymentProviderVerificationError()),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "afterpay", method: "afterpay",
      providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action",
    };
    const applyVerifiedResult = vi.fn();
    const paymentService = service({
      repository: repository({
        consumeReturnState: vi.fn().mockResolvedValue({
          outcome: "consumed", attempt: boundAttempt, order,
        }),
        applyVerifiedResult,
      }),
      providers: [{
        method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay,
      }],
    });

    await expect(paymentService.handleReturn({
      provider: "afterpay", method: "afterpay", orderNumber: order.orderNumber,
      returnState: state, providerReference: reference,
      returnUrl: new URL(
        `https://trusted.example.test/api/payments/returns/afterpay?flow=return&orderNumber=${order.orderNumber}&method=afterpay&state=${state}&status=SUCCESS&orderToken=${reference}`,
      ),
    })).rejects.toEqual(new PaymentServiceError(
      "PAYMENT_RETURN_NOT_FOUND",
      "Payment return is unavailable",
    ));
    expect(applyVerifiedResult).not.toHaveBeenCalled();
  });

  it("allows only a persisted synthetic AUD Zip fixture to complete", async () => {
    const state = "1".repeat(64);
    const reference = "zip_aud_checkout_123";
    const auAddress: NormalizedAddress = {
      ...address, country: "AU", region: "NSW", postcode: "2000",
      phone: "+61400000000",
    };
    const audOrder: PaymentOrder = {
      ...order,
      currency: "AUD",
      billingAddress: auAddress,
      deliveryAddress: auAddress,
    };
    const result: VerifiedPaymentResult = {
      providerReference: reference,
      providerStatus: "Charged",
      amountCents: audOrder.amountCents,
      currency: "AUD",
      orderNumber: audOrder.orderNumber,
      status: "paid",
    };
    const zip: PaymentProvider = {
      ...provider("zip"), key: "zip", method: "zip",
      completeReturn: vi.fn().mockResolvedValue(result),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "zip", method: "zip", providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action", currency: "AUD", country: "AU",
    };
    const applyVerifiedResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "paid" },
      order: { ...audOrder, paymentStatus: "paid" },
    });
    const repo = repository({
      consumeReturnState: vi.fn().mockResolvedValue({
        outcome: "consumed", attempt: boundAttempt, order: audOrder,
      }),
      applyVerifiedResult,
    });
    const paymentService = service({
      repository: repo,
      providers: [{ method: "zip", label: "Zip", isTest: false, provider: zip }],
    });
    const returnUrl = new URL(
      `https://trusted.example.test/api/payments/returns/zip?flow=return&orderNumber=${audOrder.orderNumber}&method=zip&state=${state}&result=Approved&checkoutId=${reference}`,
    );

    await expect(paymentService.handleReturn({
      provider: "zip", method: "zip", orderNumber: audOrder.orderNumber,
      returnState: state, providerReference: reference, returnUrl,
    })).resolves.toEqual({ orderNumber: audOrder.orderNumber });
    expect(zip.completeReturn).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      result,
      source: "server_capture",
    });
  });

  it("consumes a Referred Zip return once and never repeats provider work", async () => {
    const state = "3".repeat(64);
    const reference = "zip_referred_checkout_123";
    const auAddress: NormalizedAddress = {
      ...address, country: "AU", region: "NSW", postcode: "2000",
      phone: "+61400000000",
    };
    const audOrder: PaymentOrder = {
      ...order, currency: "AUD", billingAddress: auAddress, deliveryAddress: auAddress,
    };
    const result: VerifiedPaymentResult = {
      providerReference: reference,
      providerStatus: "CHECKOUT:referred",
      amountCents: audOrder.amountCents,
      currency: "AUD",
      orderNumber: audOrder.orderNumber,
      status: "failed",
      sanitizedFailureCode: "declined",
    };
    const zip: PaymentProvider = {
      ...provider("zip"), key: "zip", method: "zip",
      completeReturn: vi.fn().mockResolvedValue(result),
    };
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "zip", method: "zip", providerReference: reference,
      returnStateDigest: createHash("sha256").update(state).digest("hex"),
      status: "requires_action", currency: "AUD", country: "AU",
    };
    const consumeReturnState = vi.fn()
      .mockResolvedValueOnce({ outcome: "consumed", attempt: boundAttempt, order: audOrder })
      .mockResolvedValueOnce({ outcome: "already_consumed", orderNumber: audOrder.orderNumber });
    const applyVerifiedResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "failed" },
      order: { ...audOrder, paymentStatus: "failed" },
    });
    const paymentService = service({
      repository: repository({ consumeReturnState, applyVerifiedResult }),
      providers: [{ method: "zip", label: "Zip", isTest: false, provider: zip }],
    });
    const returnUrl = new URL(
      `https://trusted.example.test/api/payments/returns/zip?flow=return&orderNumber=${audOrder.orderNumber}&method=zip&state=${state}&result=Referred&checkoutId=${reference}`,
    );
    const input = {
      provider: "zip" as const,
      method: "zip" as const,
      orderNumber: audOrder.orderNumber,
      returnState: state,
      providerReference: reference,
      returnUrl,
    };

    await expect(paymentService.handleReturn(input))
      .resolves.toEqual({ orderNumber: audOrder.orderNumber });
    await expect(paymentService.handleReturn(input))
      .resolves.toEqual({ orderNumber: audOrder.orderNumber });
    expect(zip.completeReturn).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledOnce();
    expect(applyVerifiedResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      result,
      source: "server_capture",
    });
  });

  it("fails closed before provider completion when the persisted return authority is absent", async () => {
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      completeReturn: vi.fn(),
    };
    const repo = repository({ consumeReturnState: vi.fn().mockResolvedValue(null) });
    const paymentService = service({
      repository: repo,
      providers: [{
        method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay,
      }],
    });

    await expect(paymentService.handleReturn({
      provider: "afterpay", method: "afterpay", orderNumber: order.orderNumber,
      returnState: "f".repeat(64), providerReference: "wrong-reference",
      returnUrl: new URL("https://trusted.example.test/api/payments/returns/afterpay"),
    })).rejects.toEqual(new PaymentServiceError(
      "PAYMENT_RETURN_NOT_FOUND",
      "Payment return is unavailable",
    ));
    expect(afterpay.completeReturn).not.toHaveBeenCalled();
    expect(repo.applyVerifiedResult).not.toHaveBeenCalled();
  });

  it("reconciles a verified paid payment without retrying completion", async () => {
    const providerReference = "afterpay-reconcile-paid";
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt,
      provider: "afterpay",
      method: "afterpay",
      providerReference,
      status: "processing",
    };
    const candidate = {
      claimId: "40000000-0000-4000-8000-000000000001",
      attempt: boundAttempt,
      order: { ...order, paymentStatus: "processing" as const },
    };
    const result: VerifiedPaymentResult = {
      providerReference,
      providerStatus: "CAPTURED",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "paid",
    };
    const afterpay: PaymentProvider = {
      ...provider("afterpay"),
      key: "afterpay",
      method: "afterpay",
      retrieve: vi.fn().mockResolvedValue({ kind: "verified", result }),
      retryCompletion: vi.fn(),
    };
    const applyReconciliationResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "paid" },
      order: { ...order, paymentStatus: "paid" },
    });
    const repo = repository({
      claimReconciliationCandidates: vi.fn()
        .mockResolvedValueOnce([candidate])
        .mockResolvedValue([]),
      applyReconciliationResult,
    });

    await expect(service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay }],
    }).reconcilePendingPayments()).resolves.toEqual({
      processed: 1,
      applied: 1,
      retried: 0,
      pending: 0,
      failed: 0,
    });
    expect(repo.claimReconciliationCandidates).toHaveBeenNthCalledWith(1, 1);
    expect(repo.claimReconciliationCandidates).toHaveBeenNthCalledWith(2, 1);
    expect(afterpay.retrieve).toHaveBeenCalledWith({ order: candidate.order, providerReference });
    expect(afterpay.retryCompletion).not.toHaveBeenCalled();
    expect(applyReconciliationResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      claimId: candidate.claimId,
      result,
    });
  });

  it("retries only authoritative absence with the persisted key and creation time", async () => {
    const providerReference = "afterpay-reconcile-absent";
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt,
      provider: "afterpay",
      method: "afterpay",
      providerReference,
      status: "processing",
    };
    const candidate = {
      claimId: "40000000-0000-4000-8000-000000000002",
      attempt: boundAttempt,
      order: { ...order, paymentStatus: "processing" as const },
    };
    const retriedResult: VerifiedPaymentResult = {
      providerReference,
      providerStatus: "CAPTURED",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "paid",
    };
    const retryCompletion = vi.fn().mockResolvedValue(retriedResult);
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      retrieve: vi.fn().mockResolvedValue({ kind: "authoritative_not_found" }),
      retryCompletion,
    };
    const applyReconciliationResult = vi.fn().mockResolvedValue({
      attempt: { ...boundAttempt, status: "paid" },
      order: { ...order, paymentStatus: "paid" },
    });
    const repo = repository({
      claimReconciliationCandidates: vi.fn()
        .mockResolvedValueOnce([candidate])
        .mockResolvedValue([]),
      applyReconciliationResult,
    });

    await expect(service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay }],
    }).reconcilePendingPayments()).resolves.toMatchObject({ applied: 1, retried: 1, failed: 0 });
    expect(retryCompletion).toHaveBeenCalledWith({
      order: candidate.order,
      providerReference,
      idempotencyKey: boundAttempt.idempotencyKey,
      attemptCreatedAt: boundAttempt.createdAt,
      source: "reconciliation",
    });
    expect(applyReconciliationResult).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      claimId: candidate.claimId,
      result: retriedResult,
    });
  });

  it("keeps retrieval timeouts processing and never retries completion", async () => {
    const providerReference = "afterpay-reconcile-timeout";
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "afterpay", method: "afterpay", providerReference,
      status: "processing",
    };
    const candidate = {
      claimId: "40000000-0000-4000-8000-000000000003",
      attempt: boundAttempt,
      order: { ...order, paymentStatus: "processing" as const },
    };
    const retryCompletion = vi.fn();
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      retrieve: vi.fn().mockRejectedValue(new PaymentProviderRequestError("redacted")),
      retryCompletion,
    };
    const recordReconciliationOutcome = vi.fn().mockResolvedValue(undefined);
    const repo = repository({
      claimReconciliationCandidates: vi.fn()
        .mockResolvedValueOnce([candidate])
        .mockResolvedValue([]),
      recordReconciliationOutcome,
    });

    await expect(service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay }],
    }).reconcilePendingPayments()).resolves.toEqual({
      processed: 1, applied: 0, retried: 0, pending: 1, failed: 0,
    });
    expect(retryCompletion).not.toHaveBeenCalled();
    expect(recordReconciliationOutcome).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      claimId: candidate.claimId,
      code: "reconciliation_retrieval_unavailable",
    });
  });

  it("fails closed when a retry result mismatches the immutable order", async () => {
    const providerReference = "afterpay-reconcile-mismatch";
    const boundAttempt: PaymentAttemptRecord = {
      ...attempt, provider: "afterpay", method: "afterpay", providerReference,
      status: "processing",
    };
    const candidate = {
      claimId: "40000000-0000-4000-8000-000000000004",
      attempt: boundAttempt,
      order: { ...order, paymentStatus: "processing" as const },
    };
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      retrieve: vi.fn().mockResolvedValue({ kind: "authoritative_not_found" }),
      retryCompletion: vi.fn().mockResolvedValue({
        providerReference,
        providerStatus: "CAPTURED",
        amountCents: order.amountCents + 1,
        currency: order.currency,
        orderNumber: order.orderNumber,
        status: "paid",
      }),
    };
    const recordReconciliationOutcome = vi.fn().mockResolvedValue(undefined);
    const repo = repository({
      claimReconciliationCandidates: vi.fn()
        .mockResolvedValueOnce([candidate])
        .mockResolvedValue([]),
      recordReconciliationOutcome,
    });

    await expect(service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay }],
    }).reconcilePendingPayments()).resolves.toEqual({
      processed: 1, applied: 0, retried: 1, pending: 0, failed: 1,
    });
    expect(repo.applyReconciliationResult).not.toHaveBeenCalled();
    expect(recordReconciliationOutcome).toHaveBeenCalledWith({
      attemptId: boundAttempt.id,
      claimId: candidate.claimId,
      code: "reconciliation_verification_failed",
    });
  });

  it("isolates one candidate failure and continues the remaining batch", async () => {
    const first = {
      ...attempt,
      provider: "afterpay" as const,
      method: "afterpay" as const,
      providerReference: "afterpay-first",
      status: "processing" as const,
    };
    const second = {
      ...first,
      id: "20000000-0000-4000-8000-000000000002",
      providerReference: "afterpay-second",
    };
    const candidates = [first, second].map((storedAttempt, index) => ({
      claimId: `40000000-0000-4000-8000-00000000000${index + 5}`,
      attempt: storedAttempt,
      order: { ...order, paymentStatus: "processing" as const },
    }));
    const paidResult: VerifiedPaymentResult = {
      providerReference: second.providerReference,
      providerStatus: "CAPTURED",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "paid",
    };
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay",
      retrieve: vi.fn()
        .mockRejectedValueOnce(new Error("unexpected internal failure"))
        .mockResolvedValueOnce({ kind: "verified", result: paidResult }),
    };
    const repo = repository({
      claimReconciliationCandidates: vi.fn()
        .mockResolvedValueOnce([candidates[0]])
        .mockResolvedValueOnce([candidates[1]])
        .mockResolvedValue([]),
      applyReconciliationResult: vi.fn().mockResolvedValue({
        attempt: { ...second, status: "paid" },
        order: { ...order, paymentStatus: "paid" },
      }),
      recordReconciliationOutcome: vi.fn().mockResolvedValue(undefined),
    });

    await expect(service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay }],
    }).reconcilePendingPayments()).resolves.toEqual({
      processed: 2, applied: 1, retried: 0, pending: 0, failed: 1,
    });
    expect(afterpay.retrieve).toHaveBeenCalledTimes(2);
  });

  it("does not lease the next candidate until the current provider work is complete", async () => {
    const first = {
      ...attempt,
      provider: "afterpay" as const,
      method: "afterpay" as const,
      providerReference: "afterpay-lease-first",
      status: "processing" as const,
    };
    const second = {
      ...first,
      id: "20000000-0000-4000-8000-000000000020",
      providerReference: "afterpay-lease-second",
    };
    const candidates = [first, second].map((storedAttempt, index) => ({
      claimId: `50000000-0000-4000-8000-00000000000${index + 1}`,
      attempt: storedAttempt,
      order: { ...order, paymentStatus: "processing" as const },
    }));
    let releaseFirst!: (result: {
      kind: "verified";
      result: VerifiedPaymentResult;
    }) => void;
    const firstRetrieval = new Promise<{
      kind: "verified";
      result: VerifiedPaymentResult;
    }>((resolve) => {
      releaseFirst = resolve;
    });
    const resultFor = (storedAttempt: PaymentAttemptRecord): VerifiedPaymentResult => ({
      providerReference: storedAttempt.providerReference!,
      providerStatus: "AUTH_APPROVED",
      amountCents: order.amountCents,
      currency: order.currency,
      orderNumber: order.orderNumber,
      status: "processing",
    });
    const retrieve = vi.fn()
      .mockImplementationOnce(() => firstRetrieval)
      .mockResolvedValueOnce({ kind: "verified", result: resultFor(second) });
    const afterpay: PaymentProvider = {
      ...provider("afterpay"), key: "afterpay", method: "afterpay", retrieve,
    };
    const claimReconciliationCandidates = vi.fn()
      .mockResolvedValueOnce([candidates[0]])
      .mockResolvedValueOnce([candidates[1]])
      .mockResolvedValue([]);
    const repo = repository({
      claimReconciliationCandidates,
      applyReconciliationResult: vi.fn().mockImplementation(async ({ result }) => ({
        attempt: { ...first, providerReference: result.providerReference },
        order: { ...order, paymentStatus: "processing" },
      })),
    });
    const reconciliation = service({
      repository: repo,
      providers: [{ method: "afterpay", label: "Afterpay", isTest: false, provider: afterpay }],
    }).reconcilePendingPayments();

    await vi.waitFor(() => expect(retrieve).toHaveBeenCalledOnce());
    expect(claimReconciliationCandidates).toHaveBeenCalledTimes(1);
    expect(claimReconciliationCandidates).toHaveBeenCalledWith(1);

    releaseFirst({ kind: "verified", result: resultFor(first) });
    await expect(reconciliation).resolves.toMatchObject({ processed: 2, applied: 2 });
    expect(claimReconciliationCandidates).toHaveBeenCalledTimes(3);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
});
