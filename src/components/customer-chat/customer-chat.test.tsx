import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerChat } from "./customer-chat";

const analytics = vi.hoisted(() => ({ emitAnalyticsEvent: vi.fn() }));
const sessionEndpoint = "/api/customer-chat/session";
const messagesEndpoint = "/api/customer-chat/messages";

vi.mock("@/domain/analytics/client", () => analytics);

function updates(
  events: readonly unknown[] = [],
  cursor: string | null = "cursor-1",
  state = "pending",
  hasMore = false,
) {
  return new Response(JSON.stringify({ cursor, hasMore, events, state, permit: "test-permit" }), {
    headers: { "Content-Type": "application/json" },
  });
}

function accepted(messageKey = "a".repeat(64)) {
  return new Response(JSON.stringify({ status: "accepted", messageKey, permit: "test-permit" }), {
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
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(updates())));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() },
    });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/session");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/customer-chat/messages");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
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
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/customer-chat/session")).toHaveLength(1);

    acceptMessage?.(accepted());
    await act(async () => { await pendingResponse; });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/customer-chat/messages")).toHaveLength(1));
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.getAllByText("I'd like to get a quote.")).toHaveLength(1);
  });

  it("reconciles by the server message key despite timestamp skew and clears stale typing", async () => {
    const messageKey = "d".repeat(64);
    const persisted = {
      eventKey: "persisted-clock-skewed-message",
      messageKey,
      role: "customer",
      text: "Hi how much for roll up banner",
      createdAt: "2020-01-01T00:00:00.000Z",
      state: "pending",
    };
    const assistant = {
      eventKey: "assistant-after-clock-skewed-message",
      role: "assistant",
      text: "The roll-up banner price is ready.",
      createdAt: "2020-01-01T00:00:01.000Z",
      state: "committed_assistant",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted(messageKey))
      .mockResolvedValueOnce(updates([persisted, assistant], "cursor-2", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Hi how much for roll up banner" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.getAllByText("Hi how much for roll up banner")).toHaveLength(1);
    expect(screen.queryByText("R&R Gallery is typing…")).not.toBeInTheDocument();
  });

  it("keeps timestamp reconciliation for a persisted event without a message key", async () => {
    const message = "Please help with a canvas";
    const persisted = {
      eventKey: "persisted-legacy-message",
      role: "customer",
      text: message,
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      state: "pending",
    };
    const assistant = {
      eventKey: "assistant-after-legacy-message",
      role: "assistant",
      text: "We can help with your canvas.",
      createdAt: new Date(Date.now() + 2_000).toISOString(),
      state: "committed_assistant",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted("e".repeat(64)))
      .mockResolvedValueOnce(updates([persisted, assistant], "cursor-2", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: message } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.queryByText("R&R Gallery is typing…")).not.toBeInTheDocument();
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

  it("performs one cursor catch-up when the chat is reopened", async () => {
    const existing = {
      eventKey: "existing-customer-message",
      role: "customer",
      text: "I need a banner.",
      createdAt: "2026-08-28T00:00:00.000Z",
      state: "committed_assistant",
    };
    const staff = {
      eventKey: "staff-response",
      role: "staff",
      text: "We can help with that banner.",
      createdAt: "2026-08-28T00:01:00.000Z",
      state: "human_outbound",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([existing], "cursor-1", "committed_assistant"))
      .mockResolvedValueOnce(updates([staff], "cursor-2", "human_outbound"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    expect(await screen.findByText("I need a banner.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    openChat();

    expect(await screen.findByText("We can help with that banner.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/updates?cursor=cursor-1");
  });

  it("drains a later public-update page before showing its terminal reply", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      eventKey: `customer-${index + 1}`,
      role: "customer",
      text: `Earlier message ${index + 1}`,
      createdAt: `2026-08-28T00:${String(index).padStart(2, "0")}:00.000Z`,
      state: "committed_assistant",
    }));
    const terminalReply = {
      eventKey: "assistant-51",
      role: "assistant",
      text: "This reply was on the second page.",
      createdAt: "2026-08-28T01:00:00.000Z",
      state: "committed_assistant",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates(firstPage, "cursor-50", "committed_assistant", true))
      .mockResolvedValueOnce(updates([terminalReply], "cursor-51", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);

    openChat();

    expect(await screen.findByText("This reply was on the second page.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/updates?cursor=cursor-50");
  });

  it("shows a retryable history error when a later update page fails and retries from the last cursor", async () => {
    const firstPage = {
      eventKey: "customer-first-page",
      role: "customer",
      text: "First-page customer message.",
      createdAt: "2026-08-28T00:00:00.000Z",
      state: "committed_assistant",
    };
    const terminalReply = {
      eventKey: "assistant-retried-page",
      role: "assistant",
      text: "The retried page reply is visible.",
      createdAt: "2026-08-28T00:01:00.000Z",
      state: "committed_assistant",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([firstPage], "cursor-first", "committed_assistant", true))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(updates([terminalReply], "cursor-retried", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);

    openChat();

    expect(await screen.findByText("We couldn’t load your earlier messages. You can still start a new chat.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry conversation history" }));

    expect(await screen.findByText("The retried page reply is visible.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/customer-chat/updates",
      "/api/customer-chat/updates?cursor=cursor-first",
      "/api/customer-chat/updates?cursor=cursor-first",
    ]);
  });

  it("shows a retryable history error when a paginated response makes no cursor progress", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([], "cursor-stuck", "pending", true))
      .mockResolvedValueOnce(updates([], "cursor-stuck", "pending", true));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);

    openChat();

    expect(await screen.findByText("We couldn’t load your earlier messages. You can still start a new chat.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a retryable history error at the bounded page-drain limit and retries from the last cursor", async () => {
    let updateRequestCount = 0;
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() => {
      updateRequestCount += 1;
      if (updateRequestCount <= 24) {
        return Promise.resolve(updates([], `cursor-${updateRequestCount}`, "pending", true));
      }
      return Promise.resolve(updates([], "cursor-complete", "pending"));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);

    openChat();

    expect(await screen.findByText("We couldn’t load your earlier messages. You can still start a new chat.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(24);
    fireEvent.click(screen.getByRole("button", { name: "Retry conversation history" }));

    await waitFor(() => expect(screen.queryByText("We couldn’t load your earlier messages. You can still start a new chat.")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls[24]?.[0]).toBe("/api/customer-chat/updates?cursor=cursor-24");
  });

  it("does not announce page-two initial history as a new live message", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      eventKey: `history-customer-${index + 1}`,
      role: "customer",
      text: `Historical customer message ${index + 1}`,
      createdAt: `2026-08-28T00:${String(index).padStart(2, "0")}:00.000Z`,
      state: "committed_assistant",
    }));
    const historicalReply = {
      eventKey: "historical-assistant-page-two",
      role: "assistant",
      text: "Historical second-page assistant reply.",
      createdAt: "2026-08-28T01:00:00.000Z",
      state: "committed_assistant",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(updates(firstPage, "cursor-50", "committed_assistant", true))
      .mockResolvedValueOnce(updates([historicalReply], "cursor-51", "committed_assistant")));
    render(<CustomerChat />);

    openChat();

    expect(await screen.findByText("Historical second-page assistant reply.")).toBeInTheDocument();
    expect(screen.getByTestId("customer-chat-live-region")).toBeEmptyDOMElement();
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/customer-chat/messages");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it("keeps an unchanged network-failed draft retry-only and reuses its idempotency key on explicit retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValue(updates());
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
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    const firstPost = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    const retriedPost = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body));
    expect(retriedPost).toEqual(firstPost);
    expect(input).toHaveValue("");
  });

  it("sends an edited failed draft as a new message and clears only that accepted visible draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = screen.getByLabelText("Message R&R Gallery");
    await act(async () => {});

    fireEvent.change(input, { target: { value: "Original message" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Message not sent. Try again.");
    const failedPost = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));

    fireEvent.change(input, { target: { value: "Edited visible message" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    const editedPost = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body));
    expect(editedPost).toMatchObject({ message: "Edited visible message", pageContext: { pathname: "/" } });
    expect(editedPost.clientMessageKey).not.toBe(failedPost.clientMessageKey);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
  });

  it("renders a rate limit response without exposing server details or discarding the draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
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

  it("does not bootstrap or post when Web Locks are unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Please help" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Chat needs a supported browser. Please use our contact form instead.")).toHaveAttribute("aria-live", "polite");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === sessionEndpoint || url === messagesEndpoint)).toBe(false);
  });

  it("cancels a waiting lock when the customer closes the unsent chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: <T,>(_name: string, options: { signal?: AbortSignal }, _callback: () => Promise<T>) => new Promise<T>((_resolve, reject) => {
          void _callback;
          options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
      },
    });
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Please help" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === sessionEndpoint || url === messagesEndpoint)).toBe(false);
  });

  it("keeps the message local when bootstrap fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Please help" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Message not sent. Try again.")).toHaveAttribute("aria-live", "polite");
    expect(input).toHaveValue("Please help");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => url === messagesEndpoint)).toBe(false);
  });

  it("rebootstraps once after SESSION_REQUIRED and retries with the same message key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "SESSION_REQUIRED" } }), { status: 409 }))
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Please help" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === sessionEndpoint)).toHaveLength(2));
    const posts = fetchMock.mock.calls.filter(([url]) => url === messagesEndpoint);
    expect(posts).toHaveLength(2);
    expect(JSON.parse(String(posts[0]?.[1]?.body)).clientMessageKey)
      .toBe(JSON.parse(String(posts[1]?.[1]?.body)).clientMessageKey);
  });

  it("holds the FIFO lock across bootstrap and message POST for two first-send components", async () => {
    let releaseFirstMessage: ((response: Response) => void) | undefined;
    const firstMessage = new Promise<Response>((resolve) => { releaseFirstMessage = resolve; });
    let lockTail = Promise.resolve();
    const fifoLocks = {
      request: <T,>(_name: string, _options: unknown, callback: () => Promise<T>) => {
        const run = lockTail.then(callback, callback);
        lockTail = run.then(() => undefined, () => undefined);
        return run;
      },
    };
    Object.defineProperty(navigator, "locks", { configurable: true, value: fifoLocks });
    const trace: string[] = [];
    let sharedCookieJar = "";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === sessionEndpoint) {
        const key = JSON.parse(String(init?.body)).clientMessageKey as string;
        trace.push(`bootstrap:${key}`);
        if (!sharedCookieJar) sharedCookieJar = "server-issued-identity";
        return Promise.resolve(new Response(JSON.stringify({ status: "ready", permit: "test-permit" }), { headers: { "Content-Type": "application/json" } }));
      }
      if (url === messagesEndpoint) {
        const message = JSON.parse(String(init?.body)).message as string;
        trace.push(`message:${message}:${sharedCookieJar}`);
        return message === "First tab" ? firstMessage : Promise.resolve(accepted());
      }
      return Promise.resolve(updates());
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat pathname="/first" />);
    render(<CustomerChat pathname="/second" />);
    const launchers = screen.getAllByRole("button", { name: "Chat with R&R Gallery" });
    fireEvent.click(launchers[0]!);
    fireEvent.click(launchers[1]!);
    const inputs = await screen.findAllByLabelText("Message R&R Gallery");

    fireEvent.change(inputs[0]!, { target: { value: "First tab" } });
    fireEvent.keyDown(inputs[0]!, { key: "Enter" });
    fireEvent.change(inputs[1]!, { target: { value: "Second tab" } });
    fireEvent.keyDown(inputs[1]!, { key: "Enter" });
    await waitFor(() => expect(trace).toHaveLength(2));
    expect(trace[0]).toMatch(/^bootstrap:/);
    expect(trace[1]).toBe("message:First tab:server-issued-identity");

    releaseFirstMessage?.(accepted());
    await waitFor(() => expect(trace).toHaveLength(4));
    expect(trace[2]).toMatch(/^bootstrap:/);
    expect(trace[3]).toBe("message:Second tab:server-issued-identity");
    expect(trace.filter((entry) => entry.startsWith("message:"))).toHaveLength(2);
  });

  it("loads history once and does not poll while idle or on lifecycle events", async () => {
    vi.useFakeTimers();
    const first = {
      eventKey: "event-1",
      role: "customer",
      text: "First message",
      createdAt: "2026-08-22T00:00:00.000Z",
      state: "pending",
    };
    const fetchMock = vi.fn().mockResolvedValue(updates([first, first], "cursor-1"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    const input = screen.getByLabelText("Message R&R Gallery");
    await act(async () => {});
    fireEvent.change(input, { target: { value: "Unsent draft" } });

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    fireEvent.focus(window);
    fireEvent(window, new Event("online"));
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {});

    expect(screen.getAllByText("First message")).toHaveLength(1);
    expect(input).toHaveValue("Unsent draft");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("customer-chat-live-region")).toHaveAttribute("aria-live", "polite");
  });

  it("polls only after an accepted send and stops on a terminal assistant response", async () => {
    vi.useFakeTimers();
    const assistant = {
      eventKey: "assistant-response",
      role: "assistant",
      text: "Thanks for your message.",
      createdAt: "2026-08-22T00:00:01.000Z",
      state: "committed_assistant",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([], "cursor-1"))
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(updates([], "cursor-2", "pending"))
      .mockResolvedValueOnce(updates([assistant], "cursor-3", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    const input = screen.getByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Can you help?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(screen.getByText("Thanks for your message.")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stops a pending cycle after 24 checks instead of polling forever", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([], "cursor-1"))
      .mockResolvedValueOnce(accepted())
      .mockImplementation(() => Promise.resolve(updates([], "cursor-pending", "pending")));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    const input = screen.getByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Can you help?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    for (let index = 0; index < 23; index += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    }

    expect(fetchMock).toHaveBeenCalledTimes(27);
    expect(screen.getByText("Reply is taking longer than expected. Please reopen chat later to check for an update.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(27);
  });

  it("keeps a newer accepted send awaiting a reply when an older terminal catch-up resolves", async () => {
    vi.useFakeTimers();
    const terminalReply = {
      eventKey: "assistant-after-reopen",
      role: "assistant",
      text: "The reply after reopening is visible.",
      createdAt: "2026-08-22T00:05:00.000Z",
      state: "committed_assistant",
    };
    let resolveInitialUpdates: ((response: Response) => void) | undefined;
    const initialUpdates = new Promise<Response>((resolve) => { resolveInitialUpdates = resolve; });
    let updateRequestCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/customer-chat/session" || url === "/api/customer-chat/messages") return Promise.resolve(accepted());
      updateRequestCount += 1;
      if (updateRequestCount === 1) return initialUpdates;
      if (updateRequestCount === 2) return Promise.resolve(updates([], "cursor-reopen", "pending"));
      return Promise.resolve(updates([terminalReply], "cursor-terminal", "committed_assistant"));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});

    const input = screen.getByLabelText("Message R&R Gallery");
    fireEvent.change(input, { target: { value: "Can you help with a canvas?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    expect(updateRequestCount).toBe(1);

    await act(async () => { resolveInitialUpdates?.(updates([], "cursor-initial", "committed_assistant")); });
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    openChat();
    await act(async () => {});

    expect(updateRequestCount).toBe(2);
    expect(screen.queryByText("The reply after reopening is visible.")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText("The reply after reopening is visible.")).toBeInTheDocument();
    expect(updateRequestCount).toBe(3);
  });

  it("resumes a bounded pending cycle after reopening when the catch-up remains pending", async () => {
    vi.useFakeTimers();
    const terminalReply = {
      eventKey: "assistant-terminal",
      role: "assistant",
      text: "Your reply is ready now.",
      createdAt: "2026-08-22T00:05:00.000Z",
      state: "committed_assistant",
    };
    let updateRequests = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/customer-chat/session" || url === "/api/customer-chat/messages") return Promise.resolve(accepted());
      updateRequests += 1;
      if (updateRequests === 27) {
        return Promise.resolve(updates([terminalReply], "cursor-terminal", "committed_assistant"));
      }
      return Promise.resolve(updates([], `cursor-${updateRequests}`, "pending"));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    const input = screen.getByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "Can you help?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    for (let index = 0; index < 23; index += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    }
    expect(screen.getByText("Reply is taking longer than expected. Please reopen chat later to check for an update.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(27);

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    openChat();
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(28);
    expect(screen.queryByText("Your reply is ready now.")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(fetchMock).toHaveBeenCalledTimes(28);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("Your reply is ready now.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(29);
  });

  it("starts a fresh bounded cycle for a second accepted send without keeping the old timer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([], "cursor-1"))
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(updates([], "cursor-2", "pending"))
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(updates([], "cursor-3", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    const input = screen.getByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "First question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    fireEvent.change(input, { target: { value: "Second question" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not start customer-chat polling after Production automation navigates away from its query marker", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/?rnr_automation=1&rnr_automation_capability=DEFAULT");
    const fetchMock = vi.fn().mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);

    const firstPage = render(<CustomerChat />);
    firstPage.unmount();
    window.history.replaceState(null, "", "/shop");

    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(screen.getByLabelText("Message R&R Gallery")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops update polling as soon as the chat closes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["close", "unmount"] as const)("does not restart reply polling when an accepted send resolves after %s", async (disposition) => {
    vi.useFakeTimers();
    let acceptMessage: ((response: Response) => void) | undefined;
    const deferredMessage = new Promise<Response>((resolve) => { acceptMessage = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(accepted())
      .mockReturnValueOnce(deferredMessage);
    vi.stubGlobal("fetch", fetchMock);
    const page = render(<CustomerChat />);
    openChat();
    await act(async () => {});
    const input = screen.getByLabelText("Message R&R Gallery");
    fireEvent.change(input, { target: { value: "Please help" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);

    if (disposition === "close") fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    else page.unmount();
    await act(async () => { acceptMessage?.(accepted()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resumes a persisted deferred accepted send only after chat reopens", async () => {
    vi.useFakeTimers();
    const assistant = {
      eventKey: "assistant-after-reopen",
      role: "assistant",
      text: "Your reply is ready.",
      createdAt: "2026-09-01T00:00:05.000Z",
      state: "committed_assistant",
    };
    let acceptMessage: ((response: Response) => void) | undefined;
    const deferredMessage = new Promise<Response>((resolve) => { acceptMessage = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(updates([], "cursor-1", "committed_assistant"))
      .mockResolvedValueOnce(accepted())
      .mockReturnValueOnce(deferredMessage)
      .mockResolvedValueOnce(updates([], "cursor-2", "pending"))
      .mockResolvedValueOnce(updates([assistant], "cursor-3", "committed_assistant"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    const input = screen.getByLabelText("Message R&R Gallery");
    fireEvent.change(input, { target: { value: "Please help" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));

    await act(async () => { acceptMessage?.(accepted()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    openChat();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(screen.getByText("Your reply is ready.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("aborts an in-flight update request when the chat closes", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));

    expect(signal?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not catch up on focus, visibility, or network events", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(updates());
    vi.stubGlobal("fetch", fetchMock);
    render(<CustomerChat />);
    openChat();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    fireEvent.focus(window);
    fireEvent(window, new Event("online"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
