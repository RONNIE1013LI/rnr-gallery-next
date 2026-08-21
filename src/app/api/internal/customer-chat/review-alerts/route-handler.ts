import { createHash, timingSafeEqual } from "node:crypto";

type DeliveryResult = Readonly<{ result: "sent" | "retry_wait" | "uncertain" | "expired" | "empty" | "not_configured" }>;

function authorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  const supplied = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(supplied, expected);
}

export function createWebsiteReviewAlertCronHandler(input: Readonly<{
  secret: string;
  deliverNext(): Promise<DeliveryResult>;
  maxAlerts?: number;
}>) {
  const maxAlerts = Math.max(1, Math.min(25, input.maxAlerts ?? 10));
  return async function handle(request: Request) {
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return new Response(null, { status: 401 });
    }
    const totals = { sent: 0, retried: 0, uncertain: 0 };
    for (let index = 0; index < maxAlerts; index += 1) {
      const result = await input.deliverNext();
      if (result.result === "empty" || result.result === "not_configured") break;
      if (result.result === "sent") totals.sent += 1;
      if (result.result === "retry_wait") totals.retried += 1;
      if (result.result === "uncertain") totals.uncertain += 1;
    }
    return Response.json(totals, { headers: { "cache-control": "no-store" } });
  };
}
