import { createHash } from "node:crypto";
import { verifyFlikWebhook } from "@/server/payments/flik-webhook";
import { createFlikRuntime } from "@/server/payments/flik-runtime";
import type { FlikWebhookInput } from "@/server/payments/flik-repository";

const headers = { "Cache-Control": "no-store" };
type Dependencies = { secret: string; receive: (event: FlikWebhookInput) => Promise<"accepted" | "duplicate" | "conflict"> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function rawBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 64 * 1024) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
export function createFlikWebhookRoute(dependencies?: Dependencies) {
  return async function POST(request: Request) {
    let deps = dependencies;
    if (!deps) {
      const runtime = await createFlikRuntime();
      if (!runtime) return json({ error: "Flik is unavailable" }, 404);
      deps = { secret: runtime.config.webhookSecret, receive: runtime.repository.receiveWebhook };
    }
    let bytes: Uint8Array;
    let event;
    try {
      bytes = await rawBody(request);
      event = verifyFlikWebhook(bytes, request.headers.get("Flik-Signature"), deps.secret);
    } catch { return json({ error: "Webhook verification failed" }, 400); }
    if (!event) return json({ received: true });
    try {
      const result = await deps.receive({ transactionId: event.transactionId,
        payloadSha256: createHash("sha256").update(bytes).digest("hex"),
        checkoutSessionId: event.checkoutSessionId, foreignTransactionId: event.foreignTransactionId });
      if (result === "conflict") return json({ error: "Webhook conflicts with stored data" }, 409);
      // Durable inbox is committed before ACK. The scheduled worker performs API confirmation.
      return json({ received: true });
    } catch { return json({ error: "Webhook could not be recorded" }, 503); }
  };
}
export const POST = createFlikWebhookRoute();
