import { z, ZodError } from "zod";
import { parseAuthConfig } from "@/server/auth/config";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import {
  hashCheckoutSessionToken,
  readCheckoutSessionToken,
} from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
} from "@/server/http/mutation-request";
import { parsePaymentConfig } from "@/server/payments/config";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import type { PaymentOrderAccess } from "@/server/payments/payment-repository";
import {
  createPaymentService,
  PaymentServiceError,
  type PaymentStartResult,
} from "@/server/payments/payment-service";
import { selectPaymentProviders } from "@/server/payments/provider-registry";
import type { PaymentActionDTO, PublicPaymentDTO } from "@/server/payments/public-dto";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };
const inputSchema = z.object({
  method: z.enum(["card", "afterpay", "zip"]),
  idempotencyKey: z.uuid(),
}).strict();

type PaymentStarter = {
  start(
    access: PaymentOrderAccess,
    method: "card" | "afterpay" | "zip",
    idempotencyKey: string,
  ): Promise<PaymentStartResult>;
};
type Dependencies = Readonly<{
  paymentService: PaymentStarter;
  getOptionalSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  trustedOrigin?: string;
}>;
type RouteContext = { params: Promise<{ orderNumber: string }> };

function defaults(): Dependencies {
  const database = getDatabase();
  const config = parsePaymentConfig();
  const checkoutRepository = createDrizzleCheckoutRepository(database);
  return {
    paymentService: createPaymentService({
      repository: createDrizzlePaymentRepository(database),
      checkoutAuthority: checkoutRepository,
      providers: selectPaymentProviders(config),
      returnBaseUrl: config.operations.returnBaseUrl ?? parseAuthConfig().origin,
    }),
    getOptionalSession,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function publicPayment(payment: PublicPaymentDTO): PublicPaymentDTO {
  return Object.freeze({
    method: payment.method,
    status: payment.status,
    isTest: payment.isTest,
    canRetry: payment.canRetry,
  });
}

function publicAction(action: PaymentActionDTO | null): PaymentActionDTO | null {
  if (!action) return null;
  if (action.kind === "elements") {
    return Object.freeze({
      kind: "elements", method: "card", clientSecret: action.clientSecret,
    });
  }
  if (action.kind === "redirect") {
    return Object.freeze({
      kind: "redirect", method: action.method, redirectUrl: action.redirectUrl,
    });
  }
  return Object.freeze({
    kind: "test", method: action.method,
    redirectUrl: action.redirectUrl, isTest: true,
  });
}

function publicResult(result: PaymentStartResult): PaymentStartResult {
  return Object.freeze({
    payment: publicPayment(result.payment),
    action: publicAction(result.action),
  });
}

function errorResponse(error: unknown) {
  if (error instanceof MutationRequestError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return json({ error: { code: "INVALID_REQUEST", message: "Request body is invalid" } }, 400);
  }
  if (error instanceof PaymentServiceError) {
    const status = error.code === "ORDER_NOT_FOUND"
      ? 404
      : error.code === "PAYMENT_ATTEMPT_IN_PROGRESS"
        ? 409
        : 503;
    return json({ error: { code: error.code, message: error.message } }, status);
  }
  return json({ error: { code: "INTERNAL_ERROR", message: "Payment could not be started" } }, 500);
}

export function createOrderPaymentRoute(dependencies?: Dependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const deps = dependencies ?? defaults();
    try {
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const input = inputSchema.parse(await request.json());
      const { orderNumber } = await context.params;
      const authenticated = await deps.getOptionalSession(request.headers);
      const rawToken = readCheckoutSessionToken(request);
      const accesses: PaymentOrderAccess[] = [];
      if (authenticated) {
        accesses.push({
          kind: "customer", orderNumber, customerId: authenticated.user.id,
        });
      }
      if (rawToken) {
        accesses.push({
          kind: "guest", orderNumber,
          tokenDigest: hashCheckoutSessionToken(rawToken),
        });
      }
      if (accesses.length === 0) {
        throw new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable");
      }

      for (const [index, access] of accesses.entries()) {
        try {
          const result = await deps.paymentService.start(
            access,
            input.method,
            input.idempotencyKey,
          );
          return json(publicResult(result));
        } catch (error) {
          if (
            error instanceof PaymentServiceError &&
            error.code === "ORDER_NOT_FOUND" &&
            index < accesses.length - 1
          ) continue;
          throw error;
        }
      }
      throw new PaymentServiceError("ORDER_NOT_FOUND", "Order is unavailable");
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createOrderPaymentRoute();
