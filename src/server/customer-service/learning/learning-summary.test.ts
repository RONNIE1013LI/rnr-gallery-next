import { describe, expect, it } from "vitest";
import { buildLearningSummary } from "./learning-summary";

const matches = Array.from({ length: 50 }, (_, index) => ({
  caseId: `case-${index}`,
  conversationKeyHash: `${index}`.padStart(64, "0"),
  intent: "design_process",
  editReasonCodes: index < 30 ? ["missing_next_step"] : ["too_long"],
  approvedLowRisk: true,
}));

describe("continuous learning summary", () => {
  it("waits for 50 matched replies", () => {
    expect(buildLearningSummary(matches.slice(0, 49))).toBeNull();
  });

  it("aggregates edit reasons into pending admin-review candidates", () => {
    const summary = buildLearningSummary(matches);
    expect(summary).toMatchObject({
      matchedReplies: 50,
      commonEditReasons: [
        { code: "missing_next_step", count: 30 },
        { code: "too_long", count: 20 },
      ],
    });
    expect(summary?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "pending", requiresAdminApproval: true }),
    ]));
    expect(JSON.stringify(summary)).not.toMatch(/phone|email|address|customer name/i);
  });

  it("uses the matched-reply checkpoint even when only some replies produce eligible case memory", () => {
    const eligibleCases = matches.slice(0, 3);
    expect(buildLearningSummary(eligibleCases, 50, 50)).toMatchObject({
      matchedReplies: 50,
      candidates: [expect.objectContaining({ evidenceCount: 3 })],
    });
  });

  it("excludes high-risk evidence and never approves automatically", () => {
    const summary = buildLearningSummary(matches.map((item, index) => index < 30
      ? { ...item, approvedLowRisk: false }
      : item));
    expect(summary?.candidates.some((candidate) => candidate.reasonCodes.includes("missing_next_step"))).toBe(false);
    expect(summary?.candidates.every((candidate) => candidate.status === "pending")).toBe(true);
  });

  it("does not turn a generic independent human reply reason into an actionable candidate", () => {
    const independent = Array.from({ length: 3 }, (_, index) => ({
      caseId: `independent-${index}`,
      conversationKeyHash: `conversation-${index}`,
      intent: "quote_information_collection",
      editReasonCodes: ["independent_human_reply"],
      approvedLowRisk: true,
      normalizedSituation: "Customer asks an unrelated question.",
      aiDraft: "A different draft.",
      humanFinalReply: "A reply with no repeated semantic pattern.",
      editClassification: "ai_ignored",
    }));
    expect(buildLearningSummary(independent, 50, 50)?.candidates).toEqual([]);
  });

  it("separates two real quote patterns instead of merging by generic edit reason", () => {
    const marketCases = Array.from({ length: 3 }, (_, index) => ({
      caseId: `market-${index}`,
      conversationKeyHash: `market-conversation-${index}`,
      intent: "quote_information_collection",
      editReasonCodes: ["independent_human_reply"],
      approvedLowRisk: true,
      normalizedSituation: "Customer asks for a banner price.",
      aiDraft: "Please send the size, photo count, wording, date and postcode.",
      humanFinalReply: "Are you in NZ or Australia, and do you need a roll-up banner or a wall-hanging banner?",
      editClassification: "ai_ignored",
    }));
    const detailCases = Array.from({ length: 3 }, (_, index) => ({
      caseId: `detail-${index}`,
      conversationKeyHash: `detail-conversation-${index}`,
      intent: "quote_information_collection",
      editReasonCodes: ["independent_human_reply"],
      approvedLowRisk: true,
      normalizedSituation: "Customer has already provided part of the quote details.",
      aiDraft: "Please send the product, size, quantity, photos, wording, date and postcode.",
      humanFinalReply: "Thanks. What size would you like?",
      editClassification: "ai_ignored",
    }));
    const summary = buildLearningSummary([...marketCases, ...detailCases], 50, 50);
    expect(summary?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCodes: ["quote_confirm_market_and_banner_format"], evidenceCount: 3 }),
      expect.objectContaining({ reasonCodes: ["quote_ask_next_missing_detail"], evidenceCount: 3 }),
    ]));
    expect(summary?.candidates).toHaveLength(2);
  });

  it("recognizes a repeated design-input correction without using unrestricted reply text", () => {
    const designCases = Array.from({ length: 3 }, (_, index) => ({
      caseId: `design-${index}`,
      conversationKeyHash: `design-conversation-${index}`,
      intent: "design_process",
      editReasonCodes: ["independent_human_reply"],
      approvedLowRisk: true,
      normalizedSituation: "Customer asks how the design process starts.",
      aiDraft: "A short unrelated draft.",
      humanFinalReply: "Please send your photos, wording and theme so we can prepare your draft.",
      editClassification: "ai_ignored",
    }));
    expect(buildLearningSummary(designCases, 3, 3)?.candidates).toEqual([
      expect.objectContaining({
        reasonCodes: ["design_collect_photos_wording_theme"],
        proposedChange: expect.stringContaining("photos"),
      }),
    ]);
  });

  it("preserves three-conversation diversity before filling the 25-case evidence cap", () => {
    const repeated = Array.from({ length: 25 }, (_, index) => ({
      caseId: `a-${String(index).padStart(2, "0")}`,
      conversationKeyHash: "conversation-a",
      intent: "tone_adjustment",
      editReasonCodes: ["independent_human_reply"],
      approvedLowRisk: true,
      aiDraft: "Thank you for the message. Is there anything else you would like to tell us today?",
      humanFinalReply: "Thanks!",
    }));
    const summary = buildLearningSummary([
      ...repeated,
      { ...repeated[0], caseId: "z-conversation-b", conversationKeyHash: "conversation-b" },
      { ...repeated[0], caseId: "zz-conversation-c", conversationKeyHash: "conversation-c" },
    ], 3, 27);
    expect(summary?.candidates[0]).toMatchObject({ evidenceCount: 25, distinctCaseCount: 3 });
    expect(summary?.candidates[0]?.sourceCaseMemoryIds).toEqual(expect.arrayContaining([
      "z-conversation-b",
      "zz-conversation-c",
    ]));
  });
});
