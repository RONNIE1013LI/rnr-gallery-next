import type { CompiledBusinessBrain } from "./business-brain/schema";

export type ConversationRole = "customer" | "staff" | "automation";

export type ConversationTurn = Readonly<{
  providerMessageKey: string;
  role: ConversationRole;
  sentAt: string;
  text: string;
  channel: "meta" | "website";
  attachmentOrdinals: readonly number[];
}>;

export type VerifiedImageInput = Readonly<{
  ordinal: number;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
}>;

export type SupportedClaim = Readonly<{
  kind: string;
  value: string;
  sourceId: string;
}>;

export type ToolEvidence = Readonly<{
  tool: string;
  status: "available" | "unavailable_review_required" | "failed";
  source: string;
  facts: Readonly<Record<string, unknown>>;
}>;

export type RnrAiRequest = Readonly<{
  channel: "meta" | "website";
  market: "NZ" | "AU" | "UNKNOWN";
  conversation: readonly ConversationTurn[];
  attachments: readonly VerifiedImageInput[];
  businessBrain: CompiledBusinessBrain;
  toolContext: Readonly<{
    conversationKeyHash: string;
    customerReference?: string;
  }>;
}>;

export type RnrAiDecision = Readonly<{
  risk: "GREEN" | "YELLOW" | "RED";
  intent: string;
  replyText: string | null;
  reasons: readonly string[];
  claims: readonly SupportedClaim[];
  toolEvidence: readonly ToolEvidence[];
  nextAction: "AUTO_REPLY_ELIGIBLE" | "HUMAN_REVIEW" | "NO_REPLY";
  providerRun?: Readonly<{
    model: string;
    usage: Readonly<{
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
    }>;
  }>;
}>;
