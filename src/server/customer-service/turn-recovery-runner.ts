import type { DraftGenerationResult, CustomerServiceChannel } from "./types";

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
  }>): Promise<Readonly<{ status: "opened" | "reused"; reviewId: string; generation: number }> | Readonly<{ status: "cancelled" }>>;
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
}>) {
  const now = input.now ?? (() => new Date());
  const leaseMs = input.leaseMs ?? 300_000;
  const retryDelayMs = input.retryDelayMs ?? 60_000;
  const maxRetryDelayMs = input.maxRetryDelayMs ?? 900_000;
  const maxAttempts = input.maxAttempts ?? 3;

  async function completeWebsiteReview(
    claimed: ClaimedTurn,
    startedAt: Date,
    result: DraftGenerationResult | Readonly<{ status: "system_failure"; attemptId: string | null }>,
  ) {
    const review = await input.repository.openWebsiteHumanReview({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      attemptId: result.attemptId,
      outcome: result.status,
      now: startedAt,
      knowledgeVersion: input.knowledgeVersion,
    });
    if (review.status === "cancelled") return { claimed: 1, completed: 0, retried: 0, cancelled: 1 };
    const completed = await input.repository.completeCustomerTurnProcessing({
      turnId: claimed.turnId,
      leaseToken: claimed.leaseToken,
      now: startedAt,
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
        now: startedAt,
        leaseExpiresAt: new Date(startedAt.getTime() + leaseMs),
      });
      if (!claimed) return { claimed: 0, completed: 0, retried: 0, cancelled: 0 };

      try {
        const result = claimed.settledResult ?? await input.generateDraft(claimed.messageId);
        if (claimed.channel === "website" && [
          "gate_blocked",
          "realtime_required",
          "budget_blocked",
          "provider_error",
          "output_blocked",
        ].includes(result.status)) {
          return completeWebsiteReview(claimed, startedAt, result);
        }
        if (result.status === "provider_error") {
          return settleFailure(claimed, startedAt, "provider_error");
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
          return completeWebsiteReview(claimed, startedAt, { status: "system_failure", attemptId: null });
        }
        return settleFailure(claimed, startedAt, "turn_processing_interrupted");
      }
    },
  });
}
