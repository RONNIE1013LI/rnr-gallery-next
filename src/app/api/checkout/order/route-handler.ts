import { z, ZodError } from "zod";
import { ATTRIBUTION_FIELDS } from "@/domain/analytics/attribution";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import {
  hashCheckoutSessionToken,
  readCheckoutSessionToken,
} from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import { createDrizzleOrderRepository } from "@/server/orders/drizzle-order-repository";
import type { OrderRepository } from "@/server/orders/order-repository";
import {
  createOrderService,
  OrderConflictError,
  OrderStateChangedError,
  type PaymentStartDTO,
  type PaymentOrderCreationResult,
} from "@/server/orders/order-service";
import {
  createShippingService,
  selectShippingProvider,
  ShippingUnavailableError,
} from "@/server/shipping/shipping-service";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };
const attributionSchema = z.object(Object.fromEntries(
  ATTRIBUTION_FIELDS.map((field) => [field, z.string().trim().min(1).max(200).optional()]),
) as Record<typeof ATTRIBUTION_FIELDS[number], z.ZodOptional<z.ZodString>>).strict()
  .refine((value) => Object.values(value).some(Boolean))
  .optional();
const inputSchema = z.object({
  idempotencyKey: z.uuid(),
  checkoutVersion: z.number().int().positive(),
  cartDigest: z.string().regex(/^[a-f0-9]{64}$/),
  shipping: z.object({ method: z.enum(["post", "pickup"]), serviceCode: z.string().min(1), amountExGstCents: z.number().int().nonnegative(), gstCents: z.number().int().nonnegative(), amountInclGstCents: z.number().int().nonnegative(), isTest: z.boolean() }).strict(),
  attribution: attributionSchema,
}).strict();

type OrderCreator = {
  createOrder(sessionId: string, idempotencyKey: string, reviewed: Omit<z.infer<typeof inputSchema>, "idempotencyKey">): Promise<PaymentOrderCreationResult>;
};
type Dependencies = Readonly<{
  repository: OrderRepository;
  orderService: OrderCreator;
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
  const repository = createDrizzleOrderRepository(getDatabase());
  return {
    repository,
    orderService: createOrderService({
      repository,
      shippingService: createShippingService({ provider: selectShippingProvider() }),
      productRegistryService: getProductRegistryRuntime(),
    }),
    getOptionalSession,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function publicOrder(order: PaymentOrderCreationResult): PaymentStartDTO {
  return Object.freeze({
    orderNumber: order.orderNumber,
    currency: order.currency,
    totalInclGstCents: order.totalInclGstCents,
    paymentStatus: order.paymentStatus,
  });
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
  if (error instanceof OrderConflictError) {
    return json({ error: { code: "ORDER_CONFLICT", message: error.message } }, 409);
  }
  if (error instanceof OrderStateChangedError) {
    return json({ error: { code: "CHECKOUT_CHANGED", message: error.message } }, 409);
  }
  if (error instanceof ShippingUnavailableError) {
    return json({ error: { code: "POST_UNAVAILABLE", message: error.message } }, 503);
  }
  return json({ error: { code: "INTERNAL_ERROR", message: "Order could not be created" } }, 500);
}

export function createCheckoutOrderRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps = dependencies ?? defaults();
    try {
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const input = inputSchema.parse(await parseBoundedJson(request));
      const authenticated = await deps.getOptionalSession(request.headers);
      const customerId = authenticated?.user.id ?? null;
      const rawToken = readCheckoutSessionToken(request, customerId);
      if (!rawToken) throw new CheckoutAccessError(401);

      const session = await deps.repository.findSessionByTokenDigest(
        hashCheckoutSessionToken(rawToken),
        deps.now?.() ?? new Date(),
      );
      if (!session) throw new CheckoutAccessError(401);
      if (session.customerId !== customerId) {
        throw new CheckoutAccessError(authenticated ? 403 : 401);
      }

      const order = await deps.orderService.createOrder(
        session.id,
        input.idempotencyKey,
        { checkoutVersion: input.checkoutVersion, cartDigest: input.cartDigest, shipping: input.shipping, ...(input.attribution ? { attribution: input.attribution } : {}) },
      );
      return json({ order: publicOrder(order) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createCheckoutOrderRoute();
