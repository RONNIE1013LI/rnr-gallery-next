import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { createWebsiteAnalyticsRetention } from "@/server/analytics/website-analytics-retention";
import { createWebsiteAnalyticsRetentionRepository } from "@/server/analytics/website-analytics-retention-repository";

type Dependencies = Readonly<{
  secret: string | null;
  run: () => Promise<Readonly<{ deletedSessions: number }>>;
}>;

const noStore = { "Cache-Control": "no-store" };

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const leftDigest = createHash("sha256").update(leftBytes).digest();
  const rightDigest = createHash("sha256").update(rightBytes).digest();
  return timingSafeEqual(leftDigest, rightDigest) && leftBytes.length === rightBytes.length;
}

function defaults(): Dependencies {
  const repository = createWebsiteAnalyticsRetentionRepository(getDatabase());
  return {
    secret: process.env.CRON_SECRET?.trim() || null,
    run: () => createWebsiteAnalyticsRetention(repository).run(new Date(), 500),
  };
}

export function createWebsiteAnalyticsRetentionRoute(dependencies?: Dependencies) {
  return async function handle(request: Request) {
    const input = dependencies ?? defaults();
    if (!input.secret) {
      return Response.json({ error: { code: "WEBSITE_ANALYTICS_RETENTION_UNAVAILABLE" } }, {
        status: 503,
        headers: noStore,
      });
    }
    const token = /^Bearer ([^\s,]{1,1024})$/.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!token || !safeEqual(token, input.secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, {
        status: 401,
        headers: noStore,
      });
    }
    try {
      const result = await input.run();
      return Response.json({ deletedSessions: result.deletedSessions }, { headers: noStore });
    } catch {
      return Response.json({ error: { code: "WEBSITE_ANALYTICS_RETENTION_UNAVAILABLE" } }, {
        status: 503,
        headers: noStore,
      });
    }
  };
}

export const GET = createWebsiteAnalyticsRetentionRoute();
export const POST = GET;
