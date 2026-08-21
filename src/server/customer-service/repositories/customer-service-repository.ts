import type {
  ConversationRole,
  CustomerServiceChannel,
  DraftGenerationRequest,
  DraftGenerationResult,
  SafeProductContext,
} from "../types";
import type { ImageAnalysisResult } from "../image-analysis-schema";
import type { ProtectedAttachmentSource } from "../attachments/attachment-source-protector";
import type {
  WebsitePublicUpdateCursor,
  WebsitePublicUpdateRecord,
} from "../website/public-updates";

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

export type HashedConversationEvent = HashedIncomingMessage & Readonly<{
  role: ConversationRole;
  eventType?: "customer_message" | "human_outbound";
  productContext?: SafeProductContext | null;
  bodyHash?: string | null;
  redactionCodes?: readonly string[];
  replyToExternalMessageKeyHash?: string | null;
  learningEligible?: boolean;
  humanReplyGroupMs?: number;
  debounceMs?: number;
  websiteRateLimit?: Readonly<{
    sessionKeyHash: string;
    networkKeyHash: string;
    sessionExpiresAt: Date;
    isNewSession?: boolean;
  }>;
}>;

export type ConversationContextItem = Readonly<{
  role: "customer" | "staff";
  text: string;
  receivedAt: string;
}>;

export type DraftInput = Readonly<{
  current: Readonly<{
    id: string;
    text: string | null;
    channel: CustomerServiceChannel;
    productContext?: SafeProductContext | null;
  }>;
  context: readonly ConversationContextItem[];
}>;

export type ClaimedCustomerTurn = Readonly<{
  turnId: string;
  messageId: string;
  channel: CustomerServiceChannel;
  leaseToken: string;
  processingAttempt: number;
  settledResult?: DraftGenerationResult;
}>;

export type ClaimedWebsiteReviewAlert = Readonly<{
  id: string;
  humanReviewId: string;
  idempotencyKey: string;
  attemptCount: number;
  leaseToken: string;
  reason: "high_risk" | "unresolved" | "realtime_required" | "provider_error" | "output_blocked" | "budget_blocked" | "system_failure";
  redactedSummary: string;
  openedAt: Date;
  deepLinkExpiresAt: Date;
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
  websiteDailyWarningMicrousd?: number;
  websiteDailyHardStopMicrousd?: number;
  websiteTotalHardStopMicrousd?: number;
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
    channel: CustomerServiceChannel;
    body: string;
    receivedAt: string;
    status: string;
    latestAttemptId: string | null;
    draftText: string | null;
    gateResult: string | null;
    attachmentCount: number;
    imageAnalysisStatus: "not_applicable" | "assessed" | "human_review_required";
    imageAssessmentSummary: string | null;
    humanReplyReceived: boolean;
    websiteReview: Readonly<{
      selector: string;
      reason: "high_risk" | "unresolved" | "realtime_required" | "provider_error" | "output_blocked" | "budget_blocked" | "system_failure";
      alertStatus: "not_created" | "pending" | "leased" | "sending" | "retry_wait" | "sent" | "failed";
    }> | null;
    timeline: readonly Readonly<{
      role: "customer" | "assistant" | "staff";
      text: string;
      receivedAt: string;
    }>[];
  }>[];
}>;

export type ReplyAssistantLearningCandidatePage = Readonly<{ items: readonly Readonly<{
  id: string;
  intent: string;
  proposedChange: string;
  reasonCodes: readonly string[];
  evidenceCount: number;
  status: "pending" | "approved" | "rejected" | "superseded";
}>[] }>;

export type ReplyAssistantCaseMemoryPage = Readonly<{ items: readonly Readonly<{
  id: string;
  intent: string;
  normalizedSituation: string;
  humanFinalReply: string;
  status: "pending_review" | "approved_reusable" | "excluded" | "revoked";
}>[] }>;

export type ReplyAssistantUpdatePage = Readonly<{
  cursor: string;
  hasMore: boolean;
  queueItems: SafeQueuePage["items"];
  metrics: PilotMetricCounts | null;
  learningCandidates: ReplyAssistantLearningCandidatePage | null;
  caseMemories: ReplyAssistantCaseMemoryPage | null;
}>;

export type PilotMetricCounts = Readonly<{
  totalIncomingEligible: number;
  rawCustomerEvents: number;
  staffContextEvents: number;
  meaningfulTurns: number;
  aggregatedFragments: number;
  acknowledgementsSuppressed: number;
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
  totalActualHumanReplies: number;
  matchedHumanReplies: number;
  unmatchedHumanReplies: number;
  acceptedUnchangedHumanReplies: number;
  editedHumanReplies: number;
  independentlyWrittenHumanReplies: number;
  reusableCaseMemories: number;
  excludedHighRiskCases: number;
  casesRetrievedInDrafts: number;
  learningCandidatesPending: number;
  learningCandidatesApproved: number;
  learningCandidatesRejected: number;
  commonEditReasons: readonly Readonly<{ code: string; count: number }>[];
}>;

export interface CustomerServiceRepository {
  resolveWebsiteReviewDeepLink(input: Readonly<{
    tokenHash: string;
    now: Date;
  }>): Promise<Readonly<{
    selector: string;
    item: SafeQueuePage["items"][number];
  }> | null>;
  answerWebsiteReview(input: Readonly<{
    reviewSelector: string;
    text: string;
    actorUserId: string;
    now: Date;
  }>): Promise<Readonly<{ status: "sent" | "duplicate" | "unavailable" }>>;
  listWebsitePublicUpdates(input: Readonly<{
    conversationId: string;
    after: WebsitePublicUpdateCursor | null;
    limit: number;
  }>): Promise<readonly WebsitePublicUpdateRecord[]>;
  resolveWebsiteSession(input: Readonly<{
    sessionTokenHash: string;
    now: Date;
  }>): Promise<Readonly<{ conversationId: string; expiresAt: Date }> | null>;
  ensureWebsiteSession(input: Readonly<{
    sessionTokenHash: string;
    externalConversationKeyHash: string;
    now: Date;
    expiresAt: Date;
  }>): Promise<Readonly<{ conversationId: string; expiresAt: Date }>>;
  ingestConversationEvent(input: HashedConversationEvent): Promise<
    | Readonly<{ status: "turn_pending"; messageId: string; turnId: string; debounceUntil: Date }>
    | Readonly<{ status: "context_only" }>
    | Readonly<{ status: "rate_limited" }>
    | Readonly<{ status: "duplicate" }>
  >;
  sealDueCustomerTurn(input: Readonly<{ turnId: string; now: Date }>): Promise<
    | Readonly<{ status: "not_due" }>
    | Readonly<{ status: "already_terminal" }>
    | Readonly<{ status: "suppressed"; turnId: string; reason: "completed_acknowledgement" }>
    | Readonly<{ status: "pilot_complete"; turnId: string; messageId: string }>
    | Readonly<{ status: "sealed"; turnId: string; messageId: string; pilotSequence: number }>
  >;
  claimDueCustomerTurn(input: Readonly<{
    turnId?: string;
    now: Date;
    leaseExpiresAt: Date;
  }>): Promise<ClaimedCustomerTurn | null>;
  completeCustomerTurnProcessing(input: Readonly<{
    turnId: string;
    leaseToken: string;
    now: Date;
    outcome: DraftGenerationResult["status"];
  }>): Promise<boolean>;
  openWebsiteHumanReview(input: Readonly<{
    turnId: string;
    leaseToken: string;
    attemptId: string | null;
    outcome: DraftGenerationResult["status"] | "system_failure";
    now: Date;
    knowledgeVersion: string;
    reviewAlert?: Readonly<{
      reviewId: string;
      deepLinkTokenHash: string;
      deepLinkExpiresAt: Date;
      idempotencyKey: string;
    }>;
  }>): Promise<
    | Readonly<{ status: "opened"; reviewId: string; generation: number }>
    | Readonly<{ status: "reused"; reviewId: string; generation: number }>
    | Readonly<{ status: "cancelled" }>
  >;
  claimDueReviewAlert(input: Readonly<{
    now: Date;
    leaseExpiresAt: Date;
  }>): Promise<ClaimedWebsiteReviewAlert | null>;
  confirmClaimedReviewAlert(input: Readonly<{
    id: string;
    leaseToken: string;
    now: Date;
  }>): Promise<boolean>;
  beginClaimedReviewAlertSend(input: Readonly<{
    id: string;
    leaseToken: string;
    now: Date;
  }>): Promise<boolean>;
  markReviewAlertSent(input: Readonly<{
    id: string;
    leaseToken: string;
    providerMessageId: string;
    now: Date;
  }>): Promise<boolean>;
  retryReviewAlert(input: Readonly<{
    id: string;
    leaseToken: string;
    errorCode: string;
    nextAttemptAt: Date;
    now: Date;
  }>): Promise<"retry_wait" | "resolved" | "stale">;
  markReviewAlertUncertain(input: Readonly<{
    id: string;
    leaseToken: string;
    errorCode: string;
    now: Date;
  }>): Promise<boolean>;
  publishWebsiteValidatedAi(input: Readonly<{
    turnId: string;
    leaseToken: string;
    attemptId: string;
    now: Date;
  }>): Promise<Readonly<{ status: "published" | "cancelled" | "not_publishable" }>>;
  retryCustomerTurnProcessing(input: Readonly<{
    turnId: string;
    leaseToken: string;
    nextRunAt: Date;
    errorCode: string;
  }>): Promise<boolean>;
  exhaustCustomerTurnProcessing(input: Readonly<{
    turnId: string;
    leaseToken: string;
    now: Date;
    errorCode: string;
  }>): Promise<boolean>;
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
    | Readonly<{ status: "human_reply_received"; attemptId: string }>
  >;
  confirmProviderInvocation(input: Readonly<{
    attemptId: string;
    dailyScopeKey: string;
  }>): Promise<
    | Readonly<{ status: "allowed" }>
    | Readonly<{ status: "human_reply_received" }>
  >;
  matchHumanReply(input: Readonly<{ matchId: string; now: Date; groupWindowMs?: number }>): Promise<
    | Readonly<{ status: "not_due" }>
    | Readonly<{ status: "already_terminal" }>
    | Readonly<{ status: "unmatched" }>
    | Readonly<{
      status: "matched";
      classification: "accepted_unchanged" | "edited_light" | "edited_significant" | "ai_ignored" | "independent_reply";
    }>
  >;
  recoverDueHumanReplies(input: Readonly<{
    now: Date;
    groupWindowMs: number;
    limit: number;
    knowledgeVersion: string;
  }>): Promise<Readonly<{ selected: number; matched: number; unmatched: number }>>;
  refreshLearningCandidates(input?: Readonly<{ minimumMatchedReplies?: number }>): Promise<
    Readonly<{ checkpoint: number; created: number }>
  >;
  createCaseMemoryCandidate(input: Readonly<{
    matchId: string;
    customerSituation: string;
    customerTurnSummary: string;
    productCategory: string | null;
    market: "NZ" | "AU" | "other" | "unknown";
    deadlineContext: string | null;
    knowledgeVersion: string;
  }>): Promise<
    | Readonly<{ status: "pending_review"; caseMemoryId: string }>
    | Readonly<{ status: "excluded"; caseMemoryId: string; exclusionCodes: readonly string[] }>
    | Readonly<{ status: "already_exists"; caseMemoryId: string }>
  >;
  listCaseMemoryCandidates(limit: number): Promise<ReplyAssistantCaseMemoryPage>;
  decideCaseMemory(input: Readonly<{
    caseMemoryId: string;
    reviewerUserId: string;
    action: "approve" | "reject";
    reason: string | null;
    now: Date;
  }>): Promise<Readonly<{ status: "approved_reusable" | "excluded" }>>;
  retrieveApprovedCaseMemories(input: Readonly<{
    attemptId: string;
    intent: string;
    riskClass: "low" | "medium";
    productCategory: string | null;
    market: "NZ" | "AU" | "other" | "unknown";
    policyReferences: readonly string[];
    knowledgeVersion: string;
    query: string;
    limit: number;
    now: Date;
  }>): Promise<readonly Readonly<{
    id: string;
    normalizedSituation: string;
    humanFinalReply: string;
    score: number;
  }>[]>;
  listLearningCandidates(limit: number): Promise<ReplyAssistantLearningCandidatePage>;
  decideLearningCandidate(input: Readonly<{
    candidateId: string;
    reviewerUserId: string;
    action: "approve" | "edit_and_approve" | "reject";
    approvedText: string | null;
    reason: string | null;
    now: Date;
  }>): Promise<Readonly<{ status: "approved" | "rejected" }>>;
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
  getReplyAssistantUiCursor(): Promise<string>;
  listReplyAssistantUpdates(cursor: string | null, limit: number): Promise<ReplyAssistantUpdatePage>;
  metricCounts(): Promise<PilotMetricCounts>;
}
