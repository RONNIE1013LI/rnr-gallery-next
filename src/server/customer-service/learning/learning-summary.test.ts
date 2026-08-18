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
});
