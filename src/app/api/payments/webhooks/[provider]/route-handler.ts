import { after } from "next/server";
import { parseAuthConfig } from "@/server/auth/config";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { getDatabase } from "@/server/db/client";
import { createDrizzlePaymentRequestRepository } from "@/server/payment-requests/drizzle-payment-request-repository";
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
import { createMetaPaidOrderObserver } from "@/server/analytics/meta-purchase";

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
const MAX_WEBHOOK_RAW_BODY_BYTES = 256 * 1024;

class WebhookPayloadTooLargeError extends Error {}
class InvalidWebhookBodyError extends Error {}

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

function payloadTooLarge() {
  return json({
    error: { code: "PAYLOAD_TOO_LARGE", message: "Webhook payload is too large" },
  }, 413);
}

async function cancelUnreadBody(request: Request) {
  try {
    await request.body?.cancel();
  } catch {
    // Pre-read validation status remains authoritative if cancellation fails.
  }
}

async function readBoundedRawBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      await cancelUnreadBody(request);
      throw new InvalidWebhookBodyError();
    }
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) {
      await cancelUnreadBody(request);
      throw new InvalidWebhookBodyError();
    }
    if (declaredLength > MAX_WEBHOOK_RAW_BODY_BYTES) {
      await cancelUnreadBody(request);
      throw new WebhookPayloadTooLargeError();
    }
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_WEBHOOK_RAW_BODY_BYTES - totalBytes) {
        try {
          await reader.cancel();
        } catch {
          // The bounded read still fails closed if stream cancellation itself fails.
        }
        throw new WebhookPayloadTooLargeError();
      }
      chunks.push(value.slice());
      totalBytes += value.byteLength;
    }
  } catch (error) {
    if (
      error instanceof WebhookPayloadTooLargeError ||
      error instanceof InvalidWebhookBodyError
    ) throw error;
    try {
      await reader.cancel();
    } catch {
      // Reader errors are returned only as a safe invalid-webhook response.
    }
    throw new InvalidWebhookBodyError();
  } finally {
    reader.releaseLock();
  }

  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
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
      paymentRequestRepository: createDrizzlePaymentRequestRepository(database),
      checkoutAuthority,
      providers,
      returnBaseUrl: config.operations.returnBaseUrl ?? parseAuthConfig().origin,
      onVerifiedPaidOrder: createMetaPaidOrderObserver((task) => after(task)),
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
    try {
      rawBody = await readBoundedRawBody(request);
    } catch (error) {
      if (error instanceof WebhookPayloadTooLargeError) return payloadTooLarge();
      return invalidWebhook();
    }

    let event: VerifiedProviderEvent;
    try {
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
