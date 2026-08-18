import { describe, expect, it, vi } from "vitest";
import type {
  PaymentRequestRecord,
  PaymentRequestRepository,
} from "./payment-request-repository";
import { createPaymentRequestService } from "./payment-request-service";

const request: PaymentRequestRecord = Object.freeze({
  id: "ef0fa975-2050-4c43-b693-38367b1b663e",
  requestNumber: "PAY-2026-ABC123",
  publicTokenDigest: "a".repeat(64),
  kind: "standalone",
  orderId: null,
  orderNumber: null,
  customerName: "Internal Customer",
  customerEmail: "internal@example.test",
  description: "Custom design deposit",
  currency: "NZD",
  amountCents: 20_000,
  enabledPaymentMethods: ["card"] as const,
  status: "pending",
  statusReason: null,
  expiresAt: null,
  internalNote: "Private admin note",
  createdAt: new Date("2026-08-18T00:00:00.000Z"),
  updatedAt: new Date("2026-08-18T00:00:00.000Z"),
});

function repository(overrides: Partial<PaymentRequestRepository> = {}) {
  return {
    createRequest: vi.fn(async () => request),
    findPublicByDigest: vi.fn(async () => request),
    rotateToken: vi.fn(async () => request),
    cancel: vi.fn(async () => ({ ...request, status: "cancelled" as const })),
    getOrderSummary: vi.fn(),
    recordBankTransfer: vi.fn(),
    reverseBankTransfer: vi.fn(),
    preflightAndClaimAttempt: vi.fn(),
    bindProviderSession: vi.fn(),
    consumeReturnState: vi.fn(),
    applyVerifiedResult: vi.fn(),
    ownsProviderReference: vi.fn().mockResolvedValue(false),
    applyVerifiedWebhookEventAtomically: vi.fn(),
    claimReconciliationCandidates: vi.fn().mockResolvedValue([]),
    applyReconciliationResult: vi.fn(),
    recordReconciliationOutcome: vi.fn(),
    ...overrides,
  } satisfies PaymentRequestRepository;
}

describe("payment request service", () => {
  it("stores only a token digest and returns the raw token once", async () => {
    const store = repository();
    const service = createPaymentRequestService({
      repository: store,
      generateRequestNumber: () => "PAY-2026-ABC123",
    });
    const result = await service.create("admin-1", {
      kind: "standalone",
      amountCents: 20_000,
      currency: "NZD",
      description: "Custom design deposit",
      enabledPaymentMethods: ["card"],
    });

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestNumber: "PAY-2026-ABC123",
      publicTokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(vi.mocked(store.createRequest).mock.calls[0][0].publicTokenDigest)
      .not.toBe(result.rawToken);
  });

  it("returns a public allowlist without stored identity or internal values", async () => {
    const service = createPaymentRequestService({ repository: repository() });
    const result = await service.publicByToken("A".repeat(43));

    expect(result).toEqual({
      requestNumber: "PAY-2026-ABC123",
      kind: "standalone",
      description: "Custom design deposit",
      amountCents: 20_000,
      currency: "NZD",
      status: "pending",
      methods: ["card"],
    });
    expect(result).not.toHaveProperty("customerName");
    expect(result).not.toHaveProperty("customerEmail");
    expect(result).not.toHaveProperty("internalNote");
    expect(result).not.toHaveProperty("publicTokenDigest");
  });

  it("fails closed before repository lookup for malformed tokens", async () => {
    const store = repository();
    const service = createPaymentRequestService({ repository: store });
    await expect(service.publicByToken("short")).resolves.toBeNull();
    expect(store.findPublicByDigest).not.toHaveBeenCalled();
  });

  it("rotates by storing a new digest and returns a new raw token", async () => {
    const store = repository();
    const service = createPaymentRequestService({ repository: store });
    const result = await service.rotate("admin-1", request.id);

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.rotateToken).toHaveBeenCalledWith({
      requestId: request.id,
      publicTokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      actorId: "admin-1",
    });
  });
});
