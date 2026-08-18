import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatReplyReceivedAt, ReplyAssistantClient } from "./reply-assistant-client";

const item = {
  messageId: "11111111-1111-4111-8111-111111111111",
  body: "Can you use my blurry photo?",
  receivedAt: "2026-08-17T00:00:00.000Z",
  status: "draft_ready",
  latestAttemptId: "22222222-2222-4222-8222-222222222222",
  draftText: "Please send the original photo and we can assess it for you 😊",
  gateResult: "allowed",
  attachmentCount: 0,
  imageAnalysisStatus: "not_applicable" as const,
  imageAssessmentSummary: null,
  timeline: [
    { role: "customer" as const, text: "Can you use my blurry photo?", receivedAt: "2026-08-17T00:00:00.000Z" },
    { role: "staff" as const, text: "Please send the original file.", receivedAt: "2026-08-17T00:01:00.000Z" },
  ],
};

describe("ReplyAssistantClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recorded: true }), { status: 201 })));
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  });

  it("formats received times in a fixed timezone for stable hydration", () => {
    expect(formatReplyReceivedAt("2026-08-17T00:00:00.000Z")).toBe("17/08/2026, 12:00:00 pm");
  });

  it("requires human acceptance before copy and never calls a send endpoint", async () => {
    render(<ReplyAssistantClient initialItems={[item]} />);
    const copy = screen.getByRole("button", { name: "Copy" });
    expect(copy).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(item.draftText));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).join("\n")).not.toMatch(/\/send|graph\.facebook/i);
  });

  it("supports an edited human final reply", async () => {
    render(<ReplyAssistantClient initialItems={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Reply draft"), { target: { value: "Please send the original photo and we will check it 😊" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept edit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  });

  it("shows a blocked risk without an editable draft", () => {
    render(<ReplyAssistantClient initialItems={[{ ...item, status: "blocked", draftText: null, gateResult: "high_risk" }]} />);
    expect(screen.getByText("Human review required")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reply draft")).not.toBeInTheDocument();
  });

  it("shows only the validated image assessment summary", () => {
    render(<ReplyAssistantClient initialItems={[{
      ...item,
      attachmentCount: 1,
      imageAnalysisStatus: "assessed",
      imageAssessmentSummary: "Image 0 appears cropped; request an uncropped version.",
    }]} />);

    expect(screen.getByText("Image assessment")).toBeInTheDocument();
    expect(screen.getByText("Image 0 appears cropped; request an uncropped version.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps image-only messages in human review and disables generation", () => {
    render(<ReplyAssistantClient initialItems={[{
      ...item,
      body: "[Image attachment]",
      status: "blocked",
      draftText: null,
      gateResult: "unresolved",
      attachmentCount: 1,
      imageAnalysisStatus: "human_review_required",
      imageAssessmentSummary: null,
    }]} />);

    expect(screen.getByText("Human review required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate AI Reply" })).toBeDisabled();
  });

  it("disables visual regeneration while retaining the manual copy flow", async () => {
    render(<ReplyAssistantClient initialItems={[{
      ...item,
      attachmentCount: 1,
      imageAnalysisStatus: "human_review_required",
      imageAssessmentSummary: null,
    }]} />);

    expect(screen.getByText("Human review required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  });

  it("shows actual human outbound messages in the conversation timeline", () => {
    render(<ReplyAssistantClient initialItems={[item]} />);

    expect(screen.getByRole("region", { name: "Conversation timeline" })).toBeInTheDocument();
    expect(screen.getByText("R&R")).toBeInTheDocument();
    expect(screen.getByText("Please send the original file.")).toBeInTheDocument();
    expect(screen.queryByText("AI draft", { exact: false })).not.toBeInTheDocument();
  });
});
