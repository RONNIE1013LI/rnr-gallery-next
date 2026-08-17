import { createHash } from "node:crypto";
import { parseImageAnalysisResult } from "./image-analysis-schema";
import { localDateScopeKey } from "./usage-cost";
import { IMAGE_LIMITS } from "./attachments/limits";
import type { AttachmentSourceReader } from "./attachments/image-validation";
import type { PrivateAttachmentStore } from "./attachments/private-attachment-store";
import type { ProtectedAttachmentSource } from "./attachments/attachment-source-protector";
import type { ImageAnalysisProvider } from "./providers/image-analysis-provider";
import type { ImageAnalysisAttemptCompletion } from "./repositories/customer-service-repository";

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

type ImageInput = Readonly<{
  attachmentId: string;
  ordinal: number;
  cleanupStatus: "pending" | "stored" | "deleted" | "failed";
  privateStorageKey: string | null;
  verifiedMimeType: "image/jpeg" | "image/png" | "image/webp" | null;
  byteSize: number | null;
  sha256: string | null;
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
  ensureImageAnalysisAttemptForJob(input: Readonly<{
    jobId: string;
    leaseToken: string;
    sources: readonly ProtectedAttachmentSource[];
  }>): Promise<Readonly<{
    attemptId: string;
    inputs: readonly (ImageInput & Readonly<{ externalAttachmentKeyHash: string }>)[];
  }>>;
  prepareImageAttachmentStorage(input: Readonly<{
    jobId: string;
    leaseToken: string;
    attemptId: string;
    attachmentId: string;
    privateStorageKey: string;
    deleteDueAt: Date;
  }>): Promise<void>;
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
  loadImageAnalysisInputs(attemptId: string): Promise<readonly ImageInput[]>;
  reserveImageJobBudget(input: Readonly<{
    jobId: string;
    leaseToken: string;
    reservationMicrousd: number;
    dailyScopeKey: string;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
  }>): Promise<Readonly<{ status: "reserved" | "budget_blocked" }>>;
  markImageAnalysisProviderStarted(input: Readonly<{
    jobId: string;
    leaseToken: string;
    attemptId: string;
  }>): Promise<boolean>;
  completeImageAnalysisAttempt(input: ImageAnalysisAttemptCompletion): Promise<void>;
  cleanupImageAttemptInputs(input: Readonly<{
    attemptId: string;
    now: Date;
    limit: number;
    remove(storageKey: string): Promise<void>;
  }>): Promise<Readonly<{ selected: number; deleted: number; failed: number }>>;
  loadImageJobAssessment(jobId: string): Promise<string | null>;
}>;

type PolicyResult = Readonly<{ status: "allowed" }> | Readonly<{ status: "blocked"; code: string }>;
type RunnerResult = Readonly<{ claimed: number; completed: number; humanReviewRequired: number }>;
const emptyResult: RunnerResult = { claimed: 0, completed: 0, humanReviewRequired: 0 };

function requiresManualImageReview(stage: ImageJobStage): boolean {
  return stage === "download" || stage === "vision" || stage === "draft";
}

function completion(input: Readonly<{
  attemptId: string;
  provider: ImageAnalysisProvider;
  status: ImageAnalysisAttemptCompletion["status"];
  providerCalled: boolean;
  code?: string;
  result?: Awaited<ReturnType<ImageAnalysisProvider["analyze"]>>;
}>): ImageAnalysisAttemptCompletion {
  return {
    attemptId: input.attemptId,
    status: input.status,
    providerCalled: input.providerCalled,
    ...(input.providerCalled ? {
      provider: input.result?.provider ?? input.provider.providerKind,
      model: input.result?.model ?? input.provider.model,
    } : {}),
    ...(input.status === "analyzed" ? { analysisResult: input.result?.analysis } : {}),
    validatorCodes: input.code && input.status !== "provider_error" ? [input.code] : [],
    inputTokens: input.result?.usage.inputTokens ?? 0,
    cachedInputTokens: input.result?.usage.cachedInputTokens ?? 0,
    outputTokens: input.result?.usage.outputTokens ?? 0,
    estimatedCostMicrousd: input.result?.estimatedCostMicrousd ?? null,
    latencyMs: input.result?.latencyMs ?? 0,
    ...(input.status === "provider_error" ? { providerErrorCode: input.code ?? "image_provider_error" } : {}),
  };
}

export function createImageJobRunner(input: Readonly<{
  repository: ImageJobRepository;
  policyCheck(messageId: string): Promise<PolicyResult>;
  sourceProtector: Readonly<{
    open(input: Readonly<{ jobId: string; ciphertext: string; expiresAt: Date }>): readonly ProtectedAttachmentSource[];
  }>;
  sourceReader: AttachmentSourceReader;
  store: PrivateAttachmentStore;
  imageProvider: ImageAnalysisProvider;
  generateDraft(input: Readonly<{
    messageId: string;
    imageJobId: string;
    leaseToken: string;
    visualAssessment: string;
  }>): Promise<Readonly<{ status: string; attemptId: string }>>;
  budget: Readonly<{
    imageReservationMicrousd: number;
    textReservationMicrousd: number;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
  }>;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  async function failAfterCleanup(job: ClaimedImageJob, code: string) {
    await input.repository.completeImageJobStage({
      jobId: job.id,
      leaseToken: job.leaseToken,
      nextStage: "cleanup",
      terminalAfterCleanup: true,
      failureCode: code,
    });
    return { claimed: 1, completed: 0, humanReviewRequired: 1 } as const;
  }

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

      if (requiresManualImageReview(job.stage)) return failAfterCleanup(job, "image_manual_review_required");

      if (job.stage === "download") {
        if (!job.sourceCiphertext || !job.sourceExpiresAt) return failAfterCleanup(job, "image_source_unavailable");
        let sources: readonly ProtectedAttachmentSource[];
        try {
          sources = input.sourceProtector.open({ jobId: job.id, ciphertext: job.sourceCiphertext, expiresAt: job.sourceExpiresAt });
        } catch {
          return failAfterCleanup(job, "image_source_unavailable");
        }
        let attempt: Awaited<ReturnType<ImageJobRepository["ensureImageAnalysisAttemptForJob"]>> | null = null;
        try {
          const currentAttempt = await input.repository.ensureImageAnalysisAttemptForJob({
            jobId: job.id,
            leaseToken: job.leaseToken,
            sources,
          });
          attempt = currentAttempt;
          if (currentAttempt.inputs.length !== sources.length) throw new Error("image_context_mismatch");
          const aligned = sources.map((source) => ({
            source,
            attemptInput: currentAttempt.inputs.find((candidate) => (
              candidate.ordinal === source.ordinal
              && candidate.externalAttachmentKeyHash === source.externalAttachmentKeyHash
            )),
          }));
          if (
            aligned.some((item) => !item.attemptInput)
            || aligned.some((item) => item.attemptInput?.cleanupStatus !== "pending" && item.attemptInput?.cleanupStatus !== "stored")
          ) throw new Error("image_context_mismatch");
          const next = aligned.find((item) => item.attemptInput?.cleanupStatus === "pending");
          const nextInput = next?.attemptInput;
          if (!next || !nextInput) {
            await input.repository.completeImageJobStage({
              jobId: job.id,
              leaseToken: job.leaseToken,
              nextStage: "vision",
            });
            return { claimed: 1, completed: 0, humanReviewRequired: 0 };
          }
          const resolved = await input.sourceReader.read(
            next.source.sourceRef,
            AbortSignal.timeout(IMAGE_LIMITS.perImageTimeoutMs),
          );
          const storedBytes = currentAttempt.inputs.reduce((sum, item) => sum + (item.byteSize ?? 0), 0);
          if (storedBytes + resolved.bytes.byteLength > IMAGE_LIMITS.maxBatchBytes) {
            throw new Error("image_batch_too_large");
          }
          const storageKey = nextInput.privateStorageKey ?? input.store.allocateKey();
          const deleteDueAt = new Date(startedAt.getTime() + IMAGE_LIMITS.retentionMs);
          await input.repository.prepareImageAttachmentStorage({
            jobId: job.id,
            leaseToken: job.leaseToken,
            attemptId: currentAttempt.attemptId,
            attachmentId: nextInput.attachmentId,
            privateStorageKey: storageKey,
            deleteDueAt,
          });
          await input.store.save(
            storageKey,
            resolved,
            AbortSignal.timeout(IMAGE_LIMITS.storageOperationTimeoutMs),
          );
          await input.repository.markImageAttachmentStored({
            attemptId: currentAttempt.attemptId,
            attachmentId: nextInput.attachmentId,
            verifiedMimeType: resolved.mimeType,
            width: resolved.width,
            height: resolved.height,
            byteSize: resolved.bytes.byteLength,
            sha256: resolved.sha256,
            privateStorageKey: storageKey,
            deleteDueAt,
          });
          const hasPendingInputs = aligned.some((item) => (
            item.attemptInput?.cleanupStatus === "pending"
            && item.attemptInput.attachmentId !== nextInput.attachmentId
          ));
          await input.repository.completeImageJobStage({
            jobId: job.id,
            leaseToken: job.leaseToken,
            nextStage: hasPendingInputs ? "download" : "vision",
          });
        } catch {
          if (attempt) {
            await input.repository.completeImageAnalysisAttempt(completion({
              attemptId: attempt.attemptId,
              provider: input.imageProvider,
              status: "input_rejected",
              providerCalled: false,
              code: "image_input_rejected",
            }));
          }
          return failAfterCleanup(job, "image_input_rejected");
        }
        return { claimed: 1, completed: 0, humanReviewRequired: 0 };
      }

      if (job.stage === "vision") {
        if (!job.imageAnalysisAttemptId) return failAfterCleanup(job, "image_attempt_missing");
        const reservation = await input.repository.reserveImageJobBudget({
          jobId: job.id,
          leaseToken: job.leaseToken,
          reservationMicrousd: input.budget.imageReservationMicrousd + input.budget.textReservationMicrousd,
          dailyScopeKey: localDateScopeKey(startedAt),
          dailyHardStopMicrousd: input.budget.dailyHardStopMicrousd,
          totalHardStopMicrousd: input.budget.totalHardStopMicrousd,
        });
        if (reservation.status === "budget_blocked") return failAfterCleanup(job, "image_budget_blocked");
        const providerMarked = await input.repository.markImageAnalysisProviderStarted({
          jobId: job.id,
          leaseToken: job.leaseToken,
          attemptId: job.imageAnalysisAttemptId,
        });
        if (!providerMarked) return failAfterCleanup(job, "image_provider_state_ambiguous");
        let providerResult: Awaited<ReturnType<ImageAnalysisProvider["analyze"]>> | undefined;
        try {
          const stored = await input.repository.loadImageAnalysisInputs(job.imageAnalysisAttemptId);
          const images = await Promise.all(stored.map(async (item) => {
            if (!item.privateStorageKey || !item.verifiedMimeType || !item.sha256 || item.cleanupStatus !== "stored") {
              throw new Error("image_storage_invalid");
            }
            const bytes = await input.store.read(
              item.privateStorageKey,
              AbortSignal.timeout(IMAGE_LIMITS.storageOperationTimeoutMs),
            );
            if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("image_storage_invalid");
            return { ordinal: item.ordinal, mimeType: item.verifiedMimeType, bytes };
          }));
          providerResult = await input.imageProvider.analyze({ images });
          const analysis = parseImageAnalysisResult(providerResult.analysis, images.map((image) => image.ordinal));
          await input.repository.completeImageAnalysisAttempt({
            ...completion({
              attemptId: job.imageAnalysisAttemptId,
              provider: input.imageProvider,
              status: "analyzed",
              providerCalled: true,
              result: providerResult,
            }),
            analysisResult: analysis,
          });
          await input.repository.completeImageJobStage({
            jobId: job.id,
            leaseToken: job.leaseToken,
            nextStage: "cleanup",
            terminalAfterCleanup: analysis.overallStatus !== "assessed",
            failureCode: analysis.overallStatus === "assessed" ? null : "image_assessment_inconclusive",
          });
          return { claimed: 1, completed: 0, humanReviewRequired: analysis.overallStatus === "assessed" ? 0 : 1 };
        } catch {
          await input.repository.completeImageAnalysisAttempt(completion({
            attemptId: job.imageAnalysisAttemptId,
            provider: input.imageProvider,
            status: providerResult ? "schema_blocked" : "provider_error",
            providerCalled: true,
            code: providerResult ? "image_schema_blocked" : "image_provider_error",
            result: providerResult,
          }));
          return failAfterCleanup(job, providerResult ? "image_schema_blocked" : "image_provider_error");
        }
      }

      if (job.stage === "cleanup") {
        if (!job.imageAnalysisAttemptId) {
          await input.repository.finishImageJob({
            jobId: job.id,
            leaseToken: job.leaseToken,
            status: "human_review_required",
            failureCode: job.failureCode ?? "image_attempt_missing",
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
      }

      const visualAssessment = await input.repository.loadImageJobAssessment(job.id);
      if (!visualAssessment) {
        await input.repository.finishImageJob({
          jobId: job.id,
          leaseToken: job.leaseToken,
          status: "human_review_required",
          failureCode: "image_assessment_unavailable",
        });
        return { claimed: 1, completed: 0, humanReviewRequired: 1 };
      }
      const draft = await input.generateDraft({
        messageId: job.messageId,
        imageJobId: job.id,
        leaseToken: job.leaseToken,
        visualAssessment,
      });
      const completed = draft.status === "draft_ready";
      await input.repository.finishImageJob({
        jobId: job.id,
        leaseToken: job.leaseToken,
        status: completed ? "completed" : "human_review_required",
        failureCode: completed ? null : `text_${draft.status}`,
        textAttemptId: draft.attemptId,
      });
      return { claimed: 1, completed: completed ? 1 : 0, humanReviewRequired: completed ? 0 : 1 };
    },
  });
}
