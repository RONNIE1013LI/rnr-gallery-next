import { getDatabase } from "@/server/db/client";
import { createDrizzlePaymentRequestRepository } from "@/server/payment-requests/drizzle-payment-request-repository";
import { createInternalPaymentReconciliationService, timingSafeSecretEqual } from "../../payments/reconcile/route-handler";

const headers = { "Cache-Control": "no-store" };

export function createPaymentRequestExpiryRoute(dependencies?: Readonly<{
  secret: string | null;
  expire(): Promise<number>;
  reconcile(): Promise<unknown>;
}>) {
  return async function handle(request: Request) {
    const secret = dependencies ? dependencies.secret : process.env.CRON_SECRET?.trim();
    if (!secret) return Response.json({ error: "Expiry service unavailable" }, { status: 503, headers });
    const token = /^Bearer ([^\s,]{1,1024})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !timingSafeSecretEqual(token, secret)) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    }
    try {
      const expire = dependencies?.expire ?? createDrizzlePaymentRequestRepository(getDatabase()).expireStaleRequests;
      const reconcile = dependencies?.reconcile ?? (() =>
        createInternalPaymentReconciliationService().reconcilePendingPayments({ paymentRequestsOnly: true }));
      const before = await expire();
      await reconcile();
      const after = await expire();
      return Response.json({ cancelled: before + after }, { headers });
    } catch {
      return Response.json({ error: "Expiry reconciliation unavailable" }, { status: 503, headers });
    }
  };
}

export const GET = createPaymentRequestExpiryRoute();
export const POST = GET;
