import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CaseMemoryReview } from "./case-memory-review";

const cases = [{
  id: "11111111-1111-4111-8111-111111111111",
  intent: "design_process",
  normalizedSituation: "Customer asks how the design process works.",
  humanFinalReply: "Please send your photos, wording and theme.",
  status: "pending_review" as const,
}];

describe("case memory review", () => {
  it("shows the sanitized evidence before an admin can approve it", () => {
    render(<CaseMemoryReview cases={cases} canReview />);
    expect(screen.getByText(cases[0].normalizedSituation)).toBeInTheDocument();
    expect(screen.getByText(cases[0].humanFinalReply)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve case" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject case" })).toBeInTheDocument();
  });

  it("does not expose review actions to staff", () => {
    render(<CaseMemoryReview cases={cases} canReview={false} />);
    expect(screen.queryByRole("button", { name: "Approve case" })).not.toBeInTheDocument();
  });
});
