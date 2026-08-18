import { describe, expect, it } from "vitest";
import { chooseHumanReplyTurn } from "./human-reply-matcher";

describe("human reply matcher", () => {
  it("prefers a conversation-validated reply reference", () => {
    expect(chooseHumanReplyTurn({ explicitTurnId: "turn-2", hasExplicitReference: true, eligibleTurnIds: ["turn-1", "turn-2"] }))
      .toEqual({ status: "matched", turnId: "turn-2", method: "reply_to", confidence: "high" });
  });

  it("matches exactly one eligible turn", () => {
    expect(chooseHumanReplyTurn({ explicitTurnId: null, hasExplicitReference: false, eligibleTurnIds: ["turn-1"] }))
      .toEqual({ status: "matched", turnId: "turn-1", method: "single_eligible_turn", confidence: "high" });
  });

  it("does not fall back when an explicit reply reference cannot be resolved", () => {
    expect(chooseHumanReplyTurn({
      explicitTurnId: null,
      hasExplicitReference: true,
      eligibleTurnIds: ["turn-1"],
    })).toEqual({ status: "unmatched", method: "none", confidence: "low" });
  });

  it.each([[[]], [["turn-1", "turn-2"]]])("does not guess for candidate set %j", (eligibleTurnIds) => {
    expect(chooseHumanReplyTurn({ explicitTurnId: null, hasExplicitReference: false, eligibleTurnIds }))
      .toEqual({ status: "unmatched", method: "none", confidence: "low" });
  });
});
