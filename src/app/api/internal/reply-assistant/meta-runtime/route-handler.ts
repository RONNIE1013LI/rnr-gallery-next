import { createHash, timingSafeEqual } from "node:crypto";
import type { BacklogLease } from "@/server/rnr-ai/runtime-store/reply-runtime-store";

type WorkerRuntime = Readonly<{
  controlIsOn(): Promise<boolean>;
  store: Readonly<{ claimBacklog(leaseMs: number): Promise<BacklogLease | null> }>;
  backlog: Readonly<{
    run(lease: BacklogLease): Promise<Readonly<{ processed: number; skipped: number; stoppedBecauseOff: boolean }>>;
  }>;
}>;

const noStore = { "cache-control": "no-store" };

export function timingSafeCronSecretEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const leftDigest = createHash("sha256").update(leftBytes).digest();
  const rightDigest = createHash("sha256").update(rightBytes).digest();
  return timingSafeEqual(leftDigest, rightDigest) && leftBytes.byteLength === rightBytes.byteLength;
}

function bearerToken(request: Request) {
  return /^Bearer ([^\s,]{1,1024})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

export function createMetaRuntimeWorkerHandler(dependencies: Readonly<{
  secret: string | null;
  enabled: boolean;
  createRuntime(): WorkerRuntime;
}>) {
  return async function handle(request: Request) {
    if (!dependencies.secret) {
      return Response.json({ error: { code: "RNR_AI_META_RUNTIME_UNAVAILABLE" } }, { status: 503, headers: noStore });
    }
    const token = bearerToken(request);
    if (!token || !timingSafeCronSecretEqual(token, dependencies.secret)) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers: noStore });
    }
    if (!dependencies.enabled) return Response.json({ status: "off" }, { headers: noStore });

    try {
      const runtime = dependencies.createRuntime();
      if (!await runtime.controlIsOn()) return Response.json({ status: "off" }, { headers: noStore });
      const lease = await runtime.store.claimBacklog(60_000);
      if (!lease) return Response.json({ status: "idle" }, { headers: noStore });
      const result = await runtime.backlog.run(lease);
      return Response.json({ status: "processed", ...result }, { headers: noStore });
    } catch {
      return Response.json({ error: { code: "RNR_AI_META_RUNTIME_UNAVAILABLE" } }, { status: 503, headers: noStore });
    }
  };
}
