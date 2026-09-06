import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { RnrAiDecision } from "../types";

export const SHARED_REPLY_PROOF_VERSION = "rnr-shared-reply-v1";
type Binding = Readonly<{ secret: string; attemptId: string; messageId: string; text: string }>;
function signature(input: Binding) {
  return createHmac("sha256", input.secret).update(JSON.stringify([
    SHARED_REPLY_PROOF_VERSION, input.attemptId, input.messageId,
    createHash("sha256").update(input.text).digest("hex"), "GREEN", "AUTO_REPLY_ELIGIBLE",
  ])).digest("hex");
}

// Called only by attempt completion after locking the pending attempt and checking human takeover.
export function createSharedReplyProof(input: Binding & Readonly<{ decision: RnrAiDecision }>) {
  if (!input.secret || !input.text.trim() || input.decision.replyText !== input.text
    || input.decision.risk !== "GREEN" || input.decision.nextAction !== "AUTO_REPLY_ELIGIBLE") return null;
  return { version: SHARED_REPLY_PROOF_VERSION, signature: signature(input) };
}

export function verifySharedReplyProof(input: Binding & Readonly<{ proof: unknown }>): boolean {
  if (!input.secret || !input.text.trim() || !input.proof || typeof input.proof !== "object") return false;
  const proof = input.proof as Record<string, unknown>;
  if (proof.version !== SHARED_REPLY_PROOF_VERSION || typeof proof.signature !== "string"
    || !/^[a-f0-9]{64}$/.test(proof.signature)) return false;
  return timingSafeEqual(Buffer.from(proof.signature, "hex"), Buffer.from(signature(input), "hex"));
}
