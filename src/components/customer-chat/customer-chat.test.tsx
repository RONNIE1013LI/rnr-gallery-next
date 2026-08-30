import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerChat } from "./customer-chat";

const analytics = vi.hoisted(() => ({ emitAnalyticsEvent: vi.fn() }));

vi.mock("@/domain/analytics/client", () => analytics);

function updates(events: readonly unknown[] = [], cursor: string | null = "cursor-1") {
  return new Response(JSON.stringify({ cursor, hasMore: false, events, state: "pending" }), {
    headers: { "Content-Type": "application/json" },
  });
}

function accepted() {
  return new Response(JSON.stringify({ status: "accepted" }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

function openChat() {
  const launcher = screen.getByRole("button", { name: "Chat with R&R Gallery" });
  launcher.focus();
  fireEvent.click(launcher);
  return launcher;
}

describe("CustomerChat", () => {
  beforeEach(() => {
    analytics.emitAnalyticsEvent.mockReset();
    analytics.emitAnalyticsEvent.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(updates()));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is closed by default with a labelled 48px launcher", () => {
    render(<CustomerChat />);

    const launcher = screen.getByRole("button", { name: "Chat with R&R Gallery" });
    expect(launcher).toHaveStyle({ width: "48px", height: "48px" });
    expect(screen.queryByRole("dialog", { name: "Chat with R&R Gallery" })).not.toBeInTheDocument();
  });

  it("moves focus into the dialog and restores the launcher when closed with Escape", async () => {
    render(<CustomerChat />);
    openChat();

    expect(await screen.findByRole("dialog", { name: "Chat with R&R Gallery" })).toHaveStyle({
      "--customer-chat-panel-width": "min(380px, calc(100vw - 24px))",
      "--customer-chat-panel-max-height": "min(620px, calc(100dvh - 96px))",
    });
    expect(screen.getByLabelText("Message R&R Gallery")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Chat with R&R Gallery" })).toHaveFocus();
  });

  it("shows only the chat panel while open and uses the shared floating-layer contract", async () => {
    render(<CustomerChat />);
    openChat();

    expect(await screen.findByRole("dialog", { name: "Chat with R&R Gallery" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chat with R&R Gallery" })).not.toBeInTheDocument();
    const css = readFileSync("src/components/customer-chat/customer-chat.module.css", "utf8");
    expect(css).toContain("bottom: var(--customer-chat-bottom-offset");
    expect(css).toContain("z-index: var(--layer-chat-launcher");
  });

  it("shows a retryable initial-history error without blocking a new conversation", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();

    expect(await screen.findByText("We couldn’t load your earlier messages. You can still start a new chat.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hi 👋 How can we help?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry conversation history" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("We couldn’t load your earlier messages. You can still start a new chat.")).not.toBeInTheDocument());
  });

  it("shows the compact welcome and four quick actions only after an empty conversation loads", async () => {
    render(<CustomerChat />);
    openChat();

    expect(screen.queryByRole("heading", { name: "Hi 👋 How can we help?" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hi 👋 How can we help?" })).toBeInTheDocument();
    expect(screen.getByText("Choose an option below or simply type your message.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get a Quote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Product & Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Design Help" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Order Help" })).toBeInTheDocument();
  });

  it("opens an existing conversation without showing the welcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(updates([{
      eventKey: "existing-customer-message",
      role: "customer",
      text: "I need a banner.",
      createdAt: "2026-08-28T00:00:00.000Z",
      state: "pending",
    }])));
    render(<CustomerChat />);
    openChat();

    expect(await screen.findByText("I need a banner.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hi 👋 How can we help?" })).not.toBeInTheDocument();
  });

  it.each([
    ["Get a Quote", "quote", "I'd like to get a quote."],
    ["Product & Pricing", "product_pricing", "I'd like to know about your products and pricing."],
    ["Design Help", "design_help", "I need help with a design."],
    ["Order Help", "order_help", "I need help with an existing order."],
  ] as const)("sends %s through the normal message pipeline", async (label, intent, message) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat pathname="/products" />);
    openChat();
    const quickAction = await screen.findByRole("button", { name: label });

    quickAction.focus();
    expect(quickAction).toHaveFocus();
    fireEvent.click(quickAction);

    expect(within(screen.getByLabelText("Chat messages")).getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Message R&R Gallery")).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "Hi 👋 How can we help?" })).not.toBeInTheDocument();
    expect(screen.getByText("R&R Gallery is typing…")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/messages");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      clientMessageKey: expect.stringMatching(/^[A-Za-z0-9_-]{22,64}$/),
      message,
      pageContext: { pathname: "/products" },
    });
    expect(analytics.emitAnalyticsEvent).toHaveBeenCalledWith({
      event: "chat_quick_action_clicked",
      intent,
      source: "chat_welcome",
    });
  });

  it("prevents rapid repeat clicks from posting the same quick action twice", async () => {
    let acceptMessage: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { acceptMessage = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockReturnValueOnce(pendingResponse);
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const quickAction = await screen.findByRole("button", { name: "Get a Quote" });

    fireEvent.click(quickAction);
    fireEvent.click(quickAction);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/customer-chat/messages")).toHaveLength(1);

    acceptMessage?.(accepted());
    await act(async () => { await pendingResponse; });
  });

  it("reconciles the optimistic quick-action message with the persisted event without duplication", async () => {
    const persisted = {
      eventKey: "persisted-quote",
      role: "customer",
      text: "I'd like to get a quote.",
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      state: "pending",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(updates([persisted], "cursor-2"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();

    fireEvent.click(await screen.findByRole("button", { name: "Get a Quote" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getAllByText("I'd like to get a quote.")).toHaveLength(1);
  });

  it("keeps a failed quick-action message and existing retry flow without restoring the welcome", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();

    fireEvent.click(await screen.findByRole("button", { name: "Design Help" }));

    expect(await screen.findByText("Message not sent. Try again.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Chat messages")).getByText("I need help with a design.")).toBeInTheDocument();
    expect(screen.getByLabelText("Message R&R Gallery")).toHaveValue("I need help with a design.");
    expect(screen.queryByRole("heading", { name: "Hi 👋 How can we help?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry message" })).toBeInTheDocument();
  });

  it("does not restore the welcome when a conversation is closed and reopened", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    fireEvent.click(await screen.findByRole("button", { name: "Order Help" }));
    await screen.findByText("I need help with an existing order.");

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat with R&R Gallery" }));

    expect(screen.getByText("I need help with an existing order.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hi 👋 How can we help?" })).not.toBeInTheDocument();
  });

  it("sends on Enter and lets Shift+Enter add a newline without preventing the textarea default", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "First line" } });
    const shiftEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, shiftEnter);
    expect(shiftEnter.defaultPrevented).toBe(false);
    fireEvent.change(input, { target: { value: "First line\nSecond line" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("First line\nSecond line");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/messages");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      clientMessageKey: expect.stringMatching(/^[A-Za-z0-9_-]{22,64}$/),
      message: "First line\nSecond line",
      pageContext: { pathname: "/" },
    });
  });

  it.each(["Chinese", "Japanese", "Korean"])(
    "does not send on Enter while %s IME composition is active",
    async () => {
      const fetchMock = vi.mocked(fetch);
      render(<CustomerChat />);
      openChat();
      const input = await screen.findByLabelText("Message R&R Gallery");

      fireEvent.change(input, { target: { value: "正在输入" } });
      fireEvent.compositionStart(input);
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(input).toHaveValue("正在输入");
    },
  );

  it("sends a rapid Enter after composition ends but still respects event.isComposing", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Quote please" } });
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps an unchanged network-failed draft retry-only and reuses its idempotency key on explicit retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = screen.getByLabelText("Message R&R Gallery");
    await act(async () => {});

    fireEvent.change(input, { target: { value: "Can you help with a canvas?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Message not sent. Try again.")).toHaveAttribute("aria-live", "polite");
    expect(input).toHaveValue("Can you help with a canvas?");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Use Retry message to resend the unchanged message.")).toHaveAttribute("aria-live", "polite");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const firstPost = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const retriedPost = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(retriedPost).toEqual(firstPost);
    expect(input).toHaveValue("");
  });

  it("sends an edited failed draft as a new message and clears only that accepted visible draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = screen.getByLabelText("Message R&R Gallery");
    await act(async () => {});

    fireEvent.change(input, { target: { value: "Original message" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Message not sent. Try again.");
    const failedPost = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

    fireEvent.change(input, { target: { value: "Edited visible message" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const editedPost = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(editedPost).toMatchObject({ message: "Edited visible message", pageContext: { pathname: "/" } });
    expect(editedPost.clientMessageKey).not.toBe(failedPost.clientMessageKey);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
  });

  it("renders a rate limit response without exposing server details or discarding the draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "RATE_LIMITED", detail: "private" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "A message" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Please wait a moment before sending another message.")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(input).toHaveValue("A message");
  });

  it("polls visible updates every 2500ms, merges duplicate event keys, and preserves an unsent draft", async () => {
    vi.useFakeTimers();
    const first = {
      eventKey: "event-1",
      role: "customer",
      text: "First message",
      createdAt: "2026-08-22T00:00:00.000Z",
      state: "pending",
    };
    const second = {
      eventKey: "event-2",
      role: "assistant",
      text: "Thanks for your message.",
      createdAt: "2026-08-22T00:00:01.000Z",
      state: "committed_assistant",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([first, first], "cursor-1"))
      .mockResolvedValueOnce(updates([first, second], "cursor-2"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = screen.getByLabelText("Message R&R Gallery");
    await act(async () => {});
    fireEvent.change(input, { target: { value: "Unsent draft" } });

    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });

    expect(screen.getAllByText("First message")).toHaveLength(1);
    expect(screen.getByText("Thanks for your message.")).toBeInTheDocument();
    expect(input).toHaveValue("Unsent draft");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/updates?cursor=cursor-1");
    expect(screen.getByTestId("customer-chat-live-region")).toHaveAttribute("aria-live", "polite");
  });

  it("catches up immediately when focus or network returns and pauses interval polling while hidden", async () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const fetchMock = vi.fn().mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hidden = true;
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hidden = false;
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {});
    fireEvent.focus(window);
    await act(async () => {});
    fireEvent(window, new Event("online"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
