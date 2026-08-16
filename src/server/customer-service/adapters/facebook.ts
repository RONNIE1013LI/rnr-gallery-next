import type { ChannelAdapter, NormalizedIncomingMessage } from "../types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function createFacebookChannelAdapter(): ChannelAdapter<unknown> {
  return Object.freeze({
    channel: "facebook" as const,
    normalize(payload: unknown) {
      const root = record(payload);
      if (root?.object !== "page") return [];
      const normalized: NormalizedIncomingMessage[] = [];
      for (const rawEntry of list(root.entry)) {
        const entry = record(rawEntry);
        if (!entry) continue;
        for (const rawEvent of list(entry.messaging)) {
          const event = record(rawEvent);
          const sender = record(event?.sender);
          const message = record(event?.message);
          const senderId = typeof sender?.id === "string" ? sender.id.trim() : "";
          const messageId = typeof message?.mid === "string" ? message.mid.trim() : "";
          const text = typeof message?.text === "string" ? message.text.trim() : "";
          if (!senderId || !messageId || !text || message?.is_echo === true) continue;
          const timestamp = typeof event?.timestamp === "number"
            ? event.timestamp
            : typeof entry.time === "number"
              ? entry.time
              : Date.now();
          normalized.push(Object.freeze({
            channel: "facebook",
            externalConversationKey: senderId,
            externalMessageKey: messageId,
            text,
            receivedAt: new Date(timestamp),
          }));
        }
      }
      return normalized;
    },
  });
}
