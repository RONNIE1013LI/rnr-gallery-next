import { createHash, timingSafeEqual } from "node:crypto";
import { getAllCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";

export const runtime = "nodejs";

type DeliveryResult = Readonly<{
  result: "processed" | "not_configured";
  sent: number;
  failed: number;
}>;

type Dependencies = Readonly<{
  secret: string | null;
  deliverPending: (limit: number) => Promise<DeliveryResult>;
}>;

const noStore = { "Cache-Control": "no-store" };

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const leftDigest = createHash("sha256").update(leftBytes).digest();
  const rightDigest = createHash("sha256").update(rightBytes).digest();
  return timingSafeEqual(leftDigest, rightDigest) && leftBytes.byteLength === rightBytes.byteLength;
}

function bearerToken(headers: Headers) {
  const match = /^Bearer ([^\s,]{1,1024})$/.exec(headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

function defaults(): Dependencies {
  return Object.freeze({
    secret: process.env.CRON_SECRET?.trim()
      || process.env.CUSTOMER_NOTIFICATION_CRON_SECRET?.trim()
      || null,
    deliverPending: getAllCustomerNotificationRuntime().deliverPending,
  });
}

export function createCustomerNotificationCronRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    const deps = dependencies ?? defaults();
    if (!deps.secret) {
      return Response.json({
        error: { code: "NOTIFICATION_RETRY_UNAVAILABLE", message: "Customer notification retry is unavailable" },
      }, { status: 503, headers: noStore });
    }
    const token = bearerToken(request.headers);
    if (!token || !safeEqual(token, deps.secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, {
        status: 401,
        headers: noStore,
      });
    }
    try {
      const result = await deps.deliverPending(20);
      if (result.result === "not_configured") {
        return Response.json({
          error: { code: "NOTIFICATION_RETRY_UNAVAILABLE", message: "Customer notification retry is unavailable" },
        }, { status: 503, headers: noStore });
      }
      return Response.json({ result: result.result, sent: result.sent, failed: result.failed }, {
        headers: noStore,
      });
    } catch {
      return Response.json({
        error: { code: "NOTIFICATION_RETRY_FAILED", message: "Customer notifications could not be processed" },
      }, { status: 500, headers: noStore });
    }
  };
}

export const GET = createCustomerNotificationCronRoute();
export const POST = GET;
