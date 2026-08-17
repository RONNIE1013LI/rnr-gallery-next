import { createHash, timingSafeEqual } from "node:crypto";

type RunResult = Readonly<{ claimed: number; completed: number; humanReviewRequired: number }>;

function authorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  const supplied = header.slice("Bearer ".length);
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(secret).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

export function createImageJobRecoveryHandler(input: Readonly<{
  secret: string;
  runOnce(): Promise<RunResult>;
  maxJobs?: number;
}>) {
  const maxJobs = Math.max(1, Math.min(25, input.maxJobs ?? 1));
  return async function POST(request: Request) {
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return new Response(null, { status: 401 });
    }
    const totals = { claimed: 0, completed: 0, humanReviewRequired: 0 };
    for (let index = 0; index < maxJobs; index += 1) {
      const result = await input.runOnce();
      totals.claimed += result.claimed;
      totals.completed += result.completed;
      totals.humanReviewRequired += result.humanReviewRequired;
      if (result.claimed === 0) break;
    }
    return Response.json(totals, {
      headers: { "cache-control": "no-store" },
    });
  };
}
