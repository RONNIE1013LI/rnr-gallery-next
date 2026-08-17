import type { NormalizedAttachment } from "./attachments/types";

export type CustomerServiceChannel = "facebook" | "website";

export type NormalizedIncomingMessage = Readonly<{
  channel: CustomerServiceChannel;
  externalConversationKey: string;
  externalMessageKey: string;
  text: string | null;
  attachments: readonly NormalizedAttachment[];
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
      | "pilot_limit_reached"
      | "budget_blocked";
    attemptId: string;
  }>;

export interface ChannelAdapter<TPayload> {
  readonly channel: CustomerServiceChannel;
  normalize(payload: TPayload): readonly NormalizedIncomingMessage[];
}
