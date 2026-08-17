import { IMAGE_LIMITS } from "./attachments/limits";
import type { PrivateAttachmentStore } from "./attachments/private-attachment-store";

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

type ImageJobRepository = Readonly<{
  reconcileStaleImageJobs(input: Readonly<{ now: Date; limit: number }>): Promise<unknown>;
  claimImageJob(input: Readonly<{ jobId?: string; now: Date; leaseExpiresAt: Date }>): Promise<ClaimedImageJob | null>;
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
  cleanupImageAttemptInputs(input: Readonly<{
    attemptId: string;
    now: Date;
    limit: number;
    remove(storageKey: string): Promise<void>;
  }>): Promise<Readonly<{ selected: number; deleted: number; failed: number }>>;
}>;

type PolicyResult = Readonly<{ status: "allowed" }> | Readonly<{ status: "blocked"; code: string }>;
type RunnerResult = Readonly<{ claimed: number; completed: number; humanReviewRequired: number }>;
const emptyResult: RunnerResult = { claimed: 0, completed: 0, humanReviewRequired: 0 };

export function createImageJobRunner(input: Readonly<{
  repository: ImageJobRepository;
  policyCheck(messageId: string): Promise<PolicyResult>;
  store: Pick<PrivateAttachmentStore, "remove">;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async runOnce(request: Readonly<{ jobId?: string }> = {}): Promise<RunnerResult> {
      const startedAt = now();
      await input.repository.reconcileStaleImageJobs({ now: startedAt, limit: 25 });
      const job = await input.repository.claimImageJob({
        ...request,
        now: startedAt,
        leaseExpiresAt: new Date(startedAt.getTime() + IMAGE_LIMITS.jobLeaseMs),
      });
      if (!job) return emptyResult;

      if (job.stage === "policy") {
        const policy = await input.policyCheck(job.messageId);
        const failureCode = job.hasUnsupportedAttachments
          ? "unsupported_attachment"
          : policy.status === "blocked" ? policy.code : "image_manual_review_required";
        await input.repository.finishImageJob({
          jobId: job.id,
          leaseToken: job.leaseToken,
          status: "human_review_required",
          failureCode,
        });
        return { claimed: 1, completed: 0, humanReviewRequired: 1 };
      }

      if (job.stage !== "cleanup") {
        await input.repository.completeImageJobStage({
          jobId: job.id,
          leaseToken: job.leaseToken,
          nextStage: "cleanup",
          terminalAfterCleanup: true,
          failureCode: "image_manual_review_required",
        });
        return { claimed: 1, completed: 0, humanReviewRequired: 1 };
      }

      if (!job.imageAnalysisAttemptId) {
        await input.repository.finishImageJob({
          jobId: job.id,
          leaseToken: job.leaseToken,
          status: "human_review_required",
          failureCode: job.failureCode ?? "image_manual_review_required",
        });
        return { claimed: 1, completed: 0, humanReviewRequired: 1 };
      }

      const cleanup = await input.repository.cleanupImageAttemptInputs({
        attemptId: job.imageAnalysisAttemptId,
        now: startedAt,
        limit: IMAGE_LIMITS.maxCount,
        remove: (storageKey) => input.store.remove(
          storageKey,
          AbortSignal.timeout(IMAGE_LIMITS.storageOperationTimeoutMs),
        ),
      });
      if (cleanup.failed > 0) {
        await input.repository.completeImageJobStage({
          jobId: job.id,
          leaseToken: job.leaseToken,
          nextStage: "cleanup",
          terminalAfterCleanup: true,
          failureCode: job.failureCode ?? "image_manual_review_required",
        });
        return { claimed: 1, completed: 0, humanReviewRequired: 1 };
      }

      await input.repository.finishImageJob({
        jobId: job.id,
        leaseToken: job.leaseToken,
        status: "human_review_required",
        failureCode: job.failureCode ?? "image_manual_review_required",
      });
      return { claimed: 1, completed: 0, humanReviewRequired: 1 };
    },
  });
}
