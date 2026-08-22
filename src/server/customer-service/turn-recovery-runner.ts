import { randomUUID } from "node:crypto";
import type { DraftGenerationResult, CustomerServiceChannel } from "./types";
import { publishValidatedWebsiteDraft } from "./website/publication";
import { createReviewAlertToken, hashReviewAlertToken } from "./website/review-alert-service";

type ClaimedTurn = Readonly<{
  turnId: string;
  messageId: string;
  channel: CustomerServiceChannel;
  leaseToken: string;
  processingAttempt: number;
  settledResult?: DraftGenerationResult;
}>;

type RecoveryRepository = Readonly<{
  claimDueCustomerTurn(input: Readonly<{
    turnId?: string;
    channels?: readonly CustomerServiceChannel[];
    now: Date;
    leaseExpiresAt: Date;
  }>): Promise<ClaimedTurn | null>;
  completeCustomerTurnProcessing(input: Readonly<{
    turnId: string;
    leaseToken: string;
    now: Date;
    outcome: DraftGenerationResult["status"];
  }>): Promise<boolean>;
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
  }>): Promise<Readonly<{ status: "opened" | "reused"; reviewId: string; generation: number }> | Readonly<{ status: "cancelled" }>>;
  publishWebsiteValidatedAi(input: Readonly<{
    turnId: string;
    leaseToken: string;
    attemptId: string;
    now: Date;
  }>): Promise<Readonly<{ status: "published" | "cancelled" | "not_publishable" }>>;
}>;

export type CustomerTurnRecoveryResult = Readonly<{
  claimed: number;
  completed: number;
  retried: number;
  cancelled: number;
}>;

export function createCustomerTurnRecoveryRunner(input: Readonly<{
  repository: RecoveryRepository;
  generateDraft(messageId: string): Promise<DraftGenerationResult>;
  knowledgeVersion: string;
  now?: () => Date;
  leaseMs?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxAttempts?: number;
  reviewAlertSecret?: string;
  allowedChannels?: readonly CustomerServiceChannel[];
}>) {
  const now = input.now ?? (() => new Date());
  const leaseMs = input.leaseMs ?? 300_000;
  const retryDelayMs = input.retryDelayMs ?? 60_000;
  const maxRetryDelayMs = input.maxRetryDelayMs ?? 900_000;
  const maxAttempts = input.maxAttempts ?? 3;

  async function completeWebsiteReview(
    claimed: ClaimedTurn,
    completedAt: Date,
    result: DraftGenerationResult | Readonly<{ status: "system_failure"; attemptId: string | null }>,
  ) {
    const reviewId = input.reviewAlertSecret ? randomUUID() : null;
    const rawToken = reviewId && input.reviewAlertSecret
      ? createReviewAlertToken({ reviewId, secret: input.reviewAlertSecret })
      : null;
    const review = await input.repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: result.attemptId,
      outcome: result.status,
      now: completedAt,
      knowledgeVersion: input.knowledgeVersion,
      ...(reviewId && rawToken ? {
        reviewAlert: {
          reviewId,
          deepLinkTokenHash: hashReviewAlertToken(rawToken),
          deepLinkExpiresAt: new Date(completedAt.getTime() + 7 * 24 * 60 * 60_000),
          idempotencyKey: `review-alert:${reviewId}`,
        },
      } : {}),
    });
    if (review.status === "cancelled") return { claimed: 1, completed: 0, retried: 0, cancelled: 1 };
    const completed = await input.repository.completeCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      now: completedAt,
      outcome: result.status === "system_failure" ? "provider_error" : result.status,
    });
    return { claimed: 1, completed: completed ? 1 : 0, retried: 0, cancelled: completed ? 0 : 1 };
  }

  async function settleFailure(claimed: ClaimedTurn, startedAt: Date, errorCode: string) {
    if (claimed.processingAttempt >= maxAttempts) {
      const exhausted = await input.repository.exhaustCustomerTurnProcessing({
        turnId: claimed.turnId,
        leaseToken: claimed.leaseToken,
        now: startedAt,
        errorCode: errorCode === "provider_error" ? "provider_retry_exhausted" : "turn_processing_retry_exhausted",
      });
      return { claimed: 1, completed: exhausted ? 1 : 0, retried: 0, cancelled: exhausted ? 0 : 1 };
    }
    const delayMs = Math.min(maxRetryDelayMs, retryDelayMs * (2 ** (claimed.processingAttempt - 1)));
    const retried = await input.repository.retryCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      nextRunAt: new Date(startedAt.getTime() + delayMs),
      errorCode,
    });
    return { claimed: 1, completed: 0, retried: retried ? 1 : 0, cancelled: retried ? 0 : 1 };
  }

  return Object.freeze({
    async runOnce(options: Readonly<{ turnId?: string }> = {}): Promise<CustomerTurnRecoveryResult> {
      const startedAt = now();
      const claimed = await input.repository.claimDueCustomerTurn({
        ...(options.turnId ? { turnId: options.turnId } : {}),
        ...(input.allowedChannels ? { channels: input.allowedChannels } : {}),
        now: startedAt,
        leaseExpiresAt: new Date(startedAt.getTime() + leaseMs),
      });
      if (!claimed) return { claimed: 0, completed: 0, retried: 0, cancelled: 0 };

      try {
        const result = claimed.settledResult ?? await input.generateDraft(claimed.messageId);
        const completedAt = now();
        if (claimed.channel === "website" && [
          "gate_blocked",
          "realtime_required",
          "budget_blocked",
          "provider_error",
          "output_blocked",
        ].includes(result.status)) {
          return completeWebsiteReview(claimed, completedAt, result);
        }
        if (result.status === "provider_error") {
          return settleFailure(claimed, startedAt, "provider_error");
        }
        if (result.status === "draft_ready" && claimed.channel === "website") {
          const publication = await publishValidatedWebsiteDraft({
            repository: input.repository,
            channel: claimed.channel,
            turnId: claimed.turnId,
            leaseToken: claimed.leaseToken,
            attemptId: result.attemptId,
            now: completedAt,
          });
          if (publication.status === "not_publishable") {
            return completeWebsiteReview(claimed, now(), {
              status: "system_failure",
              attemptId: result.attemptId,
            });
          }
          return {
            claimed: 1,
            completed: publication.status === "published" ? 1 : 0,
            retried: 0,
            cancelled: publication.status === "published" ? 0 : 1,
          };
        }
        const completed = await input.repository.completeCustomerTurnProcessing({
          turnId: claimed.turnId,
          leaseToken: claimed.leaseToken,
          now: startedAt,
          outcome: result.status,
        });
        return { claimed: 1, completed: completed ? 1 : 0, retried: 0, cancelled: completed ? 0 : 1 };
      } catch {
        if (claimed.channel === "website") {
          return completeWebsiteReview(claimed, now(), { status: "system_failure", attemptId: null });
        }
        return settleFailure(claimed, startedAt, "turn_processing_interrupted");
      }
    },
  });
}
