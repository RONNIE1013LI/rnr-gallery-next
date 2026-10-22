import { after } from "next/server";
import { timingSafeSecretEqual } from "../../reconcile/route-handler";
import { createFlikRuntime } from "@/server/payments/flik-runtime";
import { createFlikReconciliationWorker } from "@/server/payments/flik-reconciliation-runtime";

const headers = { "Cache-Control": "no-store" };
export function createFlikReconciliationRoute(dependencies?: {
  secret: string | null; run: () => Promise<unknown>;
}) {
  return async function GET(request: Request) {
    const secret = dependencies ? dependencies.secret : process.env.CRON_SECRET?.trim();
    if (!secret) return Response.json({ error: "Reconciliation unavailable" }, { status: 503, headers });
    const token = /^Bearer ([^\s,]{1,1024})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !timingSafeSecretEqual(token, secret)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    try {
      if (dependencies) return Response.json(await dependencies.run(), { headers });
      // Share the existing low-frequency schedule. Wise failure cannot change Flik's result.
      if (process.env.ENABLE_WISE_PAYID === "true") {
        const wiseTask = (async () => {
        try {
          const { createWisePayIdRuntime } = await import("@/server/payments/wise-payid-runtime");
          await createWisePayIdRuntime((task) => after(task))?.worker.run();
        } catch { console.warn("Wise statement reconciliation unavailable; orders remain pending"); }
        })();
        after(() => wiseTask);
      }
      const deadlineMs = Date.now() + 45_000;
      const runtime = await createFlikRuntime({ deadlineMs });
      if (!runtime) return Response.json({ disabled: true }, { headers });
      const worker = createFlikReconciliationWorker(runtime, (task) => after(task), deadlineMs);
      return Response.json(await worker.run(), { headers });
    } catch { return Response.json({ error: "Reconciliation unavailable; payments remain pending" }, { status: 503, headers }); }
  };
}
export const GET = createFlikReconciliationRoute();
export const POST = GET;
