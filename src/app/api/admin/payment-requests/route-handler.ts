import { ZodError } from "zod";
import { parseAuthConfig } from "@/server/auth/config";
import { requireAdminPermission } from "@/server/auth/require-admin";
import type { AdminPermission } from "@/server/auth/admin-permissions";
import { HttpError } from "@/server/auth/require-session";
import {
  MutationRequestError,
  assertTrustedMutationRequest,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import {
  PaymentRequestConflictError,
  PaymentRequestNotFoundError,
} from "@/server/payment-requests/drizzle-payment-request-repository";
import { getPaymentRequestRuntime } from "@/server/payment-requests/payment-request-runtime";
import type { PaymentRequestCreateResult } from "@/server/payment-requests/types";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
type Access = Readonly<{ user: Readonly<{ id: string }> }>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<Access>;
  create: (actorId: string, input: unknown) => Promise<PaymentRequestCreateResult>;
  origin: string;
}>;

export function paymentRequestErrorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "Invalid payment request" }, { status: 422, headers: noStore });
  }
  if (error instanceof PaymentRequestNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: noStore });
  }
  if (error instanceof PaymentRequestConflictError) {
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  return Response.json({ error: "Payment request could not be processed" }, {
    status: 500,
    headers: noStore,
  });
}

export function createAdminPaymentRequestsRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const service = getPaymentRequestRuntime();
    return {
      requirePermission: requireAdminPermission,
      create: service.create,
      origin: parseAuthConfig().origin,
    };
  };
  return {
    async POST(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("manage_payment");
        assertTrustedMutationRequest(request, deps.origin);
        const result = await deps.create(access.user.id, await parseBoundedJson(request));
        return Response.json({
          request: result.request,
          ...(result.rawToken
            ? { paymentUrl: `${deps.origin}/pay/${encodeURIComponent(result.rawToken)}` }
            : {}),
        }, { status: result.rawToken ? 201 : 200, headers: noStore });
      } catch (error) {
        return paymentRequestErrorResponse(error);
      }
    },
  };
}

const route = createAdminPaymentRequestsRoute();
export const POST = route.POST;
