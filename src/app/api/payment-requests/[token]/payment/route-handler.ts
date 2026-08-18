import { ZodError } from "zod";
import { parseAuthConfig } from "@/server/auth/config";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
  parseBoundedJson,
} from "@/server/http/mutation-request";
import { PaymentRequestConflictError } from "@/server/payment-requests/drizzle-payment-request-repository";
import { standalonePayerInputSchema, type StandalonePayerInput } from "@/server/payment-requests/input-schema";
import { getPublicPaymentRequestRuntime } from "@/server/payment-requests/public-payment-request-runtime";
import { digestPaymentRequestToken } from "@/server/payment-requests/token";
import type { PublicPaymentRequestDTO } from "@/server/payment-requests/types";
import { PaymentServiceError, type PaymentStartResult } from "@/server/payments/payment-service";

export const runtime = "nodejs";
const privateNoStore = { "Cache-Control": "private, no-store, max-age=0" };
type Context = Readonly<{ params: Promise<{ token: string }> }>;
type Dependencies = Readonly<{
  publicByToken: (token: string) => Promise<Pick<PublicPaymentRequestDTO, "status"> | null>;
  start: (token: string, input: StandalonePayerInput) => Promise<PaymentStartResult>;
  origin: string;
}>;

function errorResponse(error: unknown) {
  if (error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: privateNoStore });
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return Response.json({ error: "Payment details are invalid" }, { status: 400, headers: privateNoStore });
  }
  if (error instanceof PaymentRequestConflictError) {
    return Response.json({ error: "Payment request is no longer payable" }, { status: 409, headers: privateNoStore });
  }
  if (error instanceof PaymentServiceError) {
    const status = error.code === "PAYMENT_ATTEMPT_IN_PROGRESS" ? 409 : 503;
    return Response.json({ error: error.message }, { status, headers: privateNoStore });
  }
  return Response.json({ error: "Payment could not be started" }, { status: 500, headers: privateNoStore });
}

export function createPaymentRequestPaymentRoute(dependencies?: Dependencies) {
  const defaults = (): Dependencies => {
    const services = getPublicPaymentRequestRuntime();
    return {
      publicByToken: services.requests.publicByToken,
      start: async (token, input) => services.payments.startPaymentRequest({
        rawToken: token,
        tokenDigest: digestPaymentRequestToken(token),
        payerSnapshot: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone ?? "",
          ...("address" in input ? { address: input.address } : {}),
        },
      }, input.method),
      origin: parseAuthConfig().origin,
    };
  };
  return {
    async POST(request: Request, context: Context) {
      const deps = dependencies ?? defaults();
      try {
        assertTrustedMutationRequest(request, deps.origin);
        const { token } = await context.params;
        const stored = await deps.publicByToken(token);
        if (!stored) {
          return Response.json({ error: "Payment request is unavailable" }, { status: 404, headers: privateNoStore });
        }
        if (stored.status !== "pending") {
          return Response.json({ error: "Payment request is no longer payable" }, { status: 409, headers: privateNoStore });
        }
        const input = standalonePayerInputSchema.parse(await parseBoundedJson(request));
        return Response.json(await deps.start(token, input), { headers: privateNoStore });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

const route = createPaymentRequestPaymentRoute();
export const POST = route.POST;
