import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatReplyReceivedAt, ReplyAssistantClient } from "./reply-assistant-client";

const item = {
  messageId: "11111111-1111-4111-8111-111111111111",
  channel: "facebook" as const,
  body: "Can you use my blurry photo?",
  receivedAt: "2026-08-17T00:00:00.000Z",
  status: "draft_ready",
  latestAttemptId: "22222222-2222-4222-8222-222222222222",
  draftText: "Please send the original photo and we can assess it for you 😊",
  gateResult: "allowed",
  attachmentCount: 0,
  imageAnalysisStatus: "not_applicable" as const,
  imageAssessmentSummary: null,
  humanReplyReceived: false,
  websiteReview: null,
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

  it("labels Facebook cards and timelines without adding the website reply action", () => {
    render(<ReplyAssistantClient initialItems={[item]} />);

    expect(screen.getAllByText("Facebook")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Send website reply" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("shows a Website review timeline, alert state, and only committed public replies", () => {
    render(<ReplyAssistantClient initialItems={[{
      ...item,
      channel: "website",
      status: "blocked",
      draftText: "Internal AI draft that was never published",
      gateResult: "high_risk",
      websiteReview: {
        selector: "33333333-3333-4333-8333-333333333333",
        reason: "high_risk",
        alertStatus: "sent",
      },
      timeline: [
        { role: "customer", text: "Can I get a refund?", receivedAt: "2026-08-17T00:00:00.000Z" },
        { role: "assistant", text: "Our team will review this and reply here.", receivedAt: "2026-08-17T00:00:01.000Z" },
        { role: "staff", text: "We have reviewed your request.", receivedAt: "2026-08-17T00:02:00.000Z" },
      ],
    }]} />);

    expect(screen.getAllByText("Website")).toHaveLength(2);
    expect(screen.getByText("Alert sent")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Our team will review this and reply here.")).toBeInTheDocument();
    expect(screen.getByText("We have reviewed your request.")).toBeInTheDocument();
    expect(screen.queryByText("Internal AI draft that was never published")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Website reply")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("sends only safe reply text and the server-issued website review selector", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      await pending;
      return new Response(JSON.stringify({ sent: true }), { status: 201 });
    }));
    const websiteItem = {
      ...item,
      channel: "website" as const,
      websiteReview: {
        selector: "33333333-3333-4333-8333-333333333333",
        reason: "high_risk" as const,
        alertStatus: "sent" as const,
      },
    };
    render(<ReplyAssistantClient initialItems={[websiteItem]} />);

    fireEvent.change(screen.getByLabelText("Website reply"), { target: { value: "  We have reviewed this for you.  " } });
    const send = screen.getByRole("button", { name: "Send website reply" });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/reply-assistant/website-replies");
    expect(JSON.parse(String(request?.body))).toEqual({
      reviewSelector: websiteItem.websiteReview.selector,
      text: "We have reviewed this for you.",
    });
    expect(String(request?.body)).not.toMatch(/conversation|session|psid|messageId|attemptId/i);
    expect(vi.mocked(fetch).mock.calls.map(([calledUrl]) => String(calledUrl)).join("\n")).not.toMatch(/openai|graph\.facebook|messenger|generate/i);
    release();
    await waitFor(() => expect(screen.getByText("Website reply sent.")).toBeInTheDocument());
  });

  it("preserves an unsent website reply while polling and blocks it when the review changes", () => {
    const websiteItem = {
      ...item,
      channel: "website" as const,
      websiteReview: {
        selector: "33333333-3333-4333-8333-333333333333",
        reason: "high_risk" as const,
        alertStatus: "sent" as const,
      },
    };
    const { rerender } = render(<ReplyAssistantClient initialItems={[websiteItem]} liveItems={[websiteItem]} />);
    const editor = screen.getByLabelText("Website reply") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "Ronnie local website reply" } });

    rerender(<ReplyAssistantClient initialItems={[websiteItem]} liveItems={[{
      ...websiteItem,
      timeline: [...websiteItem.timeline, {
        role: "customer" as const,
        text: "One more detail",
        receivedAt: "2026-08-17T00:03:00.000Z",
      }],
    }]} />);
    expect(screen.getByLabelText("Website reply")).toBe(editor);
    expect(editor).toHaveValue("Ronnie local website reply");
    expect(screen.getByRole("button", { name: "Send website reply" })).toBeEnabled();

    rerender(<ReplyAssistantClient initialItems={[websiteItem]} liveItems={[{
      ...websiteItem,
      websiteReview: {
        ...websiteItem.websiteReview,
        selector: "44444444-4444-4444-8444-444444444444",
      },
    }]} />);
    expect(editor).toHaveValue("Ronnie local website reply");
    expect(screen.getByText("Server review changed. Your reply is preserved but cannot be sent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send website reply" })).toBeDisabled();
  });

  it("closes stale draft actions after an actual human reply", () => {
    render(<ReplyAssistantClient initialItems={[{ ...item, humanReplyReceived: true }]} />);

    expect(screen.getByText("Human reply sent in Meta. AI draft closed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reply draft")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept unchanged" })).not.toBeInTheDocument();
  });

  it("merges repeated live items by message ID and marks only newly arrived messages", () => {
    const second = {
      ...item,
      messageId: "33333333-3333-4333-8333-333333333333",
      body: "A new customer message",
      receivedAt: "2026-08-17T00:02:00.000Z",
      draftText: null,
      latestAttemptId: null,
      status: "received",
    };
    const { rerender } = render(<ReplyAssistantClient initialItems={[item]} liveItems={[item]} newMessageIds={[]} />);

    rerender(<ReplyAssistantClient
      initialItems={[item]}
      liveItems={[second, second, item]}
      newMessageIds={[second.messageId]}
    />);

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("A new customer message")).toBeInTheDocument();
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("preserves an unsaved local edit when polling replaces the server draft", () => {
    const { rerender } = render(<ReplyAssistantClient initialItems={[item]} liveItems={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByLabelText("Reply draft") as HTMLTextAreaElement;
    editor.focus();
    editor.scrollTop = 42;
    fireEvent.change(editor, { target: { value: "Ronnie local wording" } });

    rerender(<ReplyAssistantClient
      initialItems={[item]}
      liveItems={[{ ...item, latestAttemptId: "44444444-4444-4444-8444-444444444444", draftText: "A newer server draft" }]}
    />);

    expect(screen.getByLabelText("Reply draft")).toBe(editor);
    expect(editor).toHaveValue("Ronnie local wording");
    expect(editor).toHaveFocus();
    expect(editor.scrollTop).toBe(42);
    expect(screen.getByText("Server state changed. Your edit is preserved.")).toBeInTheDocument();
  });

  it("never applies an accepted draft to a newer server attempt", async () => {
    const { rerender } = render(<ReplyAssistantClient initialItems={[item]} liveItems={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());

    rerender(<ReplyAssistantClient
      initialItems={[item]}
      liveItems={[{
        ...item,
        latestAttemptId: "44444444-4444-4444-8444-444444444444",
        draftText: "A newer server draft",
      }]}
    />);

    expect(screen.getByText("Server state changed. Review the new draft before using it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark as manually sent" })).toBeDisabled();
  });
});
