import { describe, expect, it } from "vitest";
import {
  buildLearningCandidateProposal,
  getLearningPatternDefinition,
  isActionableLearningCandidate,
  isApprovedLearningGuidance,
} from "./learning-candidate";

describe("learning candidate proposal", () => {
  const evidence = ["case-1", "case-2", "case-3"];
  const missingNextStep = getLearningPatternDefinition("missing_next_step");

  it("creates only a pending proposal from three distinct approved low-risk cases", () => {
    expect(buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    })).toMatchObject({
      status: "pending",
      evidenceCount: 3,
      distinctCaseCount: 3,
      observedPattern: missingNextStep?.observedPattern,
    });
  });
  it.each([
    [2, 2, true],
    [3, 2, true],
    [3, 3, false],
  ])("rejects insufficient or risky evidence", (count, conversations, safe) => {
    expect(buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence.slice(0, count), conversationCount: conversations, allApprovedLowRisk: safe,
    })).toBeNull();
  });

  it.each([
    ["independent_human_reply", "Review this repeated edit pattern before changing the approved guidance."],
    ["missing_next_step", "Review this repeated edit pattern before changing the approved guidance."],
    ["missing_next_step", ""],
    ["missing_next_step", "A different unreviewed rule."],
  ])("rejects unknown, placeholder, empty, or mismatched guidance", (reasonCode, proposedChange) => {
    expect(buildLearningCandidateProposal({
      intent: "design_process", reasonCode, proposedChange,
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    })).toBeNull();
  });

  it("uses a semantic signature that does not change as supporting cases accumulate", () => {
    const first = buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    });
    const later = buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: [...evidence, "case-4", "case-5"], conversationCount: 5, allApprovedLowRisk: true,
    });
    expect(first?.evidenceSignature).toBe(later?.evidenceSignature);
  });

  it("keeps the same pattern under different intents semantically distinct", () => {
    const first = buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    });
    const second = buildLearningCandidateProposal({
      intent: "photo_guidance", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    });
    expect(first?.evidenceSignature).not.toBe(second?.evidenceSignature);
  });

  it("keeps different observed patterns distinct even under the same intent", () => {
    const market = getLearningPatternDefinition("quote_confirm_market_and_banner_format");
    const nextDetail = getLearningPatternDefinition("quote_ask_next_missing_detail");
    const first = buildLearningCandidateProposal({
      intent: "quote_information_collection", reasonCode: "quote_confirm_market_and_banner_format",
      proposedChange: market?.proposedGuidance ?? "", caseIds: evidence,
      conversationCount: 3, allApprovedLowRisk: true,
    });
    const second = buildLearningCandidateProposal({
      intent: "quote_information_collection", reasonCode: "quote_ask_next_missing_detail",
      proposedChange: nextDetail?.proposedGuidance ?? "", caseIds: evidence,
      conversationCount: 3, allApprovedLowRisk: true,
    });
    expect(first?.evidenceSignature).not.toBe(second?.evidenceSignature);
  });

  it("marks only recognized, evidence-backed records actionable", () => {
    const proposal = buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    });
    expect(proposal && isActionableLearningCandidate(proposal)).toBe(true);
    expect(isActionableLearningCandidate({
      candidateKind: "answer_quality_rule",
      intent: "design_process",
      proposedChange: "Review this repeated edit pattern before changing the approved guidance.",
      reasonCodes: ["independent_human_reply"],
      evidenceCount: 3,
      distinctCaseCount: 3,
      sourceCaseMemoryIds: evidence,
      evidenceSignature: "invalid-signature",
    })).toBe(false);
  });

  it("rejects a tampered signature and the wrong candidate kind", () => {
    const proposal = buildLearningCandidateProposal({
      intent: "design_process", reasonCode: "missing_next_step", proposedChange: missingNextStep?.proposedGuidance ?? "",
      caseIds: evidence, conversationCount: 3, allApprovedLowRisk: true,
    });
    if (!proposal) throw new Error("expected proposal");
    expect(isActionableLearningCandidate({ ...proposal, evidenceSignature: "0".repeat(64) })).toBe(false);
    expect(isActionableLearningCandidate({ ...proposal, candidateKind: "knowledge_change" })).toBe(false);
    expect(isActionableLearningCandidate({
      ...proposal,
      sourceCaseMemoryIds: [...proposal.sourceCaseMemoryIds, proposal.sourceCaseMemoryIds[0]],
    })).toBe(false);
    expect(isActionableLearningCandidate({
      ...proposal,
      proposedChange: `${proposal.proposedChange} `,
    })).toBe(false);
  });

  it.each([
    "Automatically send the reply when this situation appears.",
    "Send this reply automatically when the same request appears.",
    "Send this reply without human review when the request appears.",
    "Send this response with no human review when the request appears.",
    "Respond with no approval when this situation appears.",
    "Send this reply without a staff review when the request appears.",
    "Send this reply before anyone reviews it.",
    "Please reply to the customer before anyone reviews it.",
    "Kindly reply to the customer with no staff review.",
    "Automatically answer the customer without human review.",
    "Automatically contact the customer before anyone reviews it.",
    "Keep replying to customers with no staff review.",
    "Reply directly to the customer whenever this pattern appears.",
    "Approve a 20% discount for this repeated customer request.",
    "Promise a refund when the customer asks to cancel.",
    "Use the current shipping price of NZ$25 for this case.",
  ])("rejects unsafe edited guidance: %s", (guidance) => {
    expect(isApprovedLearningGuidance(guidance)).toBe(false);
  });

  it("still permits safe guidance that uses reply as a noun", () => {
    expect(isApprovedLearningGuidance("Use a concise reply when no further customer action is required."))
      .toBe(true);
    expect(isApprovedLearningGuidance("Ask the customer to send their original photos before preparing a design."))
      .toBe(true);
  });
});
