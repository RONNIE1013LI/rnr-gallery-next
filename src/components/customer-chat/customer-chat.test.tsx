import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerChat } from "./customer-chat";

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
    const launcher = openChat();

    expect(await screen.findByRole("dialog", { name: "Chat with R&R Gallery" })).toHaveStyle({
      "--customer-chat-panel-width": "min(380px, calc(100vw - 24px))",
      "--customer-chat-panel-max-height": "min(620px, calc(100dvh - 96px))",
    });
    expect(screen.getByLabelText("Message R&R Gallery")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(launcher).toHaveFocus();
  });

  it("sends on Enter and lets Shift+Enter keep the multiline draft", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<CustomerChat />);
    openChat();
    const input = await screen.findByLabelText("Message R&R Gallery");

    fireEvent.change(input, { target: { value: "First line" } });
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("First line");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customer-chat/messages");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      clientMessageKey: expect.stringMatching(/^[A-Za-z0-9_-]{22,64}$/),
      message: "First line",
      pageContext: { pathname: "/" },
    });
  });

  it("keeps a network-failed draft and retries with the same idempotency key", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const firstPost = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const retriedPost = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(retriedPost).toEqual(firstPost);
    expect(input).toHaveValue("");
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
