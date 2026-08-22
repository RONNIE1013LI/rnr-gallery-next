import { createHash, timingSafeEqual } from "node:crypto";
import type { CustomerTurnRecoveryResult } from "@/server/customer-service/turn-recovery-runner";

function authorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  const supplied = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(supplied, expected);
}

export function createTurnRecoveryHandler(input: Readonly<{
  secret: string;
  runOnce(): Promise<CustomerTurnRecoveryResult>;
  maxTurns?: number;
}>) {
  const maxTurns = Math.max(1, Math.min(25, input.maxTurns ?? 10));
  return async function handle(request: Request) {
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return new Response(null, { status: 401 });
    }
    const totals = { claimed: 0, completed: 0, retried: 0, cancelled: 0 };
    for (let index = 0; index < maxTurns; index += 1) {
      const result = await input.runOnce();
      totals.claimed += result.claimed;
      totals.completed += result.completed;
      totals.retried += result.retried;
      totals.cancelled += result.cancelled;
      if (result.claimed === 0) break;
    }
    return Response.json(totals, { headers: { "cache-control": "no-store" } });
  };
}
