import type { NormalizedAttachment } from "./attachments/types";

export type CustomerServiceChannel = "facebook" | "website";
export type ConversationRole = "customer" | "staff";
export type ConversationEventType = "customer_message" | "human_outbound" | "system_event";

export type SafeProductContext = Readonly<{
  market: "NZ" | "AU";
  productKey: string;
  productTitle: string;
  category: "canvas" | "banners";
  pageKind: "product" | "configure";
}>;

export type NormalizedIncomingMessage = Readonly<{
  channel: CustomerServiceChannel;
  role: ConversationRole;
  eventType: Exclude<ConversationEventType, "system_event">;
  externalConversationKey: string;
  externalMessageKey: string;
  externalReplyToMessageKey: string | null;
  text: string | null;
  attachments: readonly NormalizedAttachment[];
  productContext?: SafeProductContext | null;
  receivedAt: Date;
}>;

export type DraftGenerationRequest = Readonly<{
  messageId: string;
  trigger: "webhook_after" | "manual_generate" | "manual_regenerate";
}>;

export type DraftGenerationResult =
  | Readonly<{ status: "draft_ready"; attemptId: string }>
  | Readonly<{
    status:
      | "gate_blocked"
      | "realtime_required"
      | "output_blocked"
      | "provider_error"
      | "image_review_required"
      | "pilot_limit_reached"
      | "budget_blocked"
      | "human_reply_received";
    attemptId: string;
  }>;

export interface ChannelAdapter<TPayload> {
  readonly channel: CustomerServiceChannel;
  normalize(payload: TPayload): readonly NormalizedIncomingMessage[];
}
