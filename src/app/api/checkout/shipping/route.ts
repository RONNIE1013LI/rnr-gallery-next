import { getOptionalSession } from "@/server/auth/get-optional-session";
import {
  createCheckoutService,
  InvalidCheckoutStateError,
} from "@/server/checkout/checkout-service";
import type { CheckoutStateRepository } from "@/server/checkout/checkout-repository";
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
import {
  createShippingService,
  selectShippingProvider,
  ShippingUnavailableError,
} from "@/server/shipping/shipping-service";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };

type ShippingQuoter = { quoteShipping(sessionId: string): Promise<unknown> };
type Dependencies = Readonly<{
  repository: CheckoutStateRepository;
  checkoutService: ShippingQuoter;
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
  const repository = createDrizzleCheckoutRepository(getDatabase());
  return {
    repository,
    checkoutService: createCheckoutService({
      repository,
      shippingService: createShippingService({ provider: selectShippingProvider() }),
    }),
    getOptionalSession,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function errorResponse(error: unknown) {
  if (error instanceof MutationRequestError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof CheckoutAccessError) {
    return json({ error: { code: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", message: error.message } }, error.status);
  }
  if (error instanceof ShippingUnavailableError) {
    return json({ error: { code: "POST_UNAVAILABLE", message: error.message } }, 503);
  }
  if (error instanceof InvalidCheckoutStateError) {
    return json({ error: { code: "CHECKOUT_CHANGED", message: error.message } }, 409);
  }
  if (error instanceof SyntaxError) {
    return json({ error: { code: "INVALID_JSON", message: "Request body is invalid" } }, 400);
  }
  return json({ error: { code: "INTERNAL_ERROR", message: "Shipping could not be quoted" } }, 500);
}

export function createCheckoutShippingRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps = dependencies ?? defaults();
    try {
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new SyntaxError("Request body is invalid");
      }
      const token = readCheckoutSessionToken(request);
      if (!token) throw new CheckoutAccessError(401);
      const authenticated = await deps.getOptionalSession(request.headers);
      const session = await deps.repository.findActiveSessionByTokenDigest(
        hashCheckoutSessionToken(token),
        deps.now?.() ?? new Date(),
      );
      if (!session) throw new CheckoutAccessError(401);
      if (session.customerId && session.customerId !== authenticated?.user.id) {
        throw new CheckoutAccessError(authenticated ? 403 : 401);
      }

      return json({ shipping: await deps.checkoutService.quoteShipping(session.id) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createCheckoutShippingRoute();
