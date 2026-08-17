import { createHash } from "node:crypto";
import { parseImageAnalysisResult } from "../image-analysis-schema";
import type { ImageAnalysisProvider, ImageAnalysisProviderResult } from "../providers/image-analysis-provider";
import type { CustomerServiceRepository, ImageAnalysisAttemptCompletion } from "../repositories/customer-service-repository";
import { localDateScopeKey } from "../usage-cost";
import { IMAGE_LIMITS } from "./limits";
import type { AttachmentSourceReader, ResolvedAttachment } from "./image-validation";
import type { PrivateAttachmentStore } from "./private-attachment-store";
import type { NormalizedAttachment } from "./types";

export type AttachmentProcessingResult =
  | Readonly<{ status: "analyzed"; summary: string }>
  | Readonly<{ status: "image_review_required"; code: string }>;

export type AttachmentProcessor = Readonly<{
  process(input: Readonly<{
    messageId: string;
    attachmentIds: readonly string[];
    sources: readonly NormalizedAttachment[];
  }>): Promise<AttachmentProcessingResult>;
}>;

type Budget = Readonly<{
  reservationMicrousd: number;
  dailyHardStopMicrousd: number;
  totalHardStopMicrousd: number;
}>;

type StoredAttachment = Readonly<{
  attachmentId: string;
  ordinal: number;
  storageKey: string;
  resolved: ResolvedAttachment;
}>;

class ProcessingFailure extends Error {
  readonly code: string;
  readonly status: ImageAnalysisAttemptCompletion["status"];
  readonly providerCalled: boolean;
  readonly providerResult?: ImageAnalysisProviderResult;

  constructor(input: Readonly<{
    code: string;
    status: ImageAnalysisAttemptCompletion["status"];
    providerCalled: boolean;
    providerResult?: ImageAnalysisProviderResult;
  }>) {
    super(input.code);
    this.code = input.code;
    this.status = input.status;
    this.providerCalled = input.providerCalled;
    this.providerResult = input.providerResult;
  }
}

function validContext(attachmentIds: readonly string[], sources: readonly NormalizedAttachment[]) {
  if (attachmentIds.length < 1 || attachmentIds.length > IMAGE_LIMITS.maxCount) return false;
  if (attachmentIds.length !== sources.length || new Set(attachmentIds).size !== attachmentIds.length) return false;
  return sources.every((source, index) => (
    source.kind === "image"
    && Number.isInteger(source.ordinal)
    && source.ordinal >= 0
    && (index === 0 || source.ordinal > sources[index - 1].ordinal)
  ));
}

function completion(input: Readonly<{
  attemptId: string;
  failure: ProcessingFailure;
  imageProvider: ImageAnalysisProvider;
  dailyScopeKey: string;
  reservedCostMicrousd: number;
}>): ImageAnalysisAttemptCompletion {
  const providerResult = input.failure.providerResult;
  return {
    attemptId: input.attemptId,
    status: input.failure.status,
    providerCalled: input.failure.providerCalled,
    ...(input.failure.providerCalled ? {
      provider: providerResult?.provider ?? input.imageProvider.providerKind,
      model: providerResult?.model ?? input.imageProvider.model,
    } : {}),
    validatorCodes: input.failure.status === "provider_error" ? [] : [input.failure.code],
    inputTokens: providerResult?.usage.inputTokens ?? 0,
    cachedInputTokens: providerResult?.usage.cachedInputTokens ?? 0,
    outputTokens: providerResult?.usage.outputTokens ?? 0,
    estimatedCostMicrousd: providerResult?.estimatedCostMicrousd ?? 0,
    latencyMs: providerResult?.latencyMs ?? 0,
    ...(input.failure.status === "provider_error" ? { providerErrorCode: input.failure.code } : {}),
    dailyScopeKey: input.dailyScopeKey,
    reservedCostMicrousd: input.reservedCostMicrousd,
  };
}

export function createAttachmentProcessor(input: Readonly<{
  repository: CustomerServiceRepository;
  sourceReader: AttachmentSourceReader;
  attachmentStore: PrivateAttachmentStore;
  imageProvider: ImageAnalysisProvider;
  budget: Budget;
  now?: () => Date;
}>): AttachmentProcessor {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async process(request) {
      if (!validContext(request.attachmentIds, request.sources)) {
        return { status: "image_review_required", code: "image_context_mismatch" };
      }

      const stored: StoredAttachment[] = [];
      const dailyScopeKey = localDateScopeKey(now());
      let attemptId: string | null = null;
      let reservedCostMicrousd = 0;
      let completedProviderResult: ImageAnalysisProviderResult | undefined;
      let result: AttachmentProcessingResult = {
        status: "image_review_required",
        code: "image_processing_error",
      };
      let cleanupFailed = false;

      try {
        attemptId = await input.repository.createImageAnalysisAttempt({
          messageId: request.messageId,
          schemaVersion: "1",
          attachments: request.sources.map((source, index) => ({
            attachmentId: request.attachmentIds[index],
            ordinal: source.ordinal,
          })),
        });

        let totalBytes = 0;
        for (let index = 0; index < request.sources.length; index += 1) {
          const source = request.sources[index];
          let resolved: ResolvedAttachment;
          try {
            resolved = await input.sourceReader.read(
              source.sourceRef,
              AbortSignal.timeout(IMAGE_LIMITS.perImageTimeoutMs),
            );
          } catch {
            throw new ProcessingFailure({
              code: "image_input_rejected",
              status: "input_rejected",
              providerCalled: false,
            });
          }
          totalBytes += resolved.bytes.byteLength;
          if (totalBytes > IMAGE_LIMITS.maxBatchBytes) {
            throw new ProcessingFailure({
              code: "image_input_rejected",
              status: "input_rejected",
              providerCalled: false,
            });
          }

          try {
            const saved = await input.attachmentStore.save(resolved);
            const item = {
              attachmentId: request.attachmentIds[index],
              ordinal: source.ordinal,
              storageKey: saved.storageKey,
              resolved,
            };
            stored.push(item);
            await input.repository.markImageAttachmentStored({
              attachmentId: item.attachmentId,
              verifiedMimeType: resolved.mimeType,
              width: resolved.width,
              height: resolved.height,
              byteSize: resolved.bytes.byteLength,
              sha256: resolved.sha256,
              privateStorageKey: saved.storageKey,
              deleteDueAt: new Date(now().getTime() + IMAGE_LIMITS.retentionMs),
            });
          } catch {
            throw new ProcessingFailure({
              code: "image_storage_error",
              status: "input_rejected",
              providerCalled: false,
            });
          }
        }

        const reservation = await input.repository.reserveImageAnalysisAttempt({
          attemptId,
          reservationMicrousd: input.budget.reservationMicrousd,
          dailyScopeKey,
          dailyHardStopMicrousd: input.budget.dailyHardStopMicrousd,
          totalHardStopMicrousd: input.budget.totalHardStopMicrousd,
        });
        if (reservation.status === "budget_blocked") {
          throw new ProcessingFailure({
            code: "image_budget_blocked",
            status: "input_rejected",
            providerCalled: false,
          });
        }
        reservedCostMicrousd = input.budget.reservationMicrousd;

        const images = [];
        for (const item of stored) {
          let bytes: Buffer;
          try {
            bytes = await input.attachmentStore.read(item.storageKey);
          } catch {
            throw new ProcessingFailure({
              code: "image_storage_error",
              status: "input_rejected",
              providerCalled: false,
            });
          }
          if (createHash("sha256").update(bytes).digest("hex") !== item.resolved.sha256) {
            throw new ProcessingFailure({
              code: "image_storage_error",
              status: "input_rejected",
              providerCalled: false,
            });
          }
          images.push({ ordinal: item.ordinal, mimeType: item.resolved.mimeType, bytes });
        }

        let providerResult: ImageAnalysisProviderResult;
        try {
          providerResult = await input.imageProvider.analyze({ images });
          completedProviderResult = providerResult;
        } catch {
          throw new ProcessingFailure({
            code: "image_provider_error",
            status: "provider_error",
            providerCalled: true,
          });
        }

        let analysis;
        try {
          analysis = parseImageAnalysisResult(
            providerResult.analysis,
            request.sources.map((source) => source.ordinal),
          );
        } catch {
          throw new ProcessingFailure({
            code: "image_schema_blocked",
            status: "schema_blocked",
            providerCalled: true,
            providerResult,
          });
        }

        await input.repository.completeImageAnalysisAttempt({
          attemptId,
          status: "analyzed",
          providerCalled: true,
          provider: providerResult.provider,
          model: providerResult.model,
          analysisResult: analysis,
          validatorCodes: [],
          inputTokens: providerResult.usage.inputTokens,
          cachedInputTokens: providerResult.usage.cachedInputTokens,
          outputTokens: providerResult.usage.outputTokens,
          estimatedCostMicrousd: providerResult.estimatedCostMicrousd,
          latencyMs: providerResult.latencyMs,
          dailyScopeKey,
          reservedCostMicrousd,
        });
        reservedCostMicrousd = 0;
        result = analysis.overallStatus === "assessed"
          ? { status: "analyzed", summary: analysis.safeSummary }
          : { status: "image_review_required", code: "image_assessment_inconclusive" };
      } catch (error) {
        const failure = error instanceof ProcessingFailure ? error : completedProviderResult
          ? new ProcessingFailure({
            code: "image_persistence_error",
            status: "provider_error",
            providerCalled: true,
            providerResult: completedProviderResult,
          })
          : new ProcessingFailure({
            code: "image_processing_error",
            status: "input_rejected",
            providerCalled: false,
          });
        result = { status: "image_review_required", code: failure.code };
        if (attemptId) {
          try {
            await input.repository.completeImageAnalysisAttempt(completion({
              attemptId,
              failure,
              imageProvider: input.imageProvider,
              dailyScopeKey,
              reservedCostMicrousd,
            }));
            reservedCostMicrousd = 0;
          } catch {
            result = { status: "image_review_required", code: "image_persistence_error" };
          }
        }
      } finally {
        for (const item of stored) {
          let deleted = false;
          try {
            await input.attachmentStore.remove(item.storageKey);
            deleted = true;
          } catch {
            cleanupFailed = true;
          }
          try {
            await input.repository.markImageAttachmentDeleted({
              attachmentId: item.attachmentId,
              deleted,
              failureCode: deleted ? null : "image_cleanup_failed",
            });
          } catch {
            cleanupFailed = true;
          }
        }
      }

      return cleanupFailed
        ? { status: "image_review_required", code: "image_cleanup_failed" }
        : result;
    },
  });
}
