import { createHash, timingSafeEqual } from "node:crypto";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { createWebsiteAnalyticsV2Reconciliation } from "@/server/analytics/website-analytics-v2-reconciliation";
import { getDatabase } from "@/server/db/client";

type ReconciliationResult = Readonly<{
  repair: Readonly<{
    totals: Readonly<{
      scanned: number;
      created: number;
      unchanged: number;
      skipped: number;
      failed: number;
    }>;
  }>;
  aggregates: Readonly<{ rebuilt: number; busy: number; failed: number }>;
  recentWindow: Readonly<{ from: string; to: string }>;
}>;

type Dependencies = Readonly<{
  v2Enabled: boolean;
  secret: string | null;
  run: () => Promise<ReconciliationResult>;
}>;

const noStore = { "Cache-Control": "no-store" };

export function timingSafeAnalyticsCronSecretEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const leftDigest = createHash("sha256").update(leftBytes).digest();
  const rightDigest = createHash("sha256").update(rightBytes).digest();
  return timingSafeEqual(leftDigest, rightDigest)
    && leftBytes.byteLength === rightBytes.byteLength;
}

export function createWebsiteAnalyticsV2ReconciliationDependencies(
  env: Readonly<Record<string, string | undefined>> = process.env,
  databaseFactory: typeof getDatabase = getDatabase,
): Dependencies {
  const config = readWebsiteAnalyticsBusinessConfig(env);
  if (!config.v2Enabled) {
    return Object.freeze({
      v2Enabled: false,
      secret: null,
      run: async () => {
        throw new Error("Website Analytics V2 is disabled");
      },
    });
  }
  const reconciliation = createWebsiteAnalyticsV2Reconciliation(databaseFactory());
  return Object.freeze({
    v2Enabled: true,
    secret: env.CRON_SECRET?.trim() || null,
    run: () => reconciliation.run({
      recentDays: 3,
      repairBatchSize: 100,
      maxDirtyDates: 7,
    }),
  });
}

function bearerToken(request: Request): string | null {
  return /^Bearer ([^\s,]{1,1024})$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1] ?? null;
}

export function createWebsiteAnalyticsV2ReconciliationRoute(dependencies?: Dependencies) {
  return async function handle(request: Request) {
    let input: Dependencies;
    try {
      input = dependencies ?? createWebsiteAnalyticsV2ReconciliationDependencies();
    } catch {
      return Response.json({
        error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_UNAVAILABLE" },
      }, { status: 503, headers: noStore });
    }
    if (!input.v2Enabled || !input.secret) {
      return Response.json({
        error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_UNAVAILABLE" },
      }, { status: 503, headers: noStore });
    }
    const token = bearerToken(request);
    if (!token || !timingSafeAnalyticsCronSecretEqual(token, input.secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, {
        status: 401,
        headers: noStore,
      });
    }
    try {
      const result = await input.run();
      const body = {
        repair: {
          scanned: result.repair.totals.scanned,
          created: result.repair.totals.created,
          unchanged: result.repair.totals.unchanged,
          skipped: result.repair.totals.skipped,
          failed: result.repair.totals.failed,
        },
        aggregates: {
          rebuilt: result.aggregates.rebuilt,
          busy: result.aggregates.busy,
          failed: result.aggregates.failed,
        },
        recentWindow: {
          from: result.recentWindow.from,
          to: result.recentWindow.to,
        },
      };
      const incomplete = result.repair.totals.failed > 0 || result.aggregates.failed > 0;
      return Response.json(incomplete ? {
        error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_INCOMPLETE" },
        ...body,
      } : body, { status: incomplete ? 503 : 200, headers: noStore });
    } catch {
      return Response.json({
        error: { code: "WEBSITE_ANALYTICS_V2_RECONCILIATION_FAILED" },
      }, { status: 503, headers: noStore });
    }
  };
}

export const GET = createWebsiteAnalyticsV2ReconciliationRoute();
export const POST = GET;
