import { createHash } from "node:crypto";
import { evaluatePolicyGate, type PolicyKnowledge } from "./policy-gate";
import { retrieveKnowledge, type AnswerQualityGuide } from "./knowledge-retrieval";
import { validateDraft } from "./output-validator";
import { validateImageDraft } from "./image-draft-validator";
import { buildDraftPrompt } from "./prompt-builder";
import { localDateScopeKey } from "./usage-cost";
import type { AttachmentProcessor } from "./attachments/attachment-processor";
import type { NormalizedAttachment } from "./attachments/types";
import type { AiProvider } from "./providers/ai-provider";
import type { CustomerServiceRepository } from "./repositories/customer-service-repository";
import type { DraftGenerationRequest, DraftGenerationResult } from "./types";

type EngineKnowledge = PolicyKnowledge & Readonly<{
  knowledgeVersion: string;
  toneGuide: string;
  replyExamples: readonly Readonly<{
    intent: string;
    customer: string;
    reply: string;
    risk: string;
    provenance: string;
  }>[];
  goldenReplies: readonly Readonly<{
    intent: string;
    customerQuestion: string;
    approvedAnswer: string;
  }>[];
  qualityGuides: Readonly<Record<string, AnswerQualityGuide>>;
}>;

export class CustomerServiceEngine {
  private readonly repository: CustomerServiceRepository;
  private readonly provider: AiProvider;
  private readonly attachmentProcessor?: AttachmentProcessor;
  private readonly policyGate: typeof evaluatePolicyGate;
  private readonly outputValidator: typeof validateDraft;
  private readonly knowledge: EngineKnowledge;
  private readonly budget: Readonly<{
    reservationMicrousd: number;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
  }>;

  constructor(input: Readonly<{
    repository: CustomerServiceRepository;
    provider: AiProvider;
    attachmentProcessor?: AttachmentProcessor;
    policyGate?: typeof evaluatePolicyGate;
    outputValidator?: typeof validateDraft;
    knowledge: EngineKnowledge;
    budget: Readonly<{
      reservationMicrousd: number;
      dailyHardStopMicrousd: number;
      totalHardStopMicrousd: number;
    }>;
  }>) {
    this.repository = input.repository;
    this.provider = input.provider;
    this.attachmentProcessor = input.attachmentProcessor;
    this.policyGate = input.policyGate ?? evaluatePolicyGate;
    this.outputValidator = input.outputValidator ?? validateDraft;
    this.knowledge = input.knowledge;
    this.budget = input.budget;
  }

  async generateDraft(
    request: DraftGenerationRequest,
    attachmentSourceContext?: readonly NormalizedAttachment[],
  ): Promise<DraftGenerationResult> {
    const draftInput = await this.repository.loadDraftInput(request.messageId, 6);
    if (!draftInput) throw new Error("customer_service_message_not_found");
    const gate = this.policyGate({ message: draftInput.current.body, knowledge: this.knowledge });
    if (!gate.providerAllowed) {
      const gateResult = gate.decision === "REALTIME_DATA_REQUIRED"
        ? "realtime_required"
        : gate.reason === "high_risk_topic"
          ? "high_risk"
          : "unresolved";
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: request.messageId,
        trigger: request.trigger,
        intent: gate.intent,
        riskLevel: "high",
        gateResult,
        gateReasons: [gate.reason],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return {
        status: gate.decision === "REALTIME_DATA_REQUIRED" ? "realtime_required" : "gate_blocked",
        attemptId,
      };
    }

    let visualAssessment: string | undefined;
    const imageContext = await this.repository.selectImageContext(request.messageId);
    if (imageContext) {
      if (request.trigger === "manual_regenerate" && imageContext.analysisSummary) {
        visualAssessment = imageContext.analysisSummary;
      } else if (!this.attachmentProcessor) {
        const attemptId = await this.repository.createGateBlockedAttempt({
          messageId: request.messageId,
          trigger: request.trigger,
          intent: gate.intent,
          riskLevel: "high",
          gateResult: "pilot_limit",
          gateReasons: ["image_analysis_unavailable"],
          knowledgeVersion: this.knowledge.knowledgeVersion,
        });
        return { status: "image_review_required", attemptId };
      } else if (attachmentSourceContext?.length) {
          const processed = await this.attachmentProcessor.process({
            messageId: imageContext.messageId,
            attachmentIds: imageContext.attachmentIds,
            sources: attachmentSourceContext,
          });
          if (processed.status === "analyzed") {
            visualAssessment = processed.summary;
          } else {
            const attemptId = await this.repository.createGateBlockedAttempt({
              messageId: request.messageId,
              trigger: request.trigger,
              intent: gate.intent,
              riskLevel: "high",
              gateResult: "pilot_limit",
              gateReasons: [processed.code],
              knowledgeVersion: this.knowledge.knowledgeVersion,
            });
            return { status: "image_review_required", attemptId };
          }
      } else {
        const attemptId = await this.repository.createGateBlockedAttempt({
          messageId: request.messageId,
          trigger: request.trigger,
          intent: gate.intent,
          riskLevel: "high",
          gateResult: "pilot_limit",
          gateReasons: ["image_context_mismatch"],
          knowledgeVersion: this.knowledge.knowledgeVersion,
        });
        return { status: "image_review_required", attemptId };
      }
    } else if (attachmentSourceContext?.length) {
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: request.messageId,
        trigger: request.trigger,
        intent: gate.intent,
        riskLevel: "high",
        gateResult: "pilot_limit",
        gateReasons: ["image_context_mismatch"],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return { status: "image_review_required", attemptId };
    }

    const sources = retrieveKnowledge({ gate, knowledge: this.knowledge });
    const dailyScopeKey = localDateScopeKey();
    const reservation = await this.repository.reserveProviderAttempt({
      messageId: request.messageId,
      trigger: request.trigger,
      intent: gate.intent,
      riskLevel: gate.riskLevel,
      gateReasons: [gate.reason],
      knowledgeSources: sources.rules.map((rule) => rule.id),
      knowledgeVersion: this.knowledge.knowledgeVersion,
      reservationMicrousd: this.budget.reservationMicrousd,
      dailyScopeKey,
      dailyHardStopMicrousd: this.budget.dailyHardStopMicrousd,
      totalHardStopMicrousd: this.budget.totalHardStopMicrousd,
    });
    if (reservation.status === "budget_blocked") {
      return { status: "budget_blocked", attemptId: reservation.attemptId };
    }

    const prompt = buildDraftPrompt({
      intent: gate.intent,
      context: draftInput.context,
      rules: sources.rules,
      examples: sources.examples,
      goldenExamples: sources.goldenExamples,
      qualityGuide: sources.qualityGuide,
      toneGuide: this.knowledge.toneGuide,
      visualAssessment,
    });
    try {
      const generated = await this.provider.generate(prompt);
      const textValidation = this.outputValidator(generated.text, { intent: gate.intent });
      const imageValidation = visualAssessment
        ? validateImageDraft(generated.text)
        : { ok: true, codes: [] as readonly string[] };
      const validation = {
        ok: textValidation.ok && imageValidation.ok,
        codes: [...textValidation.codes, ...imageValidation.codes],
      };
      await this.repository.completeProviderAttempt({
        attemptId: reservation.attemptId,
        status: validation.ok ? "draft_ready" : "output_blocked",
        provider: generated.provider,
        model: generated.model,
        ...(validation.ok
          ? { draftText: generated.text }
          : {
            draftText: undefined,
            rejectedOutputHash: createHash("sha256").update(generated.text).digest("hex"),
          }),
        validatorCodes: validation.codes,
        inputTokens: generated.usage.inputTokens,
        cachedInputTokens: generated.usage.cachedInputTokens,
        outputTokens: generated.usage.outputTokens,
        estimatedCostMicrousd: generated.estimatedCostMicrousd,
        latencyMs: generated.latencyMs,
        dailyScopeKey,
      });
      return {
        status: validation.ok ? "draft_ready" : "output_blocked",
        attemptId: reservation.attemptId,
      };
    } catch {
      await this.repository.completeProviderAttempt({
        attemptId: reservation.attemptId,
        status: "provider_error",
        provider: this.provider.providerKind,
        model: this.provider.model,
        validatorCodes: [],
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimatedCostMicrousd: 0,
        latencyMs: 0,
        providerErrorCode: "provider_request_failed",
        dailyScopeKey,
      });
      return { status: "provider_error", attemptId: reservation.attemptId };
    }
  }
}
