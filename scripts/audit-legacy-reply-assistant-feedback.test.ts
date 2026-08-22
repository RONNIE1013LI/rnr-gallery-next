import { describe, expect, it } from "vitest";
import { auditLegacyFeedback } from "./audit-legacy-reply-assistant-feedback";

describe("legacy Reply Assistant feedback audit", () => {
  it("keeps only privacy-safe low-risk AI to human pairs", () => {
    const result = auditLegacyFeedback([
      {
        stage: "generated", detectedIntent: "design_process", riskLevel: "low",
        gateResult: "DRAFT_READY", policyViolation: false,
        customerMessage: "Hi Ronnie, email me at person@example.com. How does design work?",
        aiDraft: "Send photos and wording.",
        finalSentVersion: "Please send your photos and wording, then we will prepare a draft.",
      },
      {
        stage: "generated", detectedIntent: "unknown", riskLevel: "high",
        gateResult: "NEEDS_HUMAN_REVIEW", policyViolation: false,
        customerMessage: "Can I get a refund?", aiDraft: "Human review.",
        finalSentVersion: "We will review the refund request.",
      },
      {
        stage: "generated", detectedIntent: "quote_information_collection", riskLevel: "low",
        gateResult: "DRAFT_READY", policyViolation: false,
        customerMessage: "How much?", aiDraft: "Please send the size.",
        finalSentVersion: "The current price is $189.75.",
      },
      {
        stage: "generated", detectedIntent: "photo_guidance", riskLevel: "low",
        gateResult: "DRAFT_READY", policyViolation: false,
        customerMessage: "Can you check this?", aiDraft: "Please send the original.",
      },
    ]);

    expect(result.counts).toMatchObject({ total: 4, eligible: 1, highRisk: 1, realtime: 1, noHumanFinal: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ intent: "design_process" });
    expect(JSON.stringify(result.candidates)).not.toContain("person@example.com");
    expect(JSON.stringify(result.candidates)).toContain("[email]");
  });

  it("rejects identity-bearing records and never includes raw identifiers", () => {
    const result = auditLegacyFeedback([{
      stage: "generated", detectedIntent: "tone_adjustment", riskLevel: "low",
      gateResult: "DRAFT_READY", policyViolation: false,
      customerMessage: "Thanks", aiDraft: "You are welcome.", finalSentVersion: "You are welcome.",
      senderId: "raw-facebook-id", conversationId: "raw-conversation-id",
    }]);

    expect(result.counts).toMatchObject({ total: 1, identityFields: 1, eligible: 0 });
    expect(result.candidates).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("raw-facebook-id");
    expect(JSON.stringify(result)).not.toContain("raw-conversation-id");
  });
});
