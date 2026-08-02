import { describe, expect, it, vi } from "vitest";
import type { NormalizedAddress } from "@/domain/address/types";
import type { ReviewedPaymentCheckoutRepository } from "@/server/checkout/checkout-repository";
import type { PaymentAttemptRecord, PaymentRepository } from "./payment-repository";
import { createPaymentService, PaymentServiceError } from "./payment-service";
import type { PaymentProviderRegistration } from "./provider-registry";
import type { PaymentOrder, PaymentProvider } from "./types";

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

function provider(method: "card" | "afterpay" = "card"): PaymentProvider {
  return {
    key: "local-test",
    method,
    refundCapability: "unsupported",
    availability: vi.fn().mockResolvedValue({ available: true }),
    createOrReuse: vi.fn().mockImplementation(async (input) => {
      const url = new URL(input.returnUrl);
      url.searchParams.set("state", "raw-return-state");
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
    returnBaseUrl: "https://trusted.example.test/payments",
  });
}

describe("payment service", () => {
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
      returnUrl: expect.stringContaining("trusted.example.test"),
      cancelUrl: expect.stringContaining("trusted.example.test"),
    }));
    const createInput = vi.mocked(card.createOrReuse).mock.calls[0][0];
    expect(createInput.returnUrl).toContain(encodeURIComponent(order.orderNumber));
    expect(createInput.cancelUrl).toContain(encodeURIComponent(order.orderNumber));
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

  it("returns a safe status for a same-method non-claiming request", async () => {
    const card = provider();
    const bound = { ...attempt, providerReference: "already-bound", status: "requires_action" as const };
    const repo = repository({
      createOrClaimNonterminalAttempt: vi.fn().mockResolvedValue({
        outcome: "existing", attempt: bound, claimId: null,
      }),
    });
    await expect(service({ repository: repo, providers: [registration(card)] })
      .start(access, "card", browserKey)).resolves.toEqual({
        payment: { method: "card", status: "requires_action", isTest: true, canRetry: false },
        action: null,
      });
    expect(card.createOrReuse).not.toHaveBeenCalled();
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

    await expect(paymentService.start(access, "card", browserKey)).rejects.toThrow("provider timeout");
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
