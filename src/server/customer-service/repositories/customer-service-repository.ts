import type { CustomerServiceChannel, DraftGenerationRequest } from "../types";

export type HashedIncomingMessage = Readonly<{
  channel: CustomerServiceChannel;
  externalConversationKeyHash: string;
  externalMessageKeyHash: string;
  text: string;
  receivedAt: Date;
}>;

export type DraftInput = Readonly<{
  current: Readonly<{ id: string; body: string; channel: CustomerServiceChannel }>;
  context: readonly string[];
}>;

export type GateBlockedAttemptInput = Readonly<{
  messageId: string;
  trigger: DraftGenerationRequest["trigger"];
  intent: string;
  riskLevel: "low" | "medium" | "high";
  gateResult: "high_risk" | "unresolved" | "realtime_required" | "pilot_limit";
  gateReasons: readonly string[];
  knowledgeVersion: string;
}>;

export type ProviderAttemptReservation = Readonly<{
  messageId: string;
  trigger: DraftGenerationRequest["trigger"];
  intent: string;
  riskLevel: "low" | "medium" | "high";
  gateReasons: readonly string[];
  knowledgeSources: readonly string[];
  knowledgeVersion: string;
  reservationMicrousd: number;
  dailyScopeKey: string;
  dailyHardStopMicrousd: number;
  totalHardStopMicrousd: number;
}>;

export type ProviderAttemptCompletion = Readonly<{
  attemptId: string;
  status: "draft_ready" | "output_blocked" | "provider_error";
  provider: "mock" | "openai";
  model: string;
  draftText?: string;
  rejectedOutputHash?: string;
  validatorCodes: readonly string[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostMicrousd: number;
  latencyMs: number;
  providerErrorCode?: string;
  dailyScopeKey: string;
}>;

export type FeedbackEventInput = Readonly<{
  attemptId: string;
  actorUserId: string | null;
  action: "accepted_unchanged" | "edited" | "rejected" | "copied" | "sent_confirmed";
  humanFinalText: string | null;
  reasonCode: string | null;
  idempotencyKey: string;
}>;

export type SafeQueuePage = Readonly<{
  items: readonly Readonly<{
    messageId: string;
    body: string;
    receivedAt: string;
    status: string;
    latestAttemptId: string | null;
    draftText: string | null;
    gateResult: string | null;
  }>[];
}>;

export interface CustomerServiceRepository {
  ingestFacebookMessage(input: HashedIncomingMessage): Promise<
    | Readonly<{ status: "created"; messageId: string; pilotSequence: number }>
    | Readonly<{ status: "duplicate"; messageId: string }>
    | Readonly<{ status: "pilot_complete"; messageId: string }>
  >;
  loadDraftInput(messageId: string, contextLimit: number): Promise<DraftInput | null>;
  createGateBlockedAttempt(input: GateBlockedAttemptInput): Promise<string>;
  reserveProviderAttempt(input: ProviderAttemptReservation): Promise<
    | Readonly<{ status: "reserved"; attemptId: string }>
    | Readonly<{ status: "budget_blocked"; attemptId: string }>
  >;
  completeProviderAttempt(input: ProviderAttemptCompletion): Promise<void>;
  appendFeedback(input: FeedbackEventInput): Promise<void>;
  listQueue(limit: number): Promise<SafeQueuePage>;
}
