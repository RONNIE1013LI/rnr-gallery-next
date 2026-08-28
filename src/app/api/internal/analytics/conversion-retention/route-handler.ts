import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { createDrizzleConversionDeliveryRepository } from "@/server/analytics/drizzle-conversion-delivery-repository";

type Dependencies = Readonly<{
  secret: string | null;
  run: () => Promise<number>;
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
  return /^Bearer ([^\s,]{1,1024})$/.exec(headers.get("authorization") ?? "")?.[1] ?? null;
}

function defaults(): Dependencies {
  return Object.freeze({
    secret: process.env.CRON_SECRET?.trim() || null,
    run: () => createDrizzleConversionDeliveryRepository(getDatabase())
      .redactExpiredSnapshots(new Date()),
  });
}

export function createConversionRetentionCronRoute(dependencies?: Dependencies) {
  return async function handle(request: Request) {
    const deps = dependencies ?? defaults();
    if (!deps.secret) {
      return Response.json({ error: { code: "CONVERSION_RETENTION_UNAVAILABLE" } }, {
        status: 503,
        headers: noStore,
      });
    }
    const token = bearerToken(request.headers);
    if (!token || !safeEqual(token, deps.secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, {
        status: 401,
        headers: noStore,
      });
    }
    try {
      const redacted = await deps.run();
      return Response.json({ redacted }, { headers: noStore });
    } catch {
      return Response.json({ error: { code: "CONVERSION_RETENTION_UNAVAILABLE" } }, {
        status: 503,
        headers: noStore,
      });
    }
  };
}

export const GET = createConversionRetentionCronRoute();
export const POST = GET;
