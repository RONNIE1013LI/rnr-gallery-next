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

export function createPaymentRequestService({
  repository,
  generateRequestNumber = defaultRequestNumber,
}: Readonly<{
  repository: PaymentRequestRepository;
  generateRequestNumber?: () => string;
}>) {
  return Object.freeze({
    async create(actorId: string, input: unknown): Promise<PaymentRequestCreateResult> {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      const parsed = createPaymentRequestInputSchema.parse(input);
      const token = generatePaymentRequestToken();
      const request = await repository.createRequest({
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
      });
      return Object.freeze({ request: adminDto(request), rawToken: token.rawToken });
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
      });
    },

    async reverseBankTransfer(actorId: string, input: unknown) {
      if (!actorId.trim()) throw new Error("Payment administrator is required");
      const parsed = reverseLedgerEntryInputSchema.parse(input);
      return repository.reverseBankTransfer({
        entryId: parsed.entryId,
        reason: parsed.reason,
        createdBy: actorId,
      });
    },
  });
}
