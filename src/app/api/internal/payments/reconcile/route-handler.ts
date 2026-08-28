import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { parseAuthConfig } from "@/server/auth/config";
import { createDrizzleCheckoutRepository } from "@/server/checkout/drizzle-checkout-repository";
import { getDatabase } from "@/server/db/client";
import { createDrizzlePaymentRequestRepository } from "@/server/payment-requests/drizzle-payment-request-repository";
import { parsePaymentConfig } from "@/server/payments/config";
import { createDrizzlePaymentRepository } from "@/server/payments/drizzle-payment-repository";
import {
  createPaymentService,
  type PaymentReconciliationSummary,
} from "@/server/payments/payment-service";
import { selectPaymentProviders } from "@/server/payments/provider-registry";
import { createMetaPaidOrderObserver } from "@/server/analytics/meta-purchase";

export const runtime = "nodejs";

type ReconciliationService = Readonly<{
  reconcilePendingPayments(): Promise<PaymentReconciliationSummary>;
}>;

type Dependencies = Readonly<{
  reconciliationSecret: string | null;
  paymentService: ReconciliationService | null;
}>;

const noStoreHeaders = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export function timingSafeSecretEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const leftDigest = createHash("sha256").update(leftBytes).digest();
  const rightDigest = createHash("sha256").update(rightBytes).digest();
  return timingSafeEqual(leftDigest, rightDigest) &&
    leftBytes.byteLength === rightBytes.byteLength;
}

function bearerToken(headers: Headers) {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([^\s,]{1,1024})$/.exec(authorization);
  return match?.[1] ?? null;
}

async function hasNonEmptyBody(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && contentLength !== "0") return true;
  if (!request.body) return false;

  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (value.byteLength > 0) {
        try {
          await reader.cancel();
        } catch {
          // The non-empty body remains invalid if cancellation fails.
        }
        return true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function defaults(): Dependencies {
  const config = parsePaymentConfig();
  if (!config.operations.reconciliationSecret) {
    return Object.freeze({
      reconciliationSecret: null,
      paymentService: null,
    });
  }
  const database = getDatabase();
  const providers = selectPaymentProviders(config);
  return Object.freeze({
    reconciliationSecret: config.operations.reconciliationSecret,
    paymentService: createPaymentService({
      repository: createDrizzlePaymentRepository(database),
      paymentRequestRepository: createDrizzlePaymentRequestRepository(database),
      checkoutAuthority: createDrizzleCheckoutRepository(database),
      providers,
      returnBaseUrl: config.operations.returnBaseUrl ?? parseAuthConfig().origin,
      onVerifiedPaidOrder: createMetaPaidOrderObserver((task) => after(task)),
    }),
  });
}

export function createPaymentReconciliationRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    let deps: Dependencies;
    try {
      deps = dependencies ?? defaults();
    } catch {
      return json({
        error: {
          code: "RECONCILIATION_UNAVAILABLE",
          message: "Payment reconciliation is unavailable",
        },
      }, 503);
    }
    if (!deps.reconciliationSecret || !deps.paymentService) {
      return json({
        error: {
          code: "RECONCILIATION_UNAVAILABLE",
          message: "Payment reconciliation is unavailable",
        },
      }, 503);
    }

    const token = bearerToken(request.headers);
    if (!token || !timingSafeSecretEqual(token, deps.reconciliationSecret)) {
      return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
    }

    try {
      if (await hasNonEmptyBody(request)) {
        return json({
          error: { code: "INVALID_REQUEST", message: "Request body must be empty" },
        }, 400);
      }
    } catch {
      return json({
        error: { code: "INVALID_REQUEST", message: "Request body must be empty" },
      }, 400);
    }

    try {
      const result = await deps.paymentService.reconcilePendingPayments();
      return json({
        processed: result.processed,
        applied: result.applied,
        retried: result.retried,
        pending: result.pending,
        failed: result.failed,
      });
    } catch {
      return json({
        error: {
          code: "RECONCILIATION_FAILED",
          message: "Payment reconciliation could not be completed",
        },
      }, 500);
    }
  };
}

export const POST = createPaymentReconciliationRoute();
