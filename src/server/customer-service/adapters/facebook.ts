import { IMAGE_LIMITS } from "../attachments/limits";
import type { NormalizedAttachment } from "../attachments/types";
import type { ChannelAdapter, NormalizedIncomingMessage } from "../types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function normalizedAttachments(message: Record<string, unknown>, messageId: string): readonly NormalizedAttachment[] {
  const attachments: NormalizedAttachment[] = [];
  let sourceCount = 0;
  for (const [ordinal, rawAttachment] of list(message.attachments).entries()) {
    const attachment = record(rawAttachment);
    const payload = record(attachment?.payload);
    if (attachment?.type === "image") {
      const url = httpsUrl(payload?.url);
      if (url && sourceCount < IMAGE_LIMITS.maxCount) {
        sourceCount += 1;
        attachments.push(Object.freeze({
        externalAttachmentKey: `${messageId}:${ordinal}`,
        ordinal,
        kind: "image" as const,
        sourceRef: Object.freeze({ kind: "facebook_remote" as const, url }),
        mimeTypeHint: null,
        failureCode: null,
        }));
        continue;
      }
      attachments.push(Object.freeze({
        externalAttachmentKey: `${messageId}:${ordinal}`,
        ordinal,
        kind: "unsupported" as const,
        sourceRef: null,
        mimeTypeHint: null,
        failureCode: url ? "too_many_attachments" as const : "invalid_image_source" as const,
      }));
      continue;
    }
    attachments.push(Object.freeze({
      externalAttachmentKey: `${messageId}:${ordinal}`,
      ordinal,
      kind: "unsupported" as const,
      sourceRef: null,
      mimeTypeHint: null,
      failureCode: attachment ? "unsupported_attachment" as const : "malformed_attachment" as const,
    }));
  }
  return Object.freeze(attachments);
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
        const entryPageId = typeof entry.id === "string" ? entry.id.trim() : "";
        for (const rawEvent of list(entry.messaging)) {
          const event = record(rawEvent);
          const sender = record(event?.sender);
          const recipient = record(event?.recipient);
          const message = record(event?.message);
          const senderId = typeof sender?.id === "string" ? sender.id.trim() : "";
          const recipientId = typeof recipient?.id === "string" ? recipient.id.trim() : "";
          const messageId = typeof message?.mid === "string" ? message.mid.trim() : "";
          const textValue = typeof message?.text === "string" ? message.text.trim() : "";
          const role = message?.is_echo === true ? "staff" as const : "customer" as const;
          if (role === "staff" && (!entryPageId || senderId !== entryPageId)) continue;
          const conversationKey = role === "staff" ? recipientId : senderId;
          const replyTo = record(message?.reply_to);
          const externalReplyToMessageKey = typeof replyTo?.mid === "string" && replyTo.mid.trim()
            ? replyTo.mid.trim()
            : null;
          const attachments = role === "customer" && message ? normalizedAttachments(message, messageId) : [];
          const safeText = role === "staff" && !textValue && list(message?.attachments).length
            ? "[Staff sent an attachment]"
            : textValue;
          if (!conversationKey || !messageId || (!safeText && !attachments.length)) continue;
          const timestamp = typeof event?.timestamp === "number"
            ? event.timestamp
            : typeof entry.time === "number"
              ? entry.time
              : Date.now();
          normalized.push(Object.freeze({
            channel: "facebook",
            role,
            eventType: role === "staff" ? "human_outbound" : "customer_message",
            externalConversationKey: conversationKey,
            externalMessageKey: messageId,
            externalReplyToMessageKey,
            text: safeText || null,
            attachments,
            receivedAt: new Date(timestamp),
          }));
        }
      }
      return normalized;
    },
  });
}
