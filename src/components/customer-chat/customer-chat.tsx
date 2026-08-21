"use client";

import { FaArrowUp, FaRegCommentDots } from "react-icons/fa";
import { useCallback, useEffect, useRef, useState } from "react";

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
}>;

type UpdatesResponse = Readonly<{
  cursor: string | null;
  events: readonly PublicEvent[];
}>;

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
  const response = value as { cursor?: unknown; events?: unknown };
  if (response.cursor !== null && typeof response.cursor !== "string") return null;
  if (!Array.isArray(response.events)) return null;
  const events = response.events.filter((event): event is PublicEvent => {
    if (!event || typeof event !== "object") return false;
    const candidate = event as Record<string, unknown>;
    return typeof candidate.eventKey === "string"
      && (candidate.role === "customer" || candidate.role === "assistant" || candidate.role === "staff")
      && typeof candidate.text === "string"
      && typeof candidate.createdAt === "string"
      && typeof candidate.state === "string";
  });
  return { cursor: response.cursor ?? null, events };
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
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const cursorRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const initialPollRef = useRef(true);
  const restoreLauncherFocusRef = useRef(false);
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
    void poll();
    const catchUp = () => void poll();
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

  async function send(message = draft.trim(), retry = pendingMessage) {
    if (!message || sending) return;
    const current = retry ?? { clientMessageKey: clientMessageKey(), message };
    setSending(true);
    setFeedback("");
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
        setFeedback("Message sent.");
        void poll();
        return;
      }
      if (response.status === 429) {
        setPendingMessage(null);
        setFeedback("Please wait a moment before sending another message.");
        return;
      }
      setPendingMessage(current);
      setFeedback("Message not sent. Try again.");
    } catch {
      setPendingMessage(current);
      setFeedback("Message not sent. Try again.");
    } finally {
      setSending(false);
    }
  }

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
            {events.map((event) => <div className={styles.message} data-role={event.role} key={event.eventKey}>
              <span>{messageLabel(event.role)}</span><p>{event.text}</p>
            </div>)}
          </div>
          <p id="customer-chat-status" className={styles.status} aria-live="polite">{feedback}</p>
          <form className={styles.composer} onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}>
            <label className={styles.composerLabel}>
              <span>Message R&R Gallery</span>
              <textarea
                ref={inputRef}
                value={draft}
                rows={3}
                maxLength={2_000}
                disabled={sending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
            </label>
            <button type="submit" className={styles.sendButton} aria-label="Send message" title="Send message" disabled={sending || !draft.trim()}><FaArrowUp aria-hidden="true" /></button>
          </form>
          {pendingMessage ? <button type="button" className={styles.retryButton} onClick={() => void send(pendingMessage.message, pendingMessage)} disabled={sending}>Retry message</button> : null}
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
