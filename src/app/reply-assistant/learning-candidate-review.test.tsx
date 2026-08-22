import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearningCandidateReview } from "./learning-candidate-review";

const candidate = {
  id: "11111111-1111-4111-8111-111111111111",
  intent: "design_process",
  proposedChange: "Always include the next customer step.",
  reasonCodes: ["missing_next_step", "too_generic"],
  evidenceCount: 4,
  status: "pending" as const,
};

describe("learning candidate review", () => {
  it("shows compact evidence and admin-only decision controls", () => {
    const html = renderToStaticMarkup(
      <LearningCandidateReview candidates={[candidate]} canReview />,
    );
    expect(html).toContain("missing next step");
    expect(html).toContain("4 cases");
    expect(html).toContain("Approve");
    expect(html).toContain("Edit &amp; Approve");
    expect(html).toContain("Reject");
    expect(html).not.toMatch(/conversation|sender|facebook|humanFinalText/i);
  });

  it("keeps staff view-only", () => {
    const html = renderToStaticMarkup(
      <LearningCandidateReview candidates={[candidate]} canReview={false} />,
    );
    expect(html).toContain("Pending admin review");
    expect(html).not.toContain("Edit &amp; Approve");
    expect(html).not.toContain(">Reject<");
  });
});
