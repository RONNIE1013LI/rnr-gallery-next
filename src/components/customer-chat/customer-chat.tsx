"use client";

import { FaArrowUp, FaRegCommentDots } from "react-icons/fa";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { emitAnalyticsEvent } from "@/domain/analytics/client";
import { pollingAllowedForAutomation } from "@/lib/automation-mode";
import styles from "./customer-chat.module.css";
import { isNearBottom, scrollTranscriptToLatest } from "./follow-latest";

type PublicEvent = Readonly<{
  eventKey: string;
  messageKey?: string;
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
  messageKey?: string;
  status: "sending" | "accepted" | "failed";
}>;

type UpdatesResponse = Readonly<{
  cursor: string | null;
  hasMore: boolean;
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
const sessionEndpoint = "/api/customer-chat/session";
const messagesEndpoint = "/api/customer-chat/messages";
const pollingIntervalMs = 5_000;
const maximumPendingPolls = 24;
const maximumUpdatePages = 24;

type PollResult = "pending" | "terminal" | "error" | "blocked";

type CustomerChatLockManager = Readonly<{
  request: <T>(name: string, options: Readonly<{ mode: "exclusive"; signal?: AbortSignal }>, callback: () => Promise<T>) => Promise<T>;
}>;
function clientMessageKey() {
  const generated = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (generated) return generated;
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicUpdates(value: unknown): UpdatesResponse | null {
  if (!value || typeof value !== "object") return null;
  const response = value as { cursor?: unknown; hasMore?: unknown; events?: unknown; state?: unknown };
  if (response.cursor !== null && typeof response.cursor !== "string") return null;
  if (typeof response.hasMore !== "boolean") return null;
  if (!Array.isArray(response.events)) return null;
  if (typeof response.state !== "string") return null;
  const events = response.events.filter((event): event is PublicEvent => {
    if (!event || typeof event !== "object") return false;
    const candidate = event as Record<string, unknown>;
    return typeof candidate.eventKey === "string"
      && (candidate.messageKey === undefined
        || (typeof candidate.messageKey === "string" && /^[a-f0-9]{64}$/.test(candidate.messageKey)))
      && (candidate.role === "customer" || candidate.role === "assistant" || candidate.role === "staff")
      && typeof candidate.text === "string"
      && typeof candidate.createdAt === "string"
      && typeof candidate.state === "string";
  });
  return { cursor: response.cursor ?? null, hasMore: response.hasMore, events, state: response.state };
}

function reconcileOutgoing(
  outgoing: readonly OutgoingMessage[],
  incoming: readonly PublicEvent[],
) {
  const remaining = [...outgoing];
  for (const event of incoming) {
    if (event.role !== "customer") continue;
    const eventTime = Date.parse(event.createdAt);
    const keyedMatch = event.messageKey
      ? remaining.findIndex((message) => message.messageKey === event.messageKey)
      : -1;
    const match = keyedMatch >= 0 ? keyedMatch : remaining.findIndex((message) => (
      (!event.messageKey || !message.messageKey)
      && message.message === event.text
      && eventTime >= Date.parse(message.createdAt) - 5_000
    ));
    if (match >= 0) remaining.splice(match, 1);
  }
  return remaining.length === outgoing.length ? outgoing : remaining;
}

function messageLabel(role: PublicEvent["role"]) {
  if (role === "assistant") return "R&R Gallery";
  if (role === "staff") return "R&R Gallery team";
  return "You";
}

export function CustomerChat({
  pathname = "/",
  market = "NZ",
}: Readonly<{ pathname?: string; market?: "NZ" | "AU" }>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<readonly PublicEvent[]>([]);
  const [outgoingMessages, setOutgoingMessages] = useState<readonly OutgoingMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [newMessageAvailable, setNewMessageAvailable] = useState(false);
  const latestEvent = events.at(-1);
  const assistantPending = outgoingMessages.some((message) => message.status !== "failed")
    || (latestEvent?.role === "customer" && (latestEvent.state === "pending" || latestEvent.state === "recovery"));
  const cursorRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const activePollControllerRef = useRef<AbortController | null>(null);
  const pendingPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPollCycleRef = useRef(0);
  const sendingRef = useRef(false);
  const mountedRef = useRef(false);
  const openRef = useRef(false);
  const lockWaitAbortControllerRef = useRef<AbortController | null>(null);
  const lockGrantedRef = useRef(false);
  const awaitingReplyRef = useRef(false);
  const awaitingReplyGenerationRef = useRef(0);
  const initialPollRef = useRef(true);
  const historyReadyRef = useRef(false);
  const restoreLauncherFocusRef = useRef(false);
  const isComposingRef = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const readingHistoryRef = useRef(false);
  const programmaticScrollRef = useRef<{ lastScrollTop: number } | null>(null);
  const positionedTranscriptRef = useRef(false);
  const lastNonCustomerEventKeyRef = useRef<string | null>(null);
  const transcriptFrameRef = useRef<number | null>(null);

  const scrollToLatest = useCallback((requestedBehavior: ScrollBehavior = "smooth") => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (transcriptFrameRef.current !== null) {
      cancelAnimationFrame(transcriptFrameRef.current);
    }
    let completedSynchronously = false;
    const frame = requestAnimationFrame(() => {
      completedSynchronously = true;
      transcriptFrameRef.current = null;
      const reducedMotion = typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      programmaticScrollRef.current = { lastScrollTop: transcript.scrollTop };
      scrollTranscriptToLatest(transcript, reducedMotion ? "auto" : requestedBehavior);
      const programmaticScroll = programmaticScrollRef.current;
      if (programmaticScroll) {
        programmaticScroll.lastScrollTop = transcript.scrollTop;
        if (isNearBottom(transcript)) programmaticScrollRef.current = null;
      }
    });
    if (!completedSynchronously) transcriptFrameRef.current = frame;
  }, []);

  function currentlyTrackable() {
    return mountedRef.current && openRef.current && pollingAllowedForAutomation("customer-chat");
  }

  const poll = useCallback(async (): Promise<PollResult> => {
    if (!pollingAllowedForAutomation("customer-chat")) return "blocked";
    if (pollingRef.current) return "pending";
    pollingRef.current = true;
    const awaitingReplyGeneration = awaitingReplyGenerationRef.current;
    const initialCatchUp = initialPollRef.current;
    const controller = new AbortController();
    activePollControllerRef.current = controller;
    const showHistoryError = () => {
      historyReadyRef.current = true;
      setHistoryReady(true);
      setHistoryError(true);
    };
    try {
      for (let page = 0; page < maximumUpdatePages; page += 1) {
        const previousCursor = cursorRef.current;
        const query = previousCursor ? `?cursor=${encodeURIComponent(previousCursor)}` : "";
        const response = await fetch(`${updatesEndpoint}${query}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const updates = response.ok
          ? publicUpdates(await response.json().catch(() => null))
          : null;
        if (!updates) {
          showHistoryError();
          return "error";
        }
        historyReadyRef.current = true;
        setHistoryReady(true);
        setOutgoingMessages((current) => reconcileOutgoing(current, updates.events));
        setEvents((current) => {
          const known = new Set(current.map((event) => event.eventKey));
          const added = updates.events.filter((event) => {
            if (known.has(event.eventKey)) return false;
            known.add(event.eventKey);
            return true;
          });
          if (!initialCatchUp && added.some((event) => event.role !== "customer")) {
            setAnnouncement("New message from R&R Gallery.");
          }
          return added.length ? [...current, ...added] : current;
        });
        if (updates.hasMore && (updates.cursor === null || updates.cursor === previousCursor)) {
          showHistoryError();
          return "error";
        }
        cursorRef.current = updates.cursor;
        if (updates.hasMore) continue;
        initialPollRef.current = false;
        setHistoryError(false);
        const result = updates.state === "pending" || updates.state === "recovery"
          ? "pending"
          : "terminal";
        if (result === "terminal" && awaitingReplyGeneration === awaitingReplyGenerationRef.current) {
          awaitingReplyRef.current = false;
        }
        return result;
      }

      showHistoryError();
      return "error";
    } catch {
      if (controller.signal.aborted) return "blocked";
      showHistoryError();
      return "error";
    } finally {
      if (activePollControllerRef.current === controller) {
        activePollControllerRef.current = null;
        pollingRef.current = false;
      }
    }
  }, []);

  const stopPendingPolling = useCallback(() => {
    pendingPollCycleRef.current += 1;
    if (pendingPollTimerRef.current !== null) {
      clearTimeout(pendingPollTimerRef.current);
      pendingPollTimerRef.current = null;
    }
  }, []);

  const startPendingPolling = useCallback((pendingCheckAlreadyConsumed = false) => {
    if (!currentlyTrackable()) return;
    stopPendingPolling();
    const cycle = pendingPollCycleRef.current;
    let checks = pendingCheckAlreadyConsumed ? 1 : 0;
    const scheduleNextCheck = () => {
      pendingPollTimerRef.current = setTimeout(() => {
        pendingPollTimerRef.current = null;
        if (!currentlyTrackable()) return;
        void check();
      }, pollingIntervalMs);
    };
    const check = async () => {
      if (!currentlyTrackable()) return;
      if (cycle !== pendingPollCycleRef.current) return;
      checks += 1;
      const result = await poll();
      if (!currentlyTrackable()) return;
      if (cycle !== pendingPollCycleRef.current) return;
      if (result === "terminal" || result === "blocked") return;
      if (result === "error") {
        setFeedback("We couldn’t check for a reply. Please reopen chat later to try again.");
        return;
      }
      if (checks >= maximumPendingPolls) {
        setFeedback("Reply is taking longer than expected. Please reopen chat later to check for an update.");
        return;
      }
      scheduleNextCheck();
    };
    if (pendingCheckAlreadyConsumed) scheduleNextCheck();
    else void check();
  }, [poll, stopPendingPolling]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRef.current = false;
      if (transcriptFrameRef.current !== null) {
        cancelAnimationFrame(transcriptFrameRef.current);
        transcriptFrameRef.current = null;
      }
      programmaticScrollRef.current = null;
      if (!lockGrantedRef.current) lockWaitAbortControllerRef.current?.abort();
    };
  }, []);

  function close() {
    if (!lockGrantedRef.current) lockWaitAbortControllerRef.current?.abort();
    openRef.current = false;
    if (transcriptFrameRef.current !== null) {
      cancelAnimationFrame(transcriptFrameRef.current);
      transcriptFrameRef.current = null;
    }
    programmaticScrollRef.current = null;
    restoreLauncherFocusRef.current = true;
    setOpen(false);
  }

  useEffect(() => {
    openRef.current = open;
    const pollingAllowed = pollingAllowedForAutomation("customer-chat");
    if (!open) return;
    inputRef.current?.focus();
    if (!pollingAllowed) return;
    const resumePendingReply = awaitingReplyRef.current;
    queueMicrotask(() => void poll().then((result) => {
      if (resumePendingReply && result === "pending" && awaitingReplyRef.current) {
        setFeedback("");
        startPendingPolling(true);
      }
    }));
    return () => {
      openRef.current = false;
      stopPendingPolling();
      const controller = activePollControllerRef.current;
      activePollControllerRef.current = null;
      pollingRef.current = false;
      controller?.abort();
    };
  }, [open, poll, startPendingPolling, stopPendingPolling]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const hasVisibleContent = events.length > 0 || outgoingMessages.length > 0 || assistantPending;
    if (!hasVisibleContent) return;
    const latestNonCustomerEvent = [...events].reverse().find((event) => event.role !== "customer") ?? null;
    const receivedNewNonCustomer = latestNonCustomerEvent !== null
      && latestNonCustomerEvent.eventKey !== lastNonCustomerEventKeyRef.current;

    if (followLatestRef.current && !readingHistoryRef.current) {
      setNewMessageAvailable(false);
      scrollToLatest(positionedTranscriptRef.current ? "smooth" : "auto");
      positionedTranscriptRef.current = true;
    } else if (receivedNewNonCustomer && !initialPollRef.current) {
      setNewMessageAvailable(true);
    }
    lastNonCustomerEventKeyRef.current = latestNonCustomerEvent?.eventKey ?? null;
  }, [assistantPending, events, open, outgoingMessages, scrollToLatest]);

  useEffect(() => {
    if (!open || typeof ResizeObserver !== "function") return;
    const transcriptContent = transcriptContentRef.current;
    if (!transcriptContent) return;
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current && positionedTranscriptRef.current) {
        scrollToLatest("auto");
      }
    });
    observer.observe(transcriptContent);
    return () => observer.disconnect();
  }, [open, scrollToLatest]);

  useEffect(() => {
    if (!open && restoreLauncherFocusRef.current) {
      launcherRef.current?.focus();
      restoreLauncherFocusRef.current = false;
    }
  }, [open]);

  async function sendMessage(current: PendingMessage) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    followLatestRef.current = true;
    readingHistoryRef.current = false;
    setNewMessageAvailable(false);
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
      const locks = (navigator as Navigator & { locks?: CustomerChatLockManager }).locks;
      if (!locks) {
        setPendingMessage(current);
        if (current.restoreDraftOnFailure) setDraft(current.message);
        setOutgoingMessages((messages) => messages.map((message) => message.clientMessageKey === current.clientMessageKey
          ? { ...message, status: "failed" }
          : message));
        setFeedback("Chat needs a supported browser. Please use our contact form instead.");
        return;
      }
      const lockWaitController = new AbortController();
      lockWaitAbortControllerRef.current = lockWaitController;
      const response = await locks.request("rnr-customer-chat-session-v1", { mode: "exclusive", signal: lockWaitController.signal }, async () => {
        lockGrantedRef.current = true;
        if (lockWaitAbortControllerRef.current === lockWaitController) lockWaitAbortControllerRef.current = null;
        const bootstrap = async () => {
          const session = await fetch(sessionEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ version: 1, clientMessageKey: current.clientMessageKey }),
          });
          if (!session.ok) return null;
          const body = await session.json().catch(() => null) as { permit?: unknown } | null;
          return typeof body?.permit === "string" && body.permit.length <= 256 ? body.permit : null;
        };
        const post = (permit: string) => fetch(messagesEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-RNR-Customer-Chat-Permit": permit },
          body: JSON.stringify({
            clientMessageKey: current.clientMessageKey,
            message: current.message,
            pageContext: { pathname, market },
          }),
        });
        const firstPermit = await bootstrap();
        if (!firstPermit) return null;
        const firstResponse = await post(firstPermit);
        if (firstResponse.status !== 409) return firstResponse;
        const retryPermit = await bootstrap();
        return retryPermit ? post(retryPermit) : null;
      });
      if (!response) {
        setPendingMessage(current);
        if (current.restoreDraftOnFailure) setDraft(current.message);
        setOutgoingMessages((messages) => messages.map((message) => message.clientMessageKey === current.clientMessageKey
          ? { ...message, status: "failed" }
          : message));
        setFeedback("Message not sent. Try again.");
        return;
      }
      if (response.ok) {
        const acceptedBody = await response.json().catch(() => null) as { messageKey?: unknown } | null;
        const messageKey = typeof acceptedBody?.messageKey === "string"
          && /^[a-f0-9]{64}$/.test(acceptedBody.messageKey)
          ? acceptedBody.messageKey
          : undefined;
        awaitingReplyGenerationRef.current += 1;
        awaitingReplyRef.current = true;
        if (mountedRef.current) {
          setDraft("");
          setPendingMessage(null);
          setOutgoingMessages((messages) => messages.map((message) => (
            message.clientMessageKey === current.clientMessageKey
              ? { ...message, status: "accepted", ...(messageKey ? { messageKey } : {}) }
              : message
          )));
          setFeedback("Message sent.");
        }
        if (currentlyTrackable()) startPendingPolling();
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
      lockGrantedRef.current = false;
      lockWaitAbortControllerRef.current = null;
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

  return (
    <div className={`${styles.root} customer-chat-root`} data-open={open}>
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
          <div className={styles.transcriptShell}>
            <div
              ref={transcriptRef}
              className={styles.transcript}
              aria-label="Chat messages"
              onScroll={(event) => {
                const programmaticScroll = programmaticScrollRef.current;
                if (programmaticScroll) {
                  if (isNearBottom(event.currentTarget)) {
                    programmaticScrollRef.current = null;
                    followLatestRef.current = true;
                    readingHistoryRef.current = false;
                    setNewMessageAvailable(false);
                  } else if (event.currentTarget.scrollTop >= programmaticScroll.lastScrollTop) {
                    programmaticScroll.lastScrollTop = event.currentTarget.scrollTop;
                  } else {
                    programmaticScrollRef.current = null;
                  }
                  if (programmaticScrollRef.current) return;
                }
                const following = isNearBottom(event.currentTarget);
                followLatestRef.current = following;
                readingHistoryRef.current = !following;
                if (following) setNewMessageAvailable(false);
              }}
              onWheel={() => { programmaticScrollRef.current = null; }}
              onPointerDown={() => { programmaticScrollRef.current = null; }}
              onTouchStart={() => { programmaticScrollRef.current = null; }}
            >
              <div
                ref={transcriptContentRef}
                className={styles.transcriptContent}
                data-chat-transcript-content
              >
                {historyError ? <div className={styles.historyError} role="status">
                  <p>We couldn’t load your earlier messages. You can still start a new chat.</p>
                  <button type="button" onClick={() => void poll()}>Retry conversation history</button>
                </div> : null}
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
                <div aria-hidden="true" />
              </div>
            </div>
            {newMessageAvailable ? <button
              type="button"
              className={styles.newMessageButton}
              onClick={() => {
                followLatestRef.current = true;
                readingHistoryRef.current = false;
                setNewMessageAvailable(false);
                scrollToLatest("smooth");
              }}
            >New message</button> : null}
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
      {!open ? <button ref={launcherRef} type="button" className={styles.launcher} aria-label="Chat with R&R Gallery" title="Chat with R&R Gallery" onClick={() => {
        initialPollRef.current = events.length === 0;
        followLatestRef.current = true;
        readingHistoryRef.current = false;
        positionedTranscriptRef.current = false;
        setNewMessageAvailable(false);
        setOpen(true);
      }}>
        <FaRegCommentDots aria-hidden="true" />
      </button> : null}
    </div>
  );
}
