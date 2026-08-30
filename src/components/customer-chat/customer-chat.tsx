"use client";

import { FaArrowUp, FaRegCommentDots } from "react-icons/fa";
import { useCallback, useEffect, useRef, useState } from "react";

import { emitAnalyticsEvent } from "@/domain/analytics/client";
import styles from "./customer-chat.module.css";

type PublicEvent = Readonly<{
  eventKey: string;
  role: "customer" | "assistant" | "staff";
  text: string;
  createdAt: string;
  state: string;
}>;

type PendingMessage = Readonly<{
  clientMessageKey: string;
  message: string;
  restoreDraftOnFailure?: boolean;
}>;

type OutgoingMessage = PendingMessage & Readonly<{
  createdAt: string;
  status: "sending" | "accepted" | "failed";
}>;

type UpdatesResponse = Readonly<{
  cursor: string | null;
  events: readonly PublicEvent[];
  state: string;
}>;

const QUICK_ACTIONS = Object.freeze([
  { id: "quote", label: "Get a Quote", message: "I'd like to get a quote." },
  { id: "product_pricing", label: "Product & Pricing", message: "I'd like to know about your products and pricing." },
  { id: "design_help", label: "Design Help", message: "I need help with a design." },
  { id: "order_help", label: "Order Help", message: "I need help with an existing order." },
] as const);

const updatesEndpoint = "/api/customer-chat/updates";
const messagesEndpoint = "/api/customer-chat/messages";

function clientMessageKey() {
  const generated = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (generated) return generated;
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicUpdates(value: unknown): UpdatesResponse | null {
  if (!value || typeof value !== "object") return null;
  const response = value as { cursor?: unknown; events?: unknown; state?: unknown };
  if (response.cursor !== null && typeof response.cursor !== "string") return null;
  if (!Array.isArray(response.events)) return null;
  if (typeof response.state !== "string") return null;
  const events = response.events.filter((event): event is PublicEvent => {
    if (!event || typeof event !== "object") return false;
    const candidate = event as Record<string, unknown>;
    return typeof candidate.eventKey === "string"
      && (candidate.role === "customer" || candidate.role === "assistant" || candidate.role === "staff")
      && typeof candidate.text === "string"
      && typeof candidate.createdAt === "string"
      && typeof candidate.state === "string";
  });
  return { cursor: response.cursor ?? null, events, state: response.state };
}

function reconcileOutgoing(
  outgoing: readonly OutgoingMessage[],
  incoming: readonly PublicEvent[],
) {
  const remaining = [...outgoing];
  for (const event of incoming) {
    if (event.role !== "customer") continue;
    const eventTime = Date.parse(event.createdAt);
    const match = remaining.findIndex((message) => message.message === event.text
      && eventTime >= Date.parse(message.createdAt) - 5_000);
    if (match >= 0) remaining.splice(match, 1);
  }
  return remaining.length === outgoing.length ? outgoing : remaining;
}

function messageLabel(role: PublicEvent["role"]) {
  if (role === "assistant") return "R&R Gallery";
  if (role === "staff") return "R&R Gallery team";
  return "You";
}

export function CustomerChat({ pathname = "/" }: Readonly<{ pathname?: string }>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<readonly PublicEvent[]>([]);
  const [outgoingMessages, setOutgoingMessages] = useState<readonly OutgoingMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const cursorRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const sendingRef = useRef(false);
  const initialPollRef = useRef(true);
  const restoreLauncherFocusRef = useRef(false);
  const isComposingRef = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const poll = useCallback(async () => {
    if (document.hidden || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const query = cursorRef.current ? `?cursor=${encodeURIComponent(cursorRef.current)}` : "";
      const response = await fetch(`${updatesEndpoint}${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const updates = publicUpdates(await response.json().catch(() => null));
      if (!updates) return;
      cursorRef.current = updates.cursor;
      setHistoryReady(true);
      setOutgoingMessages((current) => reconcileOutgoing(current, updates.events));
      setEvents((current) => {
        const known = new Set(current.map((event) => event.eventKey));
        const added = updates.events.filter((event) => {
          if (known.has(event.eventKey)) return false;
          known.add(event.eventKey);
          return true;
        });
        if (!initialPollRef.current && added.some((event) => event.role !== "customer")) {
          setAnnouncement("New message from R&R Gallery.");
        }
        return added.length ? [...current, ...added] : current;
      });
      initialPollRef.current = false;
    } catch {
      // The current draft and cursor remain in the browser for the next catch-up poll.
    } finally {
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const catchUp = () => void poll();
    queueMicrotask(catchUp);
    const interval = window.setInterval(catchUp, 2_500);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [open, poll]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!open && restoreLauncherFocusRef.current) {
      launcherRef.current?.focus();
      restoreLauncherFocusRef.current = false;
    }
  }, [open]);

  function close() {
    restoreLauncherFocusRef.current = true;
    setOpen(false);
  }

  async function sendMessage(current: PendingMessage) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFeedback("");
    setOutgoingMessages((messages) => {
      const existing = messages.findIndex((message) => message.clientMessageKey === current.clientMessageKey);
      if (existing < 0) {
        return [...messages, { ...current, createdAt: new Date().toISOString(), status: "sending" }];
      }
      return messages.map((message, index) => index === existing
        ? { ...message, status: "sending" }
        : message);
    });
    try {
      const response = await fetch(messagesEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          clientMessageKey: current.clientMessageKey,
          message: current.message,
          pageContext: { pathname },
        }),
      });
      if (response.ok) {
        setDraft("");
        setPendingMessage(null);
        setOutgoingMessages((messages) => messages.map((message) => (
          message.clientMessageKey === current.clientMessageKey
            ? { ...message, status: "accepted" }
            : message
        )));
        setFeedback("Message sent.");
        void poll();
        return;
      }
      if (response.status === 429) {
        setPendingMessage(null);
        if (current.restoreDraftOnFailure) setDraft(current.message);
        setOutgoingMessages((messages) => messages.map((message) => (
          message.clientMessageKey === current.clientMessageKey
            ? { ...message, status: "failed" }
            : message
        )));
        setFeedback("Please wait a moment before sending another message.");
        return;
      }
      setPendingMessage(current);
      if (current.restoreDraftOnFailure) setDraft(current.message);
      setOutgoingMessages((messages) => messages.map((message) => (
        message.clientMessageKey === current.clientMessageKey
          ? { ...message, status: "failed" }
          : message
      )));
      setFeedback("Message not sent. Try again.");
    } catch {
      setPendingMessage(current);
      if (current.restoreDraftOnFailure) setDraft(current.message);
      setOutgoingMessages((messages) => messages.map((message) => (
        message.clientMessageKey === current.clientMessageKey
          ? { ...message, status: "failed" }
          : message
      )));
      setFeedback("Message not sent. Try again.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function submitDraft() {
    const message = draft.trim();
    if (!message || sending) return;
    if (pendingMessage?.message === message) {
      setFeedback("Use Retry message to resend the unchanged message.");
      return;
    }
    void sendMessage({ clientMessageKey: clientMessageKey(), message });
  }

  function startQuickAction(action: (typeof QUICK_ACTIONS)[number]) {
    if (sendingRef.current) return;
    try {
      emitAnalyticsEvent({
        event: "chat_quick_action_clicked",
        intent: action.id,
        source: "chat_welcome",
      });
    } catch {
      // Analytics must never interrupt the customer message pipeline.
    }
    void sendMessage({
      clientMessageKey: clientMessageKey(),
      message: action.message,
      restoreDraftOnFailure: true,
    });
  }

  const retryMessage = pendingMessage && pendingMessage.message === draft.trim()
    ? pendingMessage
    : null;
  const hasMessages = events.length > 0 || outgoingMessages.length > 0;
  const showWelcome = historyReady && !hasMessages;
  const latestEvent = events.at(-1);
  const assistantPending = outgoingMessages.some((message) => message.status !== "failed")
    || (latestEvent?.role === "customer" && (latestEvent.state === "pending" || latestEvent.state === "recovery"));

  return (
    <div className={styles.root}>
      {open ? (
        <section
          className={styles.panel}
          role="dialog"
          aria-label="Chat with R&R Gallery"
          aria-describedby="customer-chat-status"
          style={{
            "--customer-chat-panel-width": "min(380px, calc(100vw - 24px))",
            "--customer-chat-panel-max-height": "min(620px, calc(100dvh - 96px))",
          } as React.CSSProperties}
        >
          <header className={styles.header}>
            <div><strong>R&R Gallery</strong><span>Chat with our team</span></div>
            <button type="button" className={styles.closeButton} aria-label="Close chat" title="Close chat" onClick={close}>×</button>
          </header>
          <div className={styles.transcript} aria-label="Chat messages">
            {showWelcome ? <section className={styles.welcome} aria-labelledby="customer-chat-welcome-title">
              <h2 id="customer-chat-welcome-title">Hi 👋 How can we help?</h2>
              <p>Choose an option below or simply type your message.</p>
              <div className={styles.quickActions} aria-label="Quick chat options">
                {QUICK_ACTIONS.map((action) => <button
                  key={action.id}
                  type="button"
                  className={styles.quickAction}
                  disabled={sending}
                  onClick={() => startQuickAction(action)}
                >{action.label}</button>)}
              </div>
            </section> : null}
            {events.map((event) => <div className={styles.message} data-role={event.role} key={event.eventKey}>
              <span>{messageLabel(event.role)}</span><p>{event.text}</p>
            </div>)}
            {outgoingMessages.map((message) => <div
              className={styles.message}
              data-role="customer"
              data-state={message.status}
              key={message.clientMessageKey}
            ><span>You</span><p>{message.message}</p></div>)}
            {assistantPending ? <div className={styles.typing} role="status">R&amp;R Gallery is typing…</div> : null}
          </div>
          <p id="customer-chat-status" className={styles.status} aria-live="polite">{feedback}</p>
          <form className={styles.composer} onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}>
            <label className={styles.composerLabel}>
              <span>Message R&R Gallery</span>
              <textarea
                ref={inputRef}
                value={draft}
                rows={3}
                maxLength={2_000}
                placeholder="Type your message..."
                disabled={sending}
                onChange={(event) => setDraft(event.target.value)}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                    && !event.shiftKey
                    && !event.nativeEvent.isComposing
                    && !isComposingRef.current
                  ) {
                    event.preventDefault();
                    submitDraft();
                  }
                }}
              />
            </label>
            <button type="submit" className={styles.sendButton} aria-label="Send message" title="Send message" disabled={sending || !draft.trim() || retryMessage !== null}><FaArrowUp aria-hidden="true" /></button>
          </form>
          {retryMessage ? <button type="button" className={styles.retryButton} onClick={() => void sendMessage(retryMessage)} disabled={sending}>Retry message</button> : null}
          <div className={styles.liveRegion} data-testid="customer-chat-live-region" aria-live="polite" aria-atomic="true">{announcement}</div>
        </section>
      ) : null}
      <button ref={launcherRef} type="button" className={styles.launcher} aria-label="Chat with R&R Gallery" title="Chat with R&R Gallery" onClick={() => {
        initialPollRef.current = events.length === 0;
        setOpen(true);
      }}>
        <FaRegCommentDots aria-hidden="true" />
      </button>
    </div>
  );
}
