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
  runMaintenance(): Promise<void>;
  maxTurns?: number;
  runShared?(): Promise<unknown>;
  now?: () => number;
}>) {
  const maxTurns = Math.max(1, Math.min(25, input.maxTurns ?? 10));
  return async function handle(request: Request) {
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return new Response(null, { status: 401 });
    }
    const now = input.now ?? Date.now;
    const deadline = now() + 50_000;
    let sharedFailed = false;
    try { await input.runShared?.(); } catch { sharedFailed = true; }

    const totals = { claimed: 0, completed: 0, retried: 0, cancelled: 0 };
    for (let index = 0; index < maxTurns && now() < deadline; index += 1) {
      const result = await input.runOnce();
      totals.claimed += result.claimed;
      totals.completed += result.completed;
      totals.retried += result.retried;
      totals.cancelled += result.cancelled;
      if (result.claimed === 0) break;
    }
    if (now() < deadline) await input.runMaintenance();
    return Response.json(sharedFailed ? { ...totals, error: { code: "SHARED_RECOVERY_UNAVAILABLE" } } : totals, { status: sharedFailed ? 503 : 200, headers: { "cache-control": "no-store" } });
  };
}
