import type { CustomerServiceChannel, DraftGenerationRequest } from "../types";
import type { ImageAnalysisResult } from "../image-analysis-schema";
import type { ProtectedAttachmentSource } from "../attachments/attachment-source-protector";

export type ImageJobStage = "policy" | "download" | "vision" | "cleanup" | "draft";

export type ClaimedImageJob = Readonly<{
  id: string;
  messageId: string;
  stage: ImageJobStage;
  leaseToken: string;
  sourceCiphertext: string | null;
  sourceExpiresAt: Date | null;
  imageAnalysisAttemptId: string | null;
  hasUnsupportedAttachments: boolean;
  terminalAfterCleanup: boolean;
  failureCode: string | null;
}>;

export type ImageAnalysisInputRecord = Readonly<{
  attachmentId: string;
  ordinal: number;
  cleanupStatus: "pending" | "stored" | "deleted" | "failed";
  privateStorageKey: string | null;
  verifiedMimeType: "image/jpeg" | "image/png" | "image/webp" | null;
  byteSize: number | null;
  sha256: string | null;
}>;

export type HashedIncomingMessage = Readonly<{
  channel: CustomerServiceChannel;
  externalConversationKeyHash: string;
  externalMessageKeyHash: string;
  text: string | null;
  attachments: readonly Readonly<{
    externalAttachmentKeyHash: string;
    ordinal: number;
    kind: "image" | "unsupported";
    mimeTypeHint: string | null;
    failureCode?: "unsupported_attachment" | "invalid_image_source" | "malformed_attachment" | "too_many_attachments" | null;
  }>[];
  imageJob?: Readonly<{
    id: string;
    status: "pending" | "human_review_required";
    sourceCiphertext: string | null;
    sourceExpiresAt: Date | null;
    failureCode: string | null;
  }> | null;
  receivedAt: Date;
}>;

export type DraftInput = Readonly<{
  current: Readonly<{ id: string; text: string | null; channel: CustomerServiceChannel }>;
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
  estimatedCostMicrousd: number | null;
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
  estimatedCostMicrousd: number | null;
  latencyMs: number;
  providerErrorCode?: string;
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
    attachmentCount: number;
    imageAnalysisStatus: "not_applicable" | "assessed" | "human_review_required";
    imageAssessmentSummary: string | null;
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
  imageProviderCalls: number;
  imageInputTokens: number;
  imageCachedInputTokens: number;
  imageOutputTokens: number;
  imageTotalCostMicrousd: number;
  imageTotalLatencyMs: number;
  imageFailures: number;
  imageCleanupDeleted: number;
  imageCleanupFailures: number;
  imageContexts: number;
  imageAnalysesSucceeded: number;
  imageAnalysesBlocked: number;
  imageAwareDraftsGenerated: number;
  imageAwareAcceptedUnchanged: number;
  imageAwareEditedAccepted: number;
  imageAwareRejected: number;
  imageRequestOriginalRecommendations: number;
  imageAwareTotalCostMicrousd: number;
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
    hasUnsupportedAttachments: boolean;
  }> | null>;
  reconcileStaleImageJobs(input: Readonly<{ now: Date; limit: number }>): Promise<Readonly<{
    examined: number;
    resumed: number;
    terminal: number;
    reservationsReleased: number;
  }>>;
  claimImageJob(input: Readonly<{
    jobId?: string;
    now: Date;
    leaseExpiresAt: Date;
  }>): Promise<ClaimedImageJob | null>;
  completeImageJobStage(input: Readonly<{
    jobId: string;
    leaseToken: string;
    nextStage: ImageJobStage;
    terminalAfterCleanup?: boolean;
    failureCode?: string | null;
  }>): Promise<boolean>;
  finishImageJob(input: Readonly<{
    jobId: string;
    leaseToken: string;
    status: "completed" | "human_review_required";
    failureCode: string | null;
    textAttemptId?: string;
  }>): Promise<boolean>;
  ensureImageAnalysisAttemptForJob(input: Readonly<{
    jobId: string;
    leaseToken: string;
    sources: readonly ProtectedAttachmentSource[];
  }>): Promise<Readonly<{
    attemptId: string;
    inputs: readonly (ImageAnalysisInputRecord & Readonly<{ externalAttachmentKeyHash: string }>)[];
  }>>;
  prepareImageAttachmentStorage(input: Readonly<{
    jobId: string;
    leaseToken: string;
    attemptId: string;
    attachmentId: string;
    privateStorageKey: string;
    deleteDueAt: Date;
  }>): Promise<void>;
  loadImageAnalysisInputs(attemptId: string): Promise<readonly ImageAnalysisInputRecord[]>;
  reserveImageJobBudget(input: Readonly<{
    jobId: string;
    leaseToken: string;
    reservationMicrousd: number;
    dailyScopeKey: string;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
  }>): Promise<Readonly<{ status: "reserved" }> | Readonly<{ status: "budget_blocked" }>>;
  markImageAnalysisProviderStarted(input: Readonly<{
    jobId: string;
    leaseToken: string;
    attemptId: string;
  }>): Promise<boolean>;
  cleanupImageAttemptInputs(input: Readonly<{
    attemptId: string;
    now: Date;
    limit: number;
    remove(storageKey: string): Promise<void>;
  }>): Promise<Readonly<{ selected: number; deleted: number; failed: number }>>;
  loadImageJobAssessment(jobId: string): Promise<string | null>;
  createImageAnalysisAttempt(input: Readonly<{
    messageId: string;
    schemaVersion: "1";
    attachments: readonly Readonly<{
      attachmentId: string;
      ordinal: number;
      externalAttachmentKeyHash: string;
    }>[];
  }>): Promise<string>;
  markImageAttachmentStored(input: Readonly<{
    attemptId: string;
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
    attemptId: string;
    attachmentId: string;
    privateStorageKey: string;
    deleteDueAt: Date;
    deleted: boolean;
    failureCode: string | null;
  }>): Promise<void>;
  cleanupExpiredImageAttachments(input: Readonly<{
    now: Date;
    limit: number;
    remove(storageKey: string): Promise<void>;
  }>): Promise<Readonly<{ selected: number; deleted: number; failed: number }>>;
  createGateBlockedAttempt(input: GateBlockedAttemptInput): Promise<string>;
  reserveProviderAttempt(input: ProviderAttemptReservation): Promise<
    | Readonly<{ status: "reserved"; attemptId: string }>
    | Readonly<{ status: "budget_blocked"; attemptId: string }>
  >;
  createImageJobProviderAttempt(input: Readonly<{
    jobId: string;
    leaseToken: string;
    messageId: string;
    trigger: "webhook_after";
    intent: string;
    riskLevel: "low" | "medium" | "high";
    gateReasons: readonly string[];
    knowledgeSources: readonly string[];
    knowledgeVersion: string;
  }>): Promise<
    | Readonly<{ status: "reserved"; attemptId: string }>
    | Readonly<{ status: "ambiguous"; attemptId: string }>
  >;
  completeProviderAttempt(input: ProviderAttemptCompletion): Promise<void>;
  messageIdForAttempt(attemptId: string): Promise<string | null>;
  appendFeedback(input: FeedbackEventInput): Promise<void>;
  listQueue(limit: number): Promise<SafeQueuePage>;
  metricCounts(): Promise<PilotMetricCounts>;
}
