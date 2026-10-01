import { createHmac, timingSafeEqual } from "node:crypto";

export type FlikWebhookEvent = Readonly<{
  event: "checkout_session.completed";
  createdAt: string;
  checkoutSessionId: string;
  transactionId: string;
  foreignTransactionId: string;
}>;
function invalid(): never { throw new Error("Invalid Flik webhook"); }

// Signature freshness limits replay; the caller must additionally persist/deduplicate transactionId.
export function verifyFlikWebhook(
  rawBody: string | Uint8Array,
  signature: string | null,
  secret: string,
  now = Date.now(),
): FlikWebhookEvent | null {
  if (!signature || signature.length > 1024 || !secret.startsWith("whsec_") || Buffer.byteLength(rawBody) > 64 * 1024) return invalid();
  const fields = new Map<string, string>();
  for (const part of signature.split(",")) {
    const index = part.indexOf("=");
    if (index < 1) return invalid();
    const name = part.slice(0, index).trim();
    if (fields.has(name)) return invalid();
    fields.set(name, part.slice(index + 1).trim());
  }
  const timestamp = fields.get("t");
  const digest = fields.get("v1");
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !digest || !/^[a-fA-F0-9]{64}$/.test(digest)) return invalid();
  if (!Number.isFinite(now) || Math.abs(now / 1000 - Number(timestamp)) > 300) return invalid();
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(digest, "hex"))) return invalid();
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.from(rawBody).toString("utf8")); } catch { return invalid(); }
  if (!body || typeof body !== "object" || typeof body.event !== "string") return invalid();
  if (body.event !== "checkout_session.completed") return null;
  if (
    typeof body.createdAt !== "string" || !Number.isFinite(Date.parse(body.createdAt)) ||
    typeof body.checkoutSessionId !== "string" || !/^cs_[A-Za-z0-9_-]{1,200}$/.test(body.checkoutSessionId) ||
    typeof body.transactionId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.transactionId) ||
    typeof body.foreignTransactionId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(body.foreignTransactionId)
  ) return invalid();
  return { event: body.event, createdAt: body.createdAt, checkoutSessionId: body.checkoutSessionId, transactionId: body.transactionId, foreignTransactionId: body.foreignTransactionId };
}
