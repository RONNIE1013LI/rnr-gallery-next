import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import {
  createAbandonedUploadCleanup,
} from "@/server/uploads/abandoned-upload-cleanup";
import {
  createDrizzleAbandonedUploadCleanupRepository,
} from "@/server/uploads/drizzle-abandoned-upload-cleanup-repository";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export const runtime = "nodejs";

type CleanupResult = Readonly<{
  examined: number;
  removed: number;
  tombstoned: number;
  failed: number;
  sessionsDeleted: number;
}>;

type Dependencies = Readonly<{
  secret: string | null;
  deleteEnabled: boolean;
  report: () => Promise<{ eligible: number; eligibleBytes: number }>;
  run: (limit: number) => Promise<CleanupResult>;
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

export function resolveUploadCleanupConfig(
  environment: Readonly<Record<string, string | undefined>>,
) {
  return Object.freeze({
    secret: environment.CRON_SECRET?.trim()
      || environment.MAINTENANCE_CRON_SECRET?.trim()
      || null,
    deleteEnabled: environment.UPLOAD_CLEANUP_DELETE_ENABLED?.trim() === "true",
  });
}

function defaults(): Dependencies {
  const database = getDatabase();
  const cleanup = createAbandonedUploadCleanup(
    createDrizzleAbandonedUploadCleanupRepository(database),
    createPrivateUploadStore(),
  );
  const config = resolveUploadCleanupConfig(process.env);
  return Object.freeze({
    ...config,
    report: cleanup.report,
    run: cleanup.run,
  });
}

export function createUploadCleanupRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    let deps: Dependencies;
    try {
      deps = dependencies ?? defaults();
    } catch {
      return Response.json({
        error: { code: "UPLOAD_CLEANUP_UNAVAILABLE", message: "Upload cleanup is unavailable" },
      }, { status: 503, headers: noStore });
    }
    if (!deps.secret) {
      return Response.json({
        error: { code: "UPLOAD_CLEANUP_UNAVAILABLE", message: "Upload cleanup is unavailable" },
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
      if (!deps.deleteEnabled) {
        const report = await deps.report();
        return Response.json({
          mode: "report",
          eligible: report.eligible,
          eligibleBytes: report.eligibleBytes,
        }, { headers: noStore });
      }
      const result = await deps.run(100);
      return Response.json({
        mode: "delete",
        examined: result.examined,
        removed: result.removed,
        tombstoned: result.tombstoned,
        failed: result.failed,
        sessionsDeleted: result.sessionsDeleted,
      }, { headers: noStore });
    } catch {
      return Response.json({
        error: { code: "UPLOAD_CLEANUP_FAILED", message: "Upload cleanup could not be completed" },
      }, { status: 500, headers: noStore });
    }
  };
}

export const POST = createUploadCleanupRoute();
export const GET = POST;
