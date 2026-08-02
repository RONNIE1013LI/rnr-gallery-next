import { parseAuthConfig } from "@/server/auth/config";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { getDatabase } from "@/server/db/client";
import { parsePaymentConfig } from "@/server/payments/config";
import {
  createDrizzlePaymentRepository,
  PaymentVerificationMismatchError,
} from "@/server/payments/drizzle-payment-repository";
import { createPaymentService } from "@/server/payments/payment-service";
import {
  selectPaymentProviders,
  type PaymentProviderRegistration,
} from "@/server/payments/provider-registry";
import type { VerifiedProviderEvent } from "@/server/payments/types";

export const runtime = "nodejs";

type WebhookApplyOutcome = "applied" | "duplicate" | "hash_mismatch";
type WebhookPaymentService = Readonly<{
  applyVerifiedWebhook(
    event: VerifiedProviderEvent,
    rawBody: Uint8Array,
  ): Promise<WebhookApplyOutcome>;
}>;
type Dependencies = Readonly<{
  providers: readonly PaymentProviderRegistration[];
  paymentService: WebhookPaymentService;
}>;
type RouteContext = Readonly<{ params: Promise<{ provider: string }> }>;

const noStoreHeaders = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function notFound() {
  return json({
    error: { code: "WEBHOOK_NOT_FOUND", message: "Webhook provider is unavailable" },
  }, 404);
}

function invalidWebhook() {
  return json({
    error: { code: "INVALID_WEBHOOK", message: "Webhook verification failed" },
  }, 400);
}

function defaults(): Dependencies {
  const database = getDatabase();
  const config = parsePaymentConfig();
  const providers = selectPaymentProviders(config);
  const checkoutAuthority = createDrizzleCheckoutRepository(database);
  return {
    providers,
    paymentService: createPaymentService({
      repository: createDrizzlePaymentRepository(database),
      checkoutAuthority,
      providers,
      returnBaseUrl: config.operations.returnBaseUrl ?? parseAuthConfig().origin,
    }),
  };
}

export function createPaymentWebhookRoute(dependencies?: Dependencies) {
  return async function POST(request: Request, context: RouteContext) {
    const { provider: providerName } = await context.params;
    if (providerName !== "stripe") return notFound();

    let deps: Dependencies;
    try {
      deps = dependencies ?? defaults();
    } catch {
      return json({
        error: { code: "INTERNAL_ERROR", message: "Webhook could not be processed" },
      }, 500);
    }
    const registration = deps.providers.find((entry) =>
      entry.provider.key === "stripe" && typeof entry.provider.verifyWebhook === "function"
    );
    if (!registration?.provider.verifyWebhook) return notFound();

    let rawBody: Uint8Array;
    let event: VerifiedProviderEvent;
    try {
      rawBody = new Uint8Array(await request.arrayBuffer());
      event = await registration.provider.verifyWebhook(rawBody, request.headers);
      if (event.provider !== "stripe") return invalidWebhook();
    } catch {
      return invalidWebhook();
    }

    try {
      const result = await deps.paymentService.applyVerifiedWebhook(event, rawBody);
      if (result === "hash_mismatch") {
        return json({
          error: {
            code: "WEBHOOK_CONFLICT",
            message: "Webhook event conflicts with stored data",
          },
        }, 409);
      }
      return json({ received: true, result });
    } catch (error) {
      if (error instanceof PaymentVerificationMismatchError) return invalidWebhook();
      return json({
        error: { code: "INTERNAL_ERROR", message: "Webhook could not be processed" },
      }, 500);
    }
  };
}

export const POST = createPaymentWebhookRoute();
