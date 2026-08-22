import { describe, expect, it } from "vitest";
import { buildLearningCandidateProposal } from "./learning-candidate";

describe("learning candidate proposal", () => {
  const evidence = ["case-1", "case-2", "case-3"];
  it("creates only a pending proposal from three distinct approved low-risk cases", () => {
    expect(buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: "Add one useful next step.",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    })).toMatchObject({ status: "pending", evidenceCount: 3, distinctCaseCount: 3 });
  });
  it.each([
    [2, 2, true],
    [3, 2, true],
    [3, 3, false],
  ])("rejects insufficient or risky evidence", (count, conversations, safe) => {
    expect(buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: "Add one useful next step.",
      caseIds: evidence.slice(0, count), conversationCount: conversations, allApprovedLowRisk: safe,
    })).toBeNull();
  });
});
