import { z, ZodError } from "zod";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { parseAuthConfig } from "@/server/auth/config";
import type {
  CheckoutStateRepository,
} from "@/server/checkout/checkout-repository";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import {
  hashCheckoutSessionToken,
  readCheckoutSessionToken,
} from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import { parsePaymentConfig } from "@/server/payments/config";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import {
  createPaymentService,
  PaymentServiceError,
  type PublicPaymentMethod,
  type ReviewedPaymentAccess,
} from "@/server/payments/payment-service";
import { selectPaymentProviders } from "@/server/payments/provider-registry";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };
const inputSchema = z.object({
  checkoutVersion: z.number().int().positive(),
  cartDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

type PaymentMethodService = {
  availableMethods(access: ReviewedPaymentAccess): Promise<readonly PublicPaymentMethod[]>;
};
type Dependencies = Readonly<{
  repository: CheckoutStateRepository;
  paymentService: PaymentMethodService;
  getOptionalSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  trustedOrigin?: string;
  now?: () => Date;
}>;

class CheckoutAccessError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(status === 401 ? "Checkout session is required" : "Checkout session is forbidden");
  }
}

function defaults(): Dependencies {
  const database = getDatabase();
  const checkoutRepository = createDrizzleCheckoutRepository(database);
  const config = parsePaymentConfig();
  return {
    repository: checkoutRepository,
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

function publicMethods(methods: readonly PublicPaymentMethod[]) {
  return methods.map((method) => Object.freeze({
    method: method.method,
    label: method.label,
    isTest: method.isTest,
  }));
}

function errorResponse(error: unknown) {
  if (error instanceof MutationRequestError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return json({ error: { code: "INVALID_REQUEST", message: "Request body is invalid" } }, 400);
  }
  if (error instanceof CheckoutAccessError) {
    return json({
      error: {
        code: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        message: error.message,
      },
    }, error.status);
  }
  if (error instanceof PaymentServiceError && error.code === "CHECKOUT_CHANGED") {
    return json({ error: { code: error.code, message: error.message } }, 409);
  }
  return json({ error: { code: "INTERNAL_ERROR", message: "Payment methods could not be loaded" } }, 500);
}

export function createCheckoutPaymentMethodsRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps = dependencies ?? defaults();
    try {
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const input = inputSchema.parse(await parseBoundedJson(request));
      const rawToken = readCheckoutSessionToken(request);
      if (!rawToken) throw new CheckoutAccessError(401);
      const authenticated = await deps.getOptionalSession(request.headers);
      const session = await deps.repository.findActiveSessionByTokenDigest(
        hashCheckoutSessionToken(rawToken),
        deps.now?.() ?? new Date(),
      );
      if (!session) throw new CheckoutAccessError(401);
      if (session.customerId && session.customerId !== authenticated?.user.id) {
        throw new CheckoutAccessError(authenticated ? 403 : 401);
      }
      const methods = await deps.paymentService.availableMethods({
        sessionId: session.id,
        checkoutVersion: input.checkoutVersion,
        cartDigest: input.cartDigest,
      });
      return json({ methods: publicMethods(methods) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createCheckoutPaymentMethodsRoute();
