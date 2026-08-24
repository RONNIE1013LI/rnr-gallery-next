import { createHash, timingSafeEqual } from "node:crypto";

type RetentionResult = Readonly<{
  sessionsExpired: number;
  rateBucketsDeleted: number;
  rateBlockEventsDeleted: number;
  reviewLinksExpired: number;
  conversationsAnonymized: number;
}>;

function authorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ") || secret.length < 32) return false;
  const supplied = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(supplied, expected);
}

export function createWebsiteRetentionCronHandler(input: Readonly<{
  secret: string;
  run(input: Readonly<{ now: Date; limit: number }>): Promise<RetentionResult>;
  limit?: number;
  now?: () => Date;
}>) {
  const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
  return async function handle(request: Request) {
    if (!authorized(request.headers.get("authorization"), input.secret)) {
      return new Response(null, { status: 401 });
    }
    const result = await input.run({ now: (input.now ?? (() => new Date()))(), limit });
    return Response.json({
      sessionsExpired: result.sessionsExpired,
      rateBucketsDeleted: result.rateBucketsDeleted,
      rateBlockEventsDeleted: result.rateBlockEventsDeleted,
      reviewLinksExpired: result.reviewLinksExpired,
      conversationsAnonymized: result.conversationsAnonymized,
    }, { headers: { "cache-control": "no-store" } });
  };
}
