import { after } from "next/server";
import { timingSafeSecretEqual } from "../../reconcile/route-handler";
import { createWisePayIdRuntime } from "@/server/payments/wise-payid-runtime";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "Unavailable" }, { status: 503, headers });
  const token = /^Bearer ([^\s,]{1,1024})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || !timingSafeSecretEqual(token, secret)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const runtime = createWisePayIdRuntime((task) => after(task));
    return Response.json(runtime ? await runtime.worker.run() : { disabled: true }, { headers });
  } catch { return Response.json({ error: "Wise reconciliation unavailable; orders remain pending" }, { status: 503, headers }); }
}
