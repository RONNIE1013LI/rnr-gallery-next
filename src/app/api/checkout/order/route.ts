import { z, ZodError } from "zod";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import {
  hashCheckoutSessionToken,
  readCheckoutSessionToken,
} from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
} from "@/server/http/mutation-request";
import { createDrizzleOrderRepository } from "@/server/orders/drizzle-order-repository";
import type { OrderRepository } from "@/server/orders/order-repository";
import {
  createOrderService,
  OrderConflictError,
  OrderStateChangedError,
  type PaymentStartDTO,
} from "@/server/orders/order-service";
import {
  createShippingService,
  selectShippingProvider,
  ShippingUnavailableError,
} from "@/server/shipping/shipping-service";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };
const inputSchema = z.object({
  idempotencyKey: z.uuid(),
  checkoutVersion: z.number().int().positive(),
  cartDigest: z.string().regex(/^[a-f0-9]{64}$/),
  shipping: z.object({ method: z.enum(["post", "pickup"]), serviceCode: z.string().min(1), amountExGstCents: z.number().int().nonnegative(), gstCents: z.number().int().nonnegative(), amountInclGstCents: z.number().int().nonnegative(), isTest: z.boolean() }).strict(),
}).strict();

type OrderCreator = {
  createOrder(sessionId: string, idempotencyKey: string, reviewed: Omit<z.infer<typeof inputSchema>, "idempotencyKey">): Promise<PaymentStartDTO>;
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
    }),
    getOptionalSession,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function publicOrder(order: PaymentStartDTO): PaymentStartDTO {
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
      const input = inputSchema.parse(await request.json());
      const rawToken = readCheckoutSessionToken(request);
      if (!rawToken) throw new CheckoutAccessError(401);

      const authenticated = await deps.getOptionalSession(request.headers);
      const session = await deps.repository.findSessionByTokenDigest(
        hashCheckoutSessionToken(rawToken),
        deps.now?.() ?? new Date(),
      );
      if (!session) throw new CheckoutAccessError(401);
      if (session.customerId && session.customerId !== authenticated?.user.id) {
        throw new CheckoutAccessError(authenticated ? 403 : 401);
      }

      const order = await deps.orderService.createOrder(
        session.id,
        input.idempotencyKey,
        { checkoutVersion: input.checkoutVersion, cartDigest: input.cartDigest, shipping: input.shipping },
      );
      return json({ order: publicOrder(order) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createCheckoutOrderRoute();
