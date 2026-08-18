import { randomUUID } from "node:crypto";
import {
  createPaymentRequestInputSchema,
  recordBankTransferInputSchema,
  reverseLedgerEntryInputSchema,
} from "./input-schema";
import type {
  PaymentRequestRecord,
  PaymentRequestRepository,
} from "./payment-request-repository";
import { digestPaymentRequestToken, generatePaymentRequestToken } from "./token";
import type {
  AdminPaymentRequestDTO,
  AdminOrderPaymentSummaryDTO,
  PaymentRequestCreateResult,
  PublicPaymentRequestDTO,
} from "./types";

function defaultRequestNumber() {
  const year = new Date().getUTCFullYear();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `PAY-${year}-${suffix}`;
}

function publicDto(request: PaymentRequestRecord): PublicPaymentRequestDTO {
  return Object.freeze({
    requestNumber: request.requestNumber,
    kind: request.kind,
    ...(request.orderNumber ? { orderNumber: request.orderNumber } : {}),
    description: request.description,
    amountCents: request.amountCents,
    currency: request.currency,
    status: request.status,
    methods: Object.freeze([...request.enabledPaymentMethods]),
    ...(request.expiresAt ? { expiresAt: request.expiresAt.toISOString() } : {}),
  });
}

function adminDto(request: PaymentRequestRecord): AdminPaymentRequestDTO {
  return Object.freeze({
    ...publicDto(request),
    id: request.id,
    ...(request.orderId ? { orderId: request.orderId } : {}),
    ...(request.customerName ? { customerName: request.customerName } : {}),
    ...(request.customerEmail ? { customerEmail: request.customerEmail } : {}),
    ...(request.internalNote ? { internalNote: request.internalNote } : {}),
    ...(request.statusReason ? { statusReason: request.statusReason } : {}),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  });
}

function orderSummaryDto(
  summary: Awaited<ReturnType<PaymentRequestRepository["getOrderSummary"]>>,
): AdminOrderPaymentSummaryDTO {
  return Object.freeze({
    orderId: summary.orderId,
    orderNumber: summary.orderNumber,
    currency: summary.currency,
    totalCents: summary.totalCents,
    netPaidCents: summary.netPaidCents,
    outstandingCents: summary.outstandingCents,
    reservedCents: summary.reservedCents,
    unreservedCents: Math.max(0, summary.outstandingCents - summary.reservedCents),
    ledger: Object.freeze(summary.ledger.map((entry) => Object.freeze({
      id: entry.id,
      entryType: entry.entryType,
      direction: entry.direction,
      amountCents: entry.amountCents,
      currency: entry.currency,
      receivedAt: entry.receivedAt.toISOString(),
      ...(entry.reference ? { reference: entry.reference } : {}),
      ...(entry.payerName ? { payerName: entry.payerName } : {}),
      ...(entry.note ? { note: entry.note } : {}),
      ...(entry.reversesEntryId ? { reversesEntryId: entry.reversesEntryId } : {}),
      createdAt: entry.createdAt.toISOString(),
    }))),
  });
}

export function createPaymentRequestService({
  repository,
  generateRequestNumber = defaultRequestNumber,
}: Readonly<{
  repository: PaymentRequestRepository;
  generateRequestNumber?: () => string;
}>) {
  return Object.freeze({
    async listAdmin(): Promise<readonly AdminPaymentRequestDTO[]> {
      return Object.freeze((await repository.listAdminRequests()).map(adminDto));
    },

    async adminById(requestId: string): Promise<AdminPaymentRequestDTO | null> {
      const request = await repository.findAdminById(requestId);
      return request ? adminDto(request) : null;
    },

    async orderSummary(orderId: string): Promise<AdminOrderPaymentSummaryDTO> {
      return orderSummaryDto(await repository.getOrderSummary(orderId));
    },

    async create(actorId: string, input: unknown): Promise<PaymentRequestCreateResult> {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      const parsed = createPaymentRequestInputSchema.parse(input);
      const token = generatePaymentRequestToken();
      const created = await repository.createRequest({
        requestNumber: generateRequestNumber(),
        publicTokenDigest: token.digest,
        kind: parsed.kind,
        orderId: parsed.kind === "order_balance" ? parsed.orderId : null,
        customerName: parsed.kind === "standalone" ? parsed.customerName ?? null : null,
        customerEmail: parsed.kind === "standalone" ? parsed.customerEmail ?? null : null,
        description: parsed.description,
        currency: parsed.currency,
        amountCents: parsed.amountCents,
        enabledPaymentMethods: parsed.enabledPaymentMethods,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        internalNote: parsed.internalNote ?? null,
        createdBy: actorId,
        idempotencyKey: parsed.idempotencyKey,
      });
      return Object.freeze({
        request: adminDto(created.request),
        ...(created.outcome === "created" ? { rawToken: token.rawToken } : {}),
      });
    },

    async publicByToken(rawToken: string): Promise<PublicPaymentRequestDTO | null> {
      let digest: string;
      try {
        digest = digestPaymentRequestToken(rawToken);
      } catch {
        return null;
      }
      const request = await repository.findPublicByDigest(digest);
      return request ? publicDto(request) : null;
    },

    async rotate(actorId: string, requestId: string): Promise<PaymentRequestCreateResult> {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      const token = generatePaymentRequestToken();
      const request = await repository.rotateToken({
        requestId,
        publicTokenDigest: token.digest,
        actorId,
      });
      return Object.freeze({ request: adminDto(request), rawToken: token.rawToken });
    },

    async cancel(actorId: string, requestId: string): Promise<AdminPaymentRequestDTO> {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      return adminDto(await repository.cancel({ requestId, actorId }));
    },

    async recordBankTransfer(actorId: string, input: unknown) {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      const parsed = recordBankTransferInputSchema.parse(input);
      return repository.recordBankTransfer({
        orderId: parsed.orderId,
        amountCents: parsed.amountCents,
        receivedAt: new Date(parsed.receivedAt),
        reference: parsed.reference ?? null,
        payerName: parsed.payerName ?? null,
        note: parsed.note ?? null,
        createdBy: actorId,
        idempotencyKey: parsed.idempotencyKey,
      });
    },

    async reverseBankTransfer(actorId: string, input: unknown) {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      const parsed = reverseLedgerEntryInputSchema.parse(input);
      return repository.reverseBankTransfer({
        entryId: parsed.entryId,
        reason: parsed.reason,
        createdBy: actorId,
        idempotencyKey: parsed.idempotencyKey,
      });
    },
  });
}
