import { z } from "zod";
import { parseAuthConfig } from "@/server/auth/config";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";
import { paymentRequestErrorResponse } from "../../../payment-requests/route-handler";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("bank_transfer"),
    amountCents: z.number(),
    receivedAt: z.string(),
    reference: z.unknown().optional(),
    payerName: z.unknown().optional(),
    note: z.unknown().optional(),
    idempotencyKey: z.unknown(),
  }).strict(),
  z.object({
    action: z.literal("reverse"),
    entryId: z.unknown(),
    reason: z.unknown(),
    idempotencyKey: z.unknown(),
  }).strict(),
]);
type Access = Readonly<{ user: Readonly<{ id: string }> }>;
type LedgerResult = Awaited<ReturnType<ReturnType<typeof getPaymentRequestRuntime>["recordBankTransfer"]>>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  recordBankTransfer: (actorId: string, input: unknown) => Promise<LedgerResult>;
  reverseBankTransfer: (actorId: string, input: unknown) => Promise<LedgerResult>;
  origin: string;
}>;
type Context = Readonly<{ params: Promise<{ orderId: string }> }>;

export function createAdminPaymentLedgerRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getPaymentRequestRuntime();
    return {
      requirePermission: requireAdminPermission,
      recordBankTransfer: service.recordBankTransfer,
      reverseBankTransfer: service.reverseBankTransfer,
      origin: parseAuthConfig().origin,
    };
  };
  return {
    async POST(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_payment");
        assertTrustedMutationRequest(request, deps.origin);
        const { orderId } = await context.params;
        const command = commandSchema.parse(await parseBoundedJson(request));
        const entry = command.action === "bank_transfer"
          ? await deps.recordBankTransfer(access.user.id, {
              orderId,
              amountCents: command.amountCents,
              receivedAt: command.receivedAt,
              reference: command.reference,
              payerName: command.payerName,
              note: command.note,
              idempotencyKey: command.idempotencyKey,
            })
          : await deps.reverseBankTransfer(access.user.id, {
              entryId: command.entryId,
              reason: command.reason,
              idempotencyKey: command.idempotencyKey,
            });
        return Response.json({ entry }, { headers: noStore });
      } catch (error) {
        return paymentRequestErrorResponse(error);
      }
    },
  };
}

const route = createAdminPaymentLedgerRoute();
export const POST = route.POST;
