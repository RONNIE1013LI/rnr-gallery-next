import { createHash, timingSafeEqual } from "node:crypto";
import {
  createProductionConversionDeliveryWorker,
  type ConversionDeliveryWorkerResult,
} from "@/server/analytics/conversion-delivery-worker";

type Dependencies = Readonly<{
  secret: string | null;
  run: (limit: number) => Promise<ConversionDeliveryWorkerResult>;
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
    run: createProductionConversionDeliveryWorker().run,
  });
}

export function createConversionDeliveryCronRoute(dependencies?: Dependencies) {
  return async function handle(request: Request) {
    const deps = dependencies ?? defaults();
    if (!deps.secret) {
      return Response.json({ error: { code: "CONVERSION_WORKER_UNAVAILABLE" } }, {
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
      const result = await deps.run(1);
      if (result.result === "unavailable") {
        return Response.json({ error: { code: "CONVERSION_WORKER_UNAVAILABLE" } }, {
          status: 503,
          headers: noStore,
        });
      }
      return Response.json({
        result: result.result,
        googleProcessed: result.googleProcessed,
        metaProcessed: result.metaProcessed,
      }, { headers: noStore });
    } catch {
      return Response.json({ error: { code: "CONVERSION_WORKER_UNAVAILABLE" } }, {
        status: 503,
        headers: noStore,
      });
    }
  };
}

export const GET = createConversionDeliveryCronRoute();
export const POST = GET;
