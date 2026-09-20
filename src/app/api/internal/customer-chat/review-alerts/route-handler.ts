import { createHash, timingSafeEqual } from "node:crypto";

function authorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  const supplied = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(supplied, expected);
}

export function createWebsiteReviewAlertCronHandler(input: Readonly<{
  secret: string;
  runShared(deadlineAt: number): Promise<readonly unknown[]>;
  now?: () => number;
}>) {
  return async function handle(request: Request) {
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return new Response(null, { status: 401 });
    }
    const now = input.now ?? Date.now;
    const deadlineAt = now() + 50_000;
    try {
      const results = await input.runShared(deadlineAt);
      if (now() >= deadlineAt) throw new Error("Recovery deadline exceeded");
      return Response.json({ processed: results.length }, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return Response.json({ error: { code: "SHARED_RECOVERY_UNAVAILABLE" } }, {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
  };
}
