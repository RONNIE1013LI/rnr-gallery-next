import { createHash, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { createDrizzlePaymentProofRetentionRepository } from "@/server/production/drizzle-payment-proof-retention-repository";
import { createPaymentProofRetentionCleanup } from "@/server/production/payment-proof-retention-cleanup";
import { createPrivateUploadStore } from "@/server/uploads/private-upload-store";

export const runtime = "nodejs";

type CleanupResult = Readonly<{
  examined: number;
  deleted: number;
  skipped: number;
  failed: number;
}>;

type Dependencies = Readonly<{
  secret: string | null;
  run(limit: number): Promise<CleanupResult>;
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
  const cleanup = createPaymentProofRetentionCleanup(
    createDrizzlePaymentProofRetentionRepository(getDatabase()),
    createPrivateUploadStore(),
  );
  return Object.freeze({
    secret: process.env.CRON_SECRET?.trim()
      || process.env.MAINTENANCE_CRON_SECRET?.trim()
      || null,
    run: cleanup.run,
  });
}

export function createPaymentProofCleanupRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    let deps: Dependencies;
    try {
      deps = dependencies ?? defaults();
    } catch {
      return Response.json({
        error: { code: "PAYMENT_PROOF_CLEANUP_UNAVAILABLE", message: "Payment-proof cleanup is unavailable" },
      }, { status: 503, headers: noStore });
    }
    if (!deps.secret) {
      return Response.json({
        error: { code: "PAYMENT_PROOF_CLEANUP_UNAVAILABLE", message: "Payment-proof cleanup is unavailable" },
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
      const result = await deps.run(100);
      return Response.json({
        examined: result.examined,
        deleted: result.deleted,
        skipped: result.skipped,
        failed: result.failed,
      }, { headers: noStore });
    } catch {
      return Response.json({
        error: { code: "PAYMENT_PROOF_CLEANUP_FAILED", message: "Payment-proof cleanup could not be completed" },
      }, { status: 500, headers: noStore });
    }
  };
}

export const POST = createPaymentProofCleanupRoute();
export const GET = POST;
