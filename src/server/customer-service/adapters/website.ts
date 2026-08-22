import type { ChannelAdapter, SafeProductContext } from "../types";
import { isServerResolvedProductContext } from "../website/product-context";

export type WebsiteChannelPayload = Readonly<{
  sessionKeyHash: string;
  clientMessageKeyHash: string;
  text: string;
  productContext?: SafeProductContext | null;
  receivedAt: Date;
}>;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function safeProductContext(value: unknown): SafeProductContext | null {
  if (value === null || value === undefined) return null;
  if (!isServerResolvedProductContext(value)) return null;
  const input = record(value);
  if (!input) return null;
  if (
    (input.market !== "NZ" && input.market !== "AU")
    || typeof input.productKey !== "string"
    || !input.productKey.trim()
    || input.productKey.trim().length > 100
    || typeof input.productTitle !== "string"
    || !input.productTitle.trim()
    || input.productTitle.trim().length > 160
    || (input.category !== "canvas" && input.category !== "banners")
    || (input.pageKind !== "product" && input.pageKind !== "configure")
  ) {
    throw new Error("website_channel_payload_invalid");
  }
  return Object.freeze({
    market: input.market,
    productKey: input.productKey.trim(),
    productTitle: input.productTitle.trim(),
    category: input.category,
    pageKind: input.pageKind,
  });
}

export const websiteChannelAdapter: ChannelAdapter<unknown> = Object.freeze({
  channel: "website",
  normalize(payload: unknown) {
    const input = record(payload);
    const sessionKeyHash = typeof input?.sessionKeyHash === "string" ? input.sessionKeyHash : "";
    const clientMessageKeyHash = typeof input?.clientMessageKeyHash === "string" ? input.clientMessageKeyHash : "";
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    const receivedAt = input?.receivedAt;
    if (
      !HASH_PATTERN.test(sessionKeyHash)
      || !HASH_PATTERN.test(clientMessageKeyHash)
      || !text
      || text.length > 2_000
      || !(receivedAt instanceof Date)
      || !Number.isFinite(receivedAt.getTime())
    ) {
      throw new Error("website_channel_payload_invalid");
    }
    return [Object.freeze({
      channel: "website" as const,
      role: "customer" as const,
      eventType: "customer_message" as const,
      externalConversationKey: sessionKeyHash,
      externalMessageKey: clientMessageKeyHash,
      externalReplyToMessageKey: null,
      text,
      attachments: Object.freeze([]),
      productContext: safeProductContext(input?.productContext),
      receivedAt,
    })];
  },
});
