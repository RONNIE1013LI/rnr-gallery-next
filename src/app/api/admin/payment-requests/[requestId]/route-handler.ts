import { z } from "zod";
import { parseAuthConfig } from "@/server/auth/config";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";
import type {
  AdminPaymentRequestDTO,
  PaymentRequestCreateResult,
} from "@/server/payment-requests/types";
import { paymentRequestErrorResponse } from "../route-handler";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const actionSchema = z.object({ action: z.enum(["cancel", "rotate_token"]) }).strict();
type Access = Readonly<{ user: Readonly<{ id: string }> }>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  cancel: (actorId: string, requestId: string) => Promise<AdminPaymentRequestDTO>;
  rotate: (actorId: string, requestId: string) => Promise<PaymentRequestCreateResult>;
  origin: string;
}>;
type Context = Readonly<{ params: Promise<{ requestId: string }> }>;

export function createAdminPaymentRequestRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getPaymentRequestRuntime();
    return {
      requirePermission: requireAdminPermission,
      cancel: service.cancel,
      rotate: service.rotate,
      origin: parseAuthConfig().origin,
    };
  };
  return {
    async PATCH(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_payment");
        assertTrustedMutationRequest(request, deps.origin);
        const { requestId } = await context.params;
        const { action } = actionSchema.parse(await parseBoundedJson(request));
        if (action === "cancel") {
          return Response.json({ request: await deps.cancel(access.user.id, requestId) }, {
            headers: noStore,
          });
        }
        const result = await deps.rotate(access.user.id, requestId);
        return Response.json({
          request: result.request,
          ...(result.rawToken
            ? { paymentUrl: `${deps.origin}/pay/${encodeURIComponent(result.rawToken)}` }
            : {}),
        }, { headers: noStore });
      } catch (error) {
        return paymentRequestErrorResponse(error);
      }
    },
  };
}

const route = createAdminPaymentRequestRoute();
export const PATCH = route.PATCH;
