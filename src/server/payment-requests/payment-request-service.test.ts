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
  createdByName: "Payment Request Admin",
  createdAt: new Date("2026-08-18T00:00:00.000Z"),
  updatedAt: new Date("2026-08-18T00:00:00.000Z"),
});

function repository(overrides: Partial<PaymentRequestRepository> = {}) {
  return {
    databaseNow: vi.fn(async () => new Date("2026-09-26T00:00:00Z")),
    activateByDigest: vi.fn(async () => request),
    authorizeAttemptPayment: vi.fn(async () => true),
    authorizeAttemptCapture: vi.fn(async () => true),
    expireStaleRequests: vi.fn(async () => 0),
    createRequest: vi.fn(async () => ({ outcome: "created" as const, request })),
    findPublicByDigest: vi.fn(async () => request),
    listAdminRequests: vi.fn(async () => [request]),
    findAdminById: vi.fn(async () => request),
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
      idempotencyKey: "payment-request-create-1",
      amountCents: 20_000,
      currency: "NZD",
      description: "Custom design deposit",
      enabledPaymentMethods: ["card"],
    });

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.createRequest).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "payment-request-create-1",
      requestNumber: "PAY-2026-ABC123",
      expiresAt: null,
      publicTokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(vi.mocked(store.createRequest).mock.calls[0][0].publicTokenDigest)
      .not.toBe(result.rawToken);
  });

  it("does not expose a second raw token when create is an idempotent replay", async () => {
    const store = repository({
      createRequest: vi.fn(async () => ({ outcome: "existing" as const, request })),
    });
    const service = createPaymentRequestService({ repository: store });

    const result = await service.create("admin-1", {
      kind: "standalone",
      idempotencyKey: "payment-request-create-replay",
      amountCents: 20_000,
      currency: "NZD",
      description: "Custom design deposit",
      enabledPaymentMethods: ["card"],
    });

    expect(result).toEqual({ request: expect.objectContaining({ id: request.id }) });
    expect(result).not.toHaveProperty("rawToken");
  });

  it("returns a public allowlist without stored identity or internal values", async () => {
    const service = createPaymentRequestService({ repository: repository() });
    const result = await service.publicByToken("A".repeat(43));

    expect(result).toEqual({
      serverNow: "2026-09-26T00:00:00.000Z",
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
    expect(result).not.toHaveProperty("createdByName");
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

  it("returns allowlisted Admin request records without token digests", async () => {
    const store = repository({
      listAdminRequests: vi.fn(async () => [request]),
      findAdminById: vi.fn(async () => request),
    } as Partial<PaymentRequestRepository>);
    const service = createPaymentRequestService({ repository: store });

    const [listed] = await service.listAdmin();
    const detail = await service.adminById(request.id);
    expect(listed).toMatchObject({
      id: request.id,
      customerEmail: request.customerEmail,
      createdByName: "Payment Request Admin",
    });
    expect(detail).toMatchObject({
      id: request.id,
      internalNote: request.internalNote,
      createdByName: "Payment Request Admin",
    });
    expect(listed).not.toHaveProperty("publicTokenDigest");
    expect(detail).not.toHaveProperty("publicTokenDigest");
  });

  it("serializes immutable Order ledger entries for the Admin interface", async () => {
    const store = repository({
      getOrderSummary: vi.fn(async () => ({
        orderId: "order-1",
        orderNumber: "08001",
        currency: "NZD" as const,
        totalCents: 40_000,
        netPaidCents: 20_000,
        outstandingCents: 20_000,
        reservedCents: 5_000,
        ledger: [{
          id: "ledger-1", orderId: "order-1", paymentRequestId: null,
          paymentAttemptId: null, entryType: "bank_transfer" as const,
          direction: "credit" as const, amountCents: 20_000, currency: "NZD" as const,
          receivedAt: new Date("2026-08-18T05:00:00.000Z"), reference: "BANK-1",
          payerName: null, note: null, reversesEntryId: null,
          createdAt: new Date("2026-08-18T05:01:00.000Z"),
        }],
      })),
    });
    const summary = await createPaymentRequestService({ repository: store }).orderSummary("order-1");

    expect(summary).toMatchObject({ outstandingCents: 20_000, reservedCents: 5_000 });
    expect(summary.ledger[0]).toMatchObject({
      receivedAt: "2026-08-18T05:00:00.000Z",
      createdAt: "2026-08-18T05:01:00.000Z",
    });
  });
});


describe("payment request first-open lifecycle DTO", () => {
  it("read-only lookups never activate and return the database clock", async () => {
    const store = repository();
    const service = createPaymentRequestService({ repository: store });
    const dto = await service.publicByToken("a".repeat(43));
    expect(store.activateByDigest).not.toHaveBeenCalled();
    expect(dto?.serverNow).toBe("2026-09-26T00:00:00.000Z");
    expect(dto?.expiresAt).toBeUndefined();
  });

  it("only explicit activation delegates to the atomic repository operation", async () => {
    const store = repository({ activateByDigest: vi.fn(async () => ({ ...request, expiresAt: new Date("2026-09-26T12:00:00Z") })) });
    const dto = await createPaymentRequestService({ repository: store }).activateByToken("a".repeat(43));
    expect(store.activateByDigest).toHaveBeenCalledOnce();
    expect(store.preflightAndClaimAttempt).not.toHaveBeenCalled();
    expect(dto?.expiresAt).toBe("2026-09-26T12:00:00.000Z");
  });

  it.each(["pending", "paid", "cancelled"] as const)("maps %s at expiry without masking paid", async (status) => {
    const store = repository({ findPublicByDigest: vi.fn(async () => ({ ...request, status, statusReason: status === "cancelled" ? "payment_link_expired" : null, expiresAt: new Date("2026-09-25T12:00:00Z") })) });
    expect((await createPaymentRequestService({ repository: store }).publicByToken("a".repeat(43)))?.status)
      .toBe(status === "paid" ? "paid" : "expired");
  });
});
