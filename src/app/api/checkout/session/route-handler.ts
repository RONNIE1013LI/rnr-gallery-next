import { ZodError } from "zod";
import { InvalidCheckoutCartError } from "@/domain/checkout/types";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import {
  createCheckoutService,
  InvalidCheckoutStateError,
} from "@/server/checkout/checkout-service";
import {
  ensureCheckoutSession,
  type CheckoutStateRecord,
  type CheckoutStateRepository,
  UnownedUploadReferenceError,
} from "@/server/checkout/checkout-repository";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { toPublicCheckoutDTO } from "@/server/checkout/public-dto";
import {
  createCheckoutSessionToken,
  readCheckoutSessionToken,
  sessionCookie,
} from "@/server/checkout/session-cookie";
import { getDatabase } from "@/server/db/client";
import { getGalleryRuntime } from "@/server/gallery/gallery-runtime";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import {
  assertTrustedMutationRequest,
  parseBoundedJson,
  MutationRequestError,
} from "@/server/http/mutation-request";
import {
  createShippingService,
  selectShippingProvider,
} from "@/server/shipping/shipping-service";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };

type CheckoutUpdater = {
  updateSession(sessionId: string, input: never): Promise<CheckoutStateRecord>;
};

type Dependencies = Readonly<{
  repository: CheckoutStateRepository;
  checkoutService: CheckoutUpdater;
  getOptionalSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  trustedOrigin?: string;
  createToken?: () => string;
  now?: () => Date;
  environment?: string;
}>;

function defaults(): Dependencies {
  const repository = createDrizzleCheckoutRepository(getDatabase());
  return {
    repository,
    checkoutService: createCheckoutService({
      repository,
      shippingService: createShippingService({
        provider: selectShippingProvider(),
      }),
      gallerySelectionService: getGalleryRuntime().selectionService,
      productRegistryService: getProductRegistryRuntime(),
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
  if (error instanceof SyntaxError) {
    return json({ error: { code: "INVALID_JSON", message: "Request body is invalid" } }, 400);
  }
  if (
    error instanceof ZodError ||
    error instanceof InvalidCheckoutCartError ||
    error instanceof InvalidCheckoutStateError
  ) {
    return json({ error: { code: "VALIDATION_ERROR", message: error.message } }, 422);
  }
  if (error instanceof UnownedUploadReferenceError) {
    return json({ error: { code: "UPLOAD_NOT_OWNED", message: error.message } }, 403);
  }
  return json({ error: { code: "INTERNAL_ERROR", message: "Checkout could not be updated" } }, 500);
}

export function createCheckoutSessionRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps = dependencies ?? defaults();
    try {
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      const input = await parseBoundedJson(request);
      const authenticated = await deps.getOptionalSession(request.headers);
      const checkout = await ensureCheckoutSession({
        repository: deps.repository,
        rawToken: readCheckoutSessionToken(request),
        customerId: authenticated?.user.id ?? null,
        now: deps.now?.() ?? new Date(),
        createToken: deps.createToken ?? createCheckoutSessionToken,
      });

      let state: CheckoutStateRecord;
      try {
        state = await deps.checkoutService.updateSession(checkout.session.id, input as never);
      } catch (error) {
        if (checkout.created) {
          await Promise.allSettled([
            deps.repository.deleteEmptySession(checkout.session.id),
          ]);
        }
        throw error;
      }

      const response = json({ checkout: toPublicCheckoutDTO(state) });
      if (checkout.cookieToken) {
        response.headers.append(
          "Set-Cookie",
          serializeCookie(sessionCookie(checkout.cookieToken, deps.environment)),
        );
      }
      return response;
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function serializeCookie(cookie: ReturnType<typeof sessionCookie>): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    "HttpOnly",
    `SameSite=${cookie.sameSite}`,
  ];
  if (cookie.secure) parts.push("Secure");
  return parts.join("; ");
}

export const POST = createCheckoutSessionRoute();
