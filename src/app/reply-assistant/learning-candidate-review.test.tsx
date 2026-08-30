import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningCandidateReview } from "./learning-candidate-review";

const candidate = {
  id: "11111111-1111-4111-8111-111111111111",
  intent: "design_process",
  proposedChange: "Always include the next customer step.",
  observedPattern: "Human replies add a focused next step that the AI draft omitted.",
  reasonCodes: ["missing_next_step", "too_generic"],
  evidenceCount: 4,
  supportingCases: [{
    customer: "Customer asks how the design process starts.",
    aiDraft: "Please send your details.",
    humanFinal: "Please send your photos, wording and theme.",
    detectedChange: "Human reply added the three relevant design inputs.",
  }],
  status: "pending" as const,
};

describe("learning candidate review", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows compact evidence and admin-only decision controls", () => {
    const html = renderToStaticMarkup(
      <LearningCandidateReview candidates={[candidate]} canReview />,
    );
    expect(html).toContain("missing next step");
    expect(html).toContain("4 cases");
    expect(html).toContain("Observed pattern");
    expect(html).toContain("Proposed guidance");
    expect(html).toContain("View 1 of 4 supporting cases");
    expect(html).toContain("Customer");
    expect(html).toContain("AI draft");
    expect(html).toContain("Human final");
    expect(html).toContain("Detected change");
    expect(html).toContain("Approve");
    expect(html).toContain("Edit &amp; Approve");
    expect(html).toContain("Reject");
    expect(html).not.toMatch(/conversation|sender|facebook|humanFinalText|customerId/i);
  });

  it("keeps staff view-only", () => {
    const html = renderToStaticMarkup(
      <LearningCandidateReview candidates={[candidate]} canReview={false} />,
    );
    expect(html).toContain("Pending admin review");
    expect(html).not.toContain("Edit &amp; Approve");
    expect(html).not.toContain(">Reject<");
  });

  it("shows the validated pending total instead of the loaded page length", () => {
    const html = renderToStaticMarkup(
      <LearningCandidateReview candidates={[candidate]} pendingCount={4} canReview />,
    );
    expect(html).toContain("4 pending");
  });

  it("fails closed for an incomplete legacy API candidate", () => {
    const legacy = {
      id: candidate.id,
      intent: candidate.intent,
      proposedChange: candidate.proposedChange,
      reasonCodes: candidate.reasonCodes,
      evidenceCount: candidate.evidenceCount,
      status: candidate.status,
    };
    const html = renderToStaticMarkup(
      <LearningCandidateReview candidates={[legacy as typeof candidate]} canReview />,
    );
    expect(html).toContain("No learning candidates are waiting.");
    expect(html).not.toContain(candidate.proposedChange);
  });

  it("shows a retryable error when an approval decision fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 422 })));
    render(<LearningCandidateReview candidates={[candidate]} canReview />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save this decision");
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("keeps the candidate pending and shows a retryable error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network unavailable");
    }));
    render(<LearningCandidateReview candidates={[candidate]} canReview />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save this decision");
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("tracks concurrent decisions independently by candidate", async () => {
    const resolvers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve))));
    const second = { ...candidate, id: "22222222-2222-4222-8222-222222222222", intent: "photo_guidance" };
    render(<LearningCandidateReview candidates={[candidate, second]} canReview />);
    const approve = screen.getAllByRole("button", { name: "Approve" });
    fireEvent.click(approve[0]);
    fireEvent.click(approve[1]);
    expect(approve[0]).toBeDisabled();
    expect(approve[1]).toBeDisabled();

    resolvers[0](new Response(null, { status: 200 }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    resolvers[1](new Response(null, { status: 200 }));
  });
});
