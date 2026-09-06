import { describe, expect, it } from "vitest";
import type { RnrAiDecision } from "../types";
import { createSharedReplyProof, verifySharedReplyProof } from "./shared-reply-proof";

const decision: RnrAiDecision = {
  risk: "GREEN", nextAction: "AUTO_REPLY_ELIGIBLE", intent: "design_process",
  replyText: "We can combine the subjects from your photos.", reasons: [], claims: [], toolEvidence: [],
};
const input = { secret: "test-only-secret-with-at-least-32-characters", attemptId: "attempt-1", messageId: "message-1", text: decision.replyText! };

describe("shared reply publication proof", () => {
  it("binds the exact verified reply to its attempt and message", () => {
    const proof = createSharedReplyProof({ ...input, decision });
    expect(proof).not.toBeNull();
    expect(verifySharedReplyProof({ ...input, proof })).toBe(true);
    for (const patch of [{ text: input.text + " Extra promise." }, { attemptId: "attempt-2" }, { messageId: "message-2" }, { secret: "wrong-secret" }]) {
      expect(verifySharedReplyProof({ ...input, ...patch, proof })).toBe(false);
    }
    expect(verifySharedReplyProof({ ...input, proof: { ...proof, signature: "00" } })).toBe(false);
    expect(verifySharedReplyProof({ ...input, proof: { risk: "GREEN" } })).toBe(false);
  });
  it("does not sign review, no-reply, missing-secret, or changed-text results", () => {
    for (const patch of [{ risk: "YELLOW" as const }, { risk: "RED" as const }, { nextAction: "HUMAN_REVIEW" as const }, { nextAction: "NO_REPLY" as const }, { replyText: null }]) {
      expect(createSharedReplyProof({ ...input, decision: { ...decision, ...patch } })).toBeNull();
    }
    expect(createSharedReplyProof({ ...input, decision, secret: "" })).toBeNull();
    expect(createSharedReplyProof({ ...input, decision, text: "Altered text" })).toBeNull();
  });
});
