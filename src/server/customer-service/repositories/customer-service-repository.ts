import type { CustomerServiceChannel, DraftGenerationRequest } from "../types";
import type { ImageAnalysisResult } from "../image-analysis-schema";

export type HashedIncomingMessage = Readonly<{
  channel: CustomerServiceChannel;
  externalConversationKeyHash: string;
  externalMessageKeyHash: string;
  text: string | null;
  attachments: readonly Readonly<{
    externalAttachmentKeyHash: string;
    ordinal: number;
    kind: "image";
    mimeTypeHint: string | null;
  }>[];
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

export type ImageAnalysisAttemptCompletion = Readonly<{
  attemptId: string;
  status: "analyzed" | "input_rejected" | "provider_error" | "schema_blocked";
  providerCalled: boolean;
  provider?: "mock" | "openai";
  model?: string;
  analysisResult?: ImageAnalysisResult;
  validatorCodes: readonly string[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostMicrousd: number;
  latencyMs: number;
  providerErrorCode?: string;
  dailyScopeKey: string;
  reservedCostMicrousd: number;
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

export type PilotMetricCounts = Readonly<{
  totalIncomingEligible: number;
  draftsGenerated: number;
  acceptedUnchanged: number;
  editedAccepted: number;
  rejected: number;
  gateBlocked: number;
  outputValidatorBlocked: number;
  providerCalls: number;
  policyViolationAttempts: number;
  totalCostMicrousd: number;
  totalLatencyMs: number;
}>;

export interface CustomerServiceRepository {
  ingestFacebookMessage(input: HashedIncomingMessage): Promise<
    | Readonly<{ status: "created"; messageId: string; pilotSequence: number }>
    | Readonly<{ status: "duplicate"; messageId: string }>
    | Readonly<{ status: "pilot_complete"; messageId: string }>
  >;
  loadDraftInput(messageId: string, contextLimit: number): Promise<DraftInput | null>;
  selectImageContext(messageId: string): Promise<Readonly<{
    messageId: string;
    attachmentIds: readonly string[];
    analysisSummary: string | null;
  }> | null>;
  createImageAnalysisAttempt(input: Readonly<{
    messageId: string;
    schemaVersion: "1";
    attachments: readonly Readonly<{ attachmentId: string; ordinal: number }>[];
  }>): Promise<string>;
  markImageAttachmentStored(input: Readonly<{
    attachmentId: string;
    verifiedMimeType: "image/jpeg" | "image/png" | "image/webp";
    width: number;
    height: number;
    byteSize: number;
    sha256: string;
    privateStorageKey: string;
    deleteDueAt: Date;
  }>): Promise<void>;
  reserveImageAnalysisAttempt(input: Readonly<{
    attemptId: string;
    reservationMicrousd: number;
    dailyScopeKey: string;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
  }>): Promise<Readonly<{ status: "reserved" }> | Readonly<{ status: "budget_blocked" }>>;
  completeImageAnalysisAttempt(input: ImageAnalysisAttemptCompletion): Promise<void>;
  markImageAttachmentDeleted(input: Readonly<{
    attachmentId: string;
    deleted: boolean;
    failureCode: string | null;
  }>): Promise<void>;
  createGateBlockedAttempt(input: GateBlockedAttemptInput): Promise<string>;
  reserveProviderAttempt(input: ProviderAttemptReservation): Promise<
    | Readonly<{ status: "reserved"; attemptId: string }>
    | Readonly<{ status: "budget_blocked"; attemptId: string }>
  >;
  completeProviderAttempt(input: ProviderAttemptCompletion): Promise<void>;
  messageIdForAttempt(attemptId: string): Promise<string | null>;
  appendFeedback(input: FeedbackEventInput): Promise<void>;
  listQueue(limit: number): Promise<SafeQueuePage>;
  metricCounts(): Promise<PilotMetricCounts>;
}
