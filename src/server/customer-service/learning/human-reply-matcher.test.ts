import { describe, expect, it } from "vitest";
import { chooseHumanReplyTurn } from "./human-reply-matcher";

describe("human reply matcher", () => {
  it("prefers a conversation-validated reply reference", () => {
    expect(chooseHumanReplyTurn({ explicitTurnId: "turn-2", eligibleTurnIds: ["turn-1", "turn-2"] }))
      .toEqual({ status: "matched", turnId: "turn-2", method: "reply_to", confidence: "high" });
  });

  it("matches exactly one eligible turn", () => {
    expect(chooseHumanReplyTurn({ explicitTurnId: null, eligibleTurnIds: ["turn-1"] }))
      .toEqual({ status: "matched", turnId: "turn-1", method: "single_eligible_turn", confidence: "high" });
  });

  it.each([[[]], [["turn-1", "turn-2"]]])("does not guess for candidate set %j", (eligibleTurnIds) => {
    expect(chooseHumanReplyTurn({ explicitTurnId: null, eligibleTurnIds }))
      .toEqual({ status: "unmatched", method: "none", confidence: "low" });
  });
});
