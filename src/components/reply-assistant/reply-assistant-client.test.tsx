import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatReplyReceivedAt, ReplyAssistantClient, type ReplyQueueItem } from "./reply-assistant-client";

const item = {
  inboxId: "a".repeat(64),
  channel: "facebook" as const,
  latestMessageId: "11111111-1111-4111-8111-111111111111",
  lastActivityAt: "2026-08-17T00:01:00.000Z",
  unreadCount: 0,
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
    { eventId: "event:11111111-1111-4111-8111-111111111111", role: "customer" as const, text: "Can you use my blurry photo?", receivedAt: "2026-08-17T00:00:00.000Z" },
    { eventId: "event:22222222-2222-4222-8222-222222222222", role: "staff" as const, text: "Please send the original file.", receivedAt: "2026-08-17T00:01:00.000Z" },
  ],
  hasEarlierTimeline: false,
};
const websiteSelector = `wrs1.m8k6x0.${"A".repeat(43)}`;

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

  it("sends one feedback request when acceptance is double-clicked before the response settles", async () => {
    let release!: () => void;
    const pending = new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify({ recorded: true }), { status: 201 })); });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    render(<ReplyAssistantClient initialItems={[item]} />);

    const accept = screen.getByRole("button", { name: "Accept unchanged" });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(accept).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  });

  it("shows failed feedback and reuses its idempotency key on retry", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 503 });
    }));
    render(<ReplyAssistantClient initialItems={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not save this review. Please try again."));
    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect(bodies).toHaveLength(2);
    expect((bodies[0] as { idempotencyKey: string }).idempotencyKey)
      .toBe((bodies[1] as { idempotencyKey: string }).idempotencyKey);
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("does not submit feedback when copying the approved reply fails", async () => {
    render(<ReplyAssistantClient initialItems={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
    vi.mocked(fetch).mockClear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error("clipboard_denied"); }) } });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The reply could not be copied. Please try again."));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("warns when copied feedback fails and reuses its copied-event idempotency key on retry", async () => {
    const copiedBodies: Array<{ idempotencyKey: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { action: string; idempotencyKey: string };
      if (body.action === "copied") {
        copiedBodies.push(body);
        return new Response(null, { status: 503 });
      }
      return new Response(JSON.stringify({ recorded: true }), { status: 201 });
    }));
    render(<ReplyAssistantClient initialItems={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("alert"))
      .toHaveTextContent("The text was copied, but its review event was not saved. Copy again to retry."));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(item.draftText);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copiedBodies).toHaveLength(2));
    expect(copiedBodies[1]?.idempotencyKey).toBe(copiedBodies[0]?.idempotencyKey);
  });

  it("disables a completed terminal feedback action", async () => {
    render(<ReplyAssistantClient initialItems={[item]} />);
    const accept = screen.getByRole("button", { name: "Accept unchanged" });
    fireEvent.click(accept);
    await waitFor(() => expect(accept).toBeDisabled());
    fireEvent.click(accept);

    expect(fetch).toHaveBeenCalledTimes(1);
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
      timeline: [{ ...item.timeline[0], text: "[Image attachment]" }],
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

  it("pins a deep-linked website review even when 100 newer live items exist", () => {
    const selector = `wrs1.m8k6x0.${"A".repeat(43)}`;
    const selected = {
      ...item,
      inboxId: "selected-old-website-review",
      latestMessageId: "11111111-1111-4111-8111-111111111112",
      channel: "website" as const,
      lastActivityAt: "2026-08-01T00:00:00.000Z",
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      websiteReview: { selector, reason: "high_risk" as const, alertStatus: "pending" as const },
      timeline: [{ eventId: "event:selected-old", role: "customer" as const, text: "Deep-linked older website review", receivedAt: "2026-08-01T00:00:00.000Z" }],
    };
    const newer = Array.from({ length: 100 }, (_, index) => ({
      ...item,
      inboxId: `newer-${index}`,
      latestMessageId: `newer-message-${index}`,
      lastActivityAt: new Date(Date.UTC(2026, 7, 2, 0, 0, index)).toISOString(),
      latestAttemptId: null,
      draftText: null,
      humanReplyReceived: true,
      timeline: [],
    }));

    render(<ReplyAssistantClient
      initialItems={[selected, ...newer]}
      liveItems={[selected, ...newer]}
      selectedReviewSelector={selector}
    />);

    expect(screen.getByText("Deep-linked older website review")).toBeInTheDocument();
    expect(screen.getByLabelText("Website reply")).toBeInTheDocument();
  });

  it("shows a focused first batch and reveals more conversations on demand", () => {
    const conversations = Array.from({ length: 25 }, (_, index) => ({
      ...item,
      inboxId: `inbox-${index}`,
      latestMessageId: `message-${index}`,
      lastActivityAt: new Date(Date.UTC(2026, 7, 17, 0, 0, index)).toISOString(),
      humanReplyReceived: true,
      timeline: [],
    }));

    render(<ReplyAssistantClient initialItems={conversations} />);

    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.getByText("Showing 12 of 25 conversations")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 12 more conversations" }));

    expect(screen.getAllByRole("article")).toHaveLength(24);
    expect(screen.getByText("Showing 24 of 25 conversations")).toBeInTheDocument();
  });

  it("resets the visible batch when the active channel changes", () => {
    const facebook = Array.from({ length: 13 }, (_, index) => ({
      ...item,
      inboxId: `facebook-inbox-${index}`,
      latestMessageId: `facebook-${index}`,
      lastActivityAt: new Date(Date.UTC(2026, 7, 17, 0, 0, index)).toISOString(),
      humanReplyReceived: true,
      timeline: [],
    }));
    const website = facebook.map((entry, index) => ({
      ...entry,
      inboxId: `website-inbox-${index}`,
      latestMessageId: `website-${index}`,
      channel: "website" as const,
    }));
    const view = render(<ReplyAssistantClient
      initialItems={facebook}
      liveItems={facebook}
      channelScope="facebook"
    />);

    fireEvent.click(screen.getByRole("button", { name: "Show 1 more conversations" }));
    expect(screen.getAllByRole("article")).toHaveLength(13);

    view.rerender(<ReplyAssistantClient
      initialItems={facebook}
      liveItems={website}
      channelScope="website"
    />);

    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.getByText("Showing 12 of 13 conversations")).toBeInTheDocument();

    view.rerender(<ReplyAssistantClient
      initialItems={facebook}
      liveItems={facebook}
      channelScope="facebook"
    />);
    expect(screen.getAllByRole("article")).toHaveLength(13);
  });

  it("shows a Website review timeline, alert state, and only committed public replies", () => {
    render(<ReplyAssistantClient initialItems={[{
      ...item,
      channel: "website",
      status: "blocked",
      draftText: "Internal AI draft that was never published",
      gateResult: "high_risk",
      websiteReview: {
        selector: websiteSelector,
        reason: "high_risk",
        alertStatus: "sent",
      },
      timeline: [
        { eventId: "event:website-customer", role: "customer", text: "Can I get a refund?", receivedAt: "2026-08-17T00:00:00.000Z" },
        { eventId: "assistant:website-assistant", role: "assistant", text: "Our team will review this and reply here.", receivedAt: "2026-08-17T00:00:01.000Z" },
        { eventId: "event:website-staff", role: "staff", text: "We have reviewed your request.", receivedAt: "2026-08-17T00:02:00.000Z" },
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

  it("shows an open website review without offering send until its persisted selector is available", () => {
    const unavailableReview = {
      ...item,
      channel: "website" as const,
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      websiteReview: {
        selector: null,
        reason: "high_risk" as const,
        alertStatus: "pending" as const,
      },
    } as ReplyQueueItem;
    render(<ReplyAssistantClient initialItems={[unavailableReview]} />);

    expect(screen.getByText("Website review action is preparing. Refresh shortly.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send website reply" })).not.toBeInTheDocument();
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
        selector: websiteSelector,
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
        selector: websiteSelector,
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
        eventId: "event:website-follow-up",
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
        selector: `wrs1.m8k6x0.${"B".repeat(43)}`,
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

  it("keeps one mounted box when the same inbox receives a new latest message", () => {
    const second = {
      ...item,
      latestMessageId: "33333333-3333-4333-8333-333333333333",
      lastActivityAt: "2026-08-17T00:02:00.000Z",
      draftText: null,
      latestAttemptId: null,
      status: "received",
      timeline: [...item.timeline, { eventId: "event:33333333-3333-4333-8333-333333333333", role: "customer" as const, text: "A new customer message", receivedAt: "2026-08-17T00:02:00.000Z" }],
    };
    const { rerender } = render(<ReplyAssistantClient initialItems={[item]} liveItems={[item]} newInboxIds={[]} />);

    rerender(<ReplyAssistantClient
      initialItems={[item]}
      liveItems={[second, second, item]}
      newInboxIds={[second.inboxId]}
    />);

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("A new customer message")).toBeInTheDocument();
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("renders one oldest-first timeline across product topics and one Website reply surface", () => {
    const websiteItem = {
      ...item,
      channel: "website" as const,
      lastActivityAt: "2026-08-17T00:04:00.000Z",
      latestAttemptId: null,
      draftText: null,
      gateResult: null,
      websiteReview: {
        selector: websiteSelector,
        reason: "high_risk" as const,
        alertStatus: "sent" as const,
      },
      timeline: [
        { eventId: "event:rollup", role: "customer" as const, text: "How much for Roll-up?", receivedAt: "2026-08-17T00:00:00.000Z" },
        { eventId: "event:rollup-reply", role: "staff" as const, text: "Which market?", receivedAt: "2026-08-17T00:01:00.000Z" },
        { eventId: "event:canvas", role: "customer" as const, text: "Now I need Canvas", receivedAt: "2026-08-17T00:04:00.000Z" },
      ],
    };

    render(<ReplyAssistantClient initialItems={[websiteItem, websiteItem]} />);

    expect(screen.getAllByRole("article")).toHaveLength(1);
    const timeline = screen.getByRole("region", { name: "Conversation timeline" });
    expect(within(timeline).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "CustomerHow much for Roll-up?",
      "R&RWhich market?",
      "CustomerNow I need Canvas",
    ]);
    expect(screen.getAllByLabelText("Website reply")).toHaveLength(1);
  });

  it("prepends authenticated earlier timeline pages without duplicating boundary events", async () => {
    const paged = {
      ...item,
      hasEarlierTimeline: true,
      timeline: [
        { eventId: "event:current-1", role: "customer" as const, text: "Current Roll-up question", receivedAt: "2026-08-17T00:02:00.000Z" },
        { eventId: "event:current-2", role: "customer" as const, text: "Current Canvas question", receivedAt: "2026-08-17T00:03:00.000Z" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events: [
        { eventId: "event:earlier-1", role: "customer", text: "Earlier question", receivedAt: "2026-08-17T00:00:00.000Z" },
        { eventId: "event:current-1", role: "customer", text: "Current Roll-up question", receivedAt: "2026-08-17T00:02:00.000Z" },
      ],
      cursor: null,
      hasEarlier: false,
    }), { status: 200 })));

    render(<ReplyAssistantClient initialItems={[paged]} />);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier conversation history" }));

    await waitFor(() => expect(screen.getByText("Earlier question")).toBeInTheDocument());
    const timeline = screen.getByRole("region", { name: "Conversation timeline" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(3);
    expect(within(timeline).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "CustomerEarlier question",
      "CustomerCurrent Roll-up question",
      "CustomerCurrent Canvas question",
    ]);
    expect(fetch).toHaveBeenCalledWith(
      `/api/reply-assistant/inbox/${paged.inboxId}/timeline?cursor=event%3Acurrent-1`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.queryByRole("button", { name: "Load earlier conversation history" })).not.toBeInTheDocument();
  });

  it("preserves a displaced rolling-window boundary after earlier history is complete", async () => {
    const paged = {
      ...item,
      hasEarlierTimeline: true,
      timeline: [
        { eventId: "event:51", role: "customer" as const, text: "Event 51", receivedAt: "2026-08-17T00:51:00.000Z" },
        { eventId: "event:52", role: "staff" as const, text: "Event 52", receivedAt: "2026-08-17T00:52:00.000Z" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      events: [{ eventId: "event:50", role: "customer", text: "Event 50", receivedAt: "2026-08-17T00:50:00.000Z" }],
      cursor: null,
      hasEarlier: false,
    }), { status: 200 })));
    const view = render(<ReplyAssistantClient initialItems={[paged]} liveItems={[paged]} />);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier conversation history" }));
    await waitFor(() => expect(screen.getByText("Event 50")).toBeInTheDocument());

    const shifted = {
      ...paged,
      latestMessageId: "33333333-3333-4333-8333-333333333333",
      lastActivityAt: "2026-08-17T00:53:00.000Z",
      timeline: [
        paged.timeline[1],
        { eventId: "event:53", role: "customer" as const, text: "Event 53", receivedAt: "2026-08-17T00:53:00.000Z" },
      ],
    };
    view.rerender(<ReplyAssistantClient initialItems={[paged]} liveItems={[shifted]} />);

    const timeline = screen.getByRole("region", { name: "Conversation timeline" });
    expect(within(timeline).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "CustomerEvent 50",
      "CustomerEvent 51",
      "R&REvent 52",
      "CustomerEvent 53",
    ]);
    expect(screen.getAllByText("Event 51")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load earlier conversation history" })).not.toBeInTheDocument();

    const shiftedAgain = {
      ...shifted,
      latestMessageId: "44444444-4444-4444-8444-444444444444",
      lastActivityAt: "2026-08-17T00:54:00.000Z",
      timeline: [
        shifted.timeline[1],
        { eventId: "event:54", role: "staff" as const, text: "Event 54", receivedAt: "2026-08-17T00:54:00.000Z" },
      ],
    };
    view.rerender(<ReplyAssistantClient initialItems={[paged]} liveItems={[shiftedAgain]} />);

    await waitFor(() => expect(within(timeline).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "CustomerEvent 50",
      "CustomerEvent 51",
      "R&REvent 52",
      "CustomerEvent 53",
      "R&REvent 54",
    ]));
    expect(screen.getAllByText("Event 51")).toHaveLength(1);
    expect(screen.getAllByText("Event 53")).toHaveLength(1);
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

  it("adopts a live replacement attempt without inheriting the prior attempt feedback completion", async () => {
    const replacementAttemptId = "44444444-4444-4444-8444-444444444444";
    const replacementDraft = "A newer server draft";
    const { rerender } = render(<ReplyAssistantClient initialItems={[item]} liveItems={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());

    rerender(<ReplyAssistantClient
      initialItems={[item]}
      liveItems={[{ ...item, latestAttemptId: replacementAttemptId, draftText: replacementDraft }]}
    />);

    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    expect(screen.getByLabelText("Reply draft")).toHaveValue(replacementDraft);

    const acceptEdit = screen.getByRole("button", { name: "Accept edit" });
    expect(acceptEdit).toBeEnabled();
    fireEvent.click(acceptEdit);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain(`/drafts/${replacementAttemptId}/feedback`);
  });

  it("allows adopting a replacement while prior-attempt feedback is still in flight", async () => {
    let releasePrior!: () => void;
    let releaseReplacement!: () => void;
    const priorPending = new Promise<Response>((resolve) => {
      releasePrior = () => resolve(new Response(JSON.stringify({ recorded: true }), { status: 201 }));
    });
    const replacementPending = new Promise<Response>((resolve) => {
      releaseReplacement = () => resolve(new Response(JSON.stringify({ recorded: true }), { status: 201 }));
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => priorPending)
      .mockImplementationOnce(() => replacementPending));
    const { rerender } = render(<ReplyAssistantClient initialItems={[item]} liveItems={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept unchanged" }));
    expect(screen.getByRole("button", { name: "Accept unchanged" })).toBeDisabled();

    rerender(<ReplyAssistantClient
      initialItems={[item]}
      liveItems={[{ ...item, latestAttemptId: "44444444-4444-4444-8444-444444444444", draftText: "A newer server draft" }]}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const acceptEdit = screen.getByRole("button", { name: "Accept edit" });
    expect(acceptEdit).toBeEnabled();
    fireEvent.click(acceptEdit);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(acceptEdit).toBeDisabled();

    releasePrior();
    await waitFor(() => expect(acceptEdit).toBeDisabled());
    releaseReplacement();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled());
  });
});
