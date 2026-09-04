import type { MetaContextProvider, MetaConversationLocator } from "./context-provider";
import type { MetaConversationSnapshot, MetaHistoryEvent } from "./types";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const GRAPH_ORIGIN = "https://graph.facebook.com";
const MAX_TURNS = 500;
const MAX_CHARACTERS = 60_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function nextPage(value: unknown) {
  const next = record(record(value)?.paging)?.next;
  if (typeof next !== "string" || !next.trim()) return null;
  try {
    const url = new URL(next);
    return url.origin === GRAPH_ORIGIN && url.protocol === "https:" ? url.toString() : "invalid";
  } catch {
    return "invalid";
  }
}

function pageMessages(body: unknown, first: boolean) {
  const root = record(body);
  if (!root) return null;
  if (!first) return root;
  const conversation = record(array(root.data)[0]);
  return record(conversation?.messages);
}

function historyEvent(raw: unknown, locator: MetaConversationLocator): MetaHistoryEvent | null {
  const message = record(raw);
  const from = record(message?.from);
  const id = typeof message?.id === "string" ? message.id.trim() : "";
  const senderId = typeof from?.id === "string" ? from.id.trim() : "";
  const text = typeof message?.message === "string" && message.message.trim() ? message.message.trim() : null;
  const timestamp = typeof message?.created_time === "string" ? Date.parse(message.created_time) : Number.NaN;
  if (!id || !senderId || !Number.isFinite(timestamp)) return null;
  const role = senderId === locator.pageId ? "staff" as const : "customer" as const;
  const attachmentData = array(record(message?.attachments)?.data);
  const attachments = attachmentData.map((entry, ordinal) => {
    const attachment = record(entry);
    const mime = typeof attachment?.mime_type === "string" ? attachment.mime_type : "";
    return Object.freeze({ ordinal, kind: mime.startsWith("image/") ? "image" as const : "unsupported" as const });
  });
  const replyTo = record(message?.reply_to);
  return Object.freeze({
    channel: locator.channel,
    role,
    eventType: role === "staff" ? "human_outbound" : "customer_message",
    externalConversationKey: locator.externalConversationKey,
    externalMessageKey: id,
    externalReplyToMessageKey: typeof replyTo?.id === "string" ? replyTo.id.trim() || null : null,
    text,
    attachments: Object.freeze(attachments),
    receivedAt: new Date(timestamp),
  });
}

export class GraphMetaContextProvider implements MetaContextProvider {
  private readonly accessToken: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutSignal: (milliseconds: number) => AbortSignal;

  constructor({
    accessToken,
    fetchImpl = fetch,
    timeoutSignal = AbortSignal.timeout,
  }: Readonly<{
    accessToken: string;
    fetchImpl?: FetchImplementation;
    timeoutSignal?: (milliseconds: number) => AbortSignal;
  }>) {
    this.accessToken = accessToken.trim();
    this.fetchImpl = fetchImpl;
    this.timeoutSignal = timeoutSignal;
  }

  async loadConversation(locator: MetaConversationLocator): Promise<MetaConversationSnapshot> {
    if (!this.accessToken || !locator.pageId.trim() || !locator.externalConversationKey.trim()) {
      return this.incomplete(locator, [], "provider_unavailable");
    }
    const fields = "messages.limit(100){id,created_time,from,message,reply_to,attachments{id,mime_type}}";
    let url: string | null = `${GRAPH_ORIGIN}/v23.0/${encodeURIComponent(locator.pageId)}/conversations?user_id=${encodeURIComponent(locator.externalConversationKey)}&fields=${encodeURIComponent(fields)}`;
    const events: MetaHistoryEvent[] = [];
    const seen = new Set<string>();
    let first = true;
    let ceilingReached = false;

    while (url) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { authorization: `Bearer ${this.accessToken}` },
          signal: this.timeoutSignal(10_000),
        });
      } catch {
        return this.incomplete(locator, events, "provider_unavailable");
      }
      if (!response.ok) {
        return this.incomplete(locator, events, response.status === 401 || response.status === 403
          ? "provider_permission"
          : "provider_unavailable");
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return this.incomplete(locator, events, "provider_unavailable");
      }
      const messages = pageMessages(body, first);
      if (!messages) return this.incomplete(locator, events, "pagination_gap");
      for (const raw of array(messages.data)) {
        const event = historyEvent(raw, locator);
        if (!event || seen.has(event.externalMessageKey)) continue;
        seen.add(event.externalMessageKey);
        if (events.length >= MAX_TURNS) {
          ceilingReached = true;
          break;
        }
        events.push(event);
      }
      if (ceilingReached) break;
      const next = nextPage(messages);
      if (next === "invalid") return this.incomplete(locator, events, "pagination_gap");
      url = next;
      first = false;
    }

    const sorted = events.sort((left, right) => (
      left.receivedAt.getTime() - right.receivedAt.getTime()
      || left.externalMessageKey.localeCompare(right.externalMessageKey)
    ));
    let characters = sorted.reduce((total, event) => total + (event.text?.length ?? 0), 0);
    while (characters > MAX_CHARACTERS && sorted.length > 1) {
      const removed = sorted.shift();
      characters -= removed?.text?.length ?? 0;
      ceilingReached = true;
    }
    return Object.freeze({
      channel: locator.channel,
      events: Object.freeze(sorted),
      complete: !ceilingReached,
      incompleteReason: ceilingReached ? "safety_ceiling" : null,
      characters,
      turnsConsidered: seen.size,
    });
  }

  private incomplete(
    locator: MetaConversationLocator,
    events: readonly MetaHistoryEvent[],
    incompleteReason: Exclude<MetaConversationSnapshot["incompleteReason"], null>,
  ): MetaConversationSnapshot {
    return Object.freeze({
      channel: locator.channel,
      events: Object.freeze([...events]),
      complete: false,
      incompleteReason,
      characters: events.reduce((total, event) => total + (event.text?.length ?? 0), 0),
      turnsConsidered: events.length,
    });
  }
}
