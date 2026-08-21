import { createHash } from "node:crypto";
import { evaluatePolicyGate, type PolicyKnowledge } from "./policy-gate";
import { retrieveKnowledge, type AnswerQualityGuide } from "./knowledge-retrieval";
import { validateDraft } from "./output-validator";
import { buildDraftPrompt, buildWebsiteDecisionPrompt } from "./prompt-builder";
import { localDateScopeKey } from "./usage-cost";
import { detectIntent } from "./intent-detection";
import { resolveContextualIntent } from "./conversation/contextual-intent";
import type { AttachmentProcessor } from "./attachments/attachment-processor";
import type { NormalizedAttachment } from "./attachments/types";
import type { AiProvider } from "./providers/ai-provider";
import type { CustomerServiceRepository } from "./repositories/customer-service-repository";
import type { DraftGenerationRequest, DraftGenerationResult } from "./types";
import { sanitizeWebsiteModelInput } from "./website/model-input-sanitizer";
import { classifyAcknowledgement } from "./conversation/acknowledgement";
import { parseWebsiteDecision, renderWebsiteDecision } from "./website/structured-decision";

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
  historicalExamples: readonly Readonly<{
    id: string;
    intent: string;
    status: string;
    customerQuestion: string;
    approvedAnswer: string;
    policyReferences: readonly string[];
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
  private readonly policyGate: typeof evaluatePolicyGate;
  private readonly outputValidator: typeof validateDraft;
  private readonly knowledge: EngineKnowledge;
  private readonly budget: Readonly<{
    reservationMicrousd: number;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
    websiteDailyWarningMicrousd: number;
    websiteDailyHardStopMicrousd: number;
    websiteTotalHardStopMicrousd: number;
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
      websiteDailyWarningMicrousd?: number;
      websiteDailyHardStopMicrousd?: number;
      websiteTotalHardStopMicrousd?: number;
    }>;
  }>) {
    this.repository = input.repository;
    this.provider = input.provider;
    this.policyGate = input.policyGate ?? evaluatePolicyGate;
    this.outputValidator = input.outputValidator ?? validateDraft;
    this.knowledge = input.knowledge;
    this.budget = {
      ...input.budget,
      websiteDailyWarningMicrousd: input.budget.websiteDailyWarningMicrousd
        ?? input.budget.dailyHardStopMicrousd,
      websiteDailyHardStopMicrousd: input.budget.websiteDailyHardStopMicrousd ?? input.budget.dailyHardStopMicrousd,
      websiteTotalHardStopMicrousd: input.budget.websiteTotalHardStopMicrousd ?? input.budget.totalHardStopMicrousd,
    };
  }

  private gateFor(text: string, context: Parameters<typeof resolveContextualIntent>[0]["history"]) {
    const resolved = resolveContextualIntent({
      currentText: text,
      history: context,
      baseIntent: detectIntent(text),
    });
    return this.policyGate({
      message: text,
      knowledge: this.knowledge,
      intentOverride: resolved.intent,
      isContextualQuoteDetail: resolved.inherited && resolved.reason === "pending_quote_detail",
    });
  }

  async checkImageJobPolicy(messageId: string): Promise<
    Readonly<{ status: "allowed" }> | Readonly<{ status: "blocked"; code: string }>
  > {
    const draftInput = await this.repository.loadDraftInput(messageId, 6);
    if (!draftInput) throw new Error("customer_service_message_not_found");
    if (draftInput.current.text === null) {
      await this.repository.createGateBlockedAttempt({
        messageId,
        trigger: "webhook_after",
        intent: "image_only",
        riskLevel: "high",
        gateResult: "unresolved",
        gateReasons: ["image_only_without_text"],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return { status: "blocked", code: "image_only_without_text" };
    }
    const gate = this.gateFor(draftInput.current.text, draftInput.context);
    if (gate.providerAllowed) return { status: "allowed" };
    const gateResult = gate.decision === "REALTIME_DATA_REQUIRED"
      ? "realtime_required"
      : gate.reason === "high_risk_topic" ? "high_risk" : "unresolved";
    await this.repository.createGateBlockedAttempt({
      messageId,
      trigger: "webhook_after",
      intent: gate.intent,
      riskLevel: "high",
      gateResult,
      gateReasons: [gate.reason],
      knowledgeVersion: this.knowledge.knowledgeVersion,
    });
    return { status: "blocked", code: gate.reason };
  }

  async generateImageAwareDraft(input: Readonly<{
    messageId: string;
    imageJobId: string;
    leaseToken: string;
    visualAssessment: string;
  }>): Promise<DraftGenerationResult> {
    const draftInput = await this.repository.loadDraftInput(input.messageId, 6);
    if (!draftInput) throw new Error("customer_service_message_not_found");
    if (draftInput.current.text === null) {
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: input.messageId,
        trigger: "webhook_after",
        intent: "image_only",
        riskLevel: "high",
        gateResult: "unresolved",
        gateReasons: ["image_only_without_text"],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return { status: "image_review_required", attemptId };
    }
    const gate = this.gateFor(draftInput.current.text, draftInput.context);
    if (!gate.providerAllowed) {
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: input.messageId,
        trigger: "webhook_after",
        intent: gate.intent,
        riskLevel: "high",
        gateResult: gate.decision === "REALTIME_DATA_REQUIRED"
          ? "realtime_required"
          : gate.reason === "high_risk_topic" ? "high_risk" : "unresolved",
        gateReasons: [gate.reason],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return {
        status: gate.decision === "REALTIME_DATA_REQUIRED" ? "realtime_required" : "gate_blocked",
        attemptId,
      };
    }
    const attemptId = await this.repository.createGateBlockedAttempt({
      messageId: input.messageId,
      trigger: "webhook_after",
      intent: gate.intent,
      riskLevel: "high",
      gateResult: "pilot_limit",
      gateReasons: ["image_manual_review_required"],
      knowledgeVersion: this.knowledge.knowledgeVersion,
    });
    return { status: "image_review_required", attemptId };
  }

  async generateDraft(
    request: DraftGenerationRequest,
    attachmentSourceContext?: readonly NormalizedAttachment[],
  ): Promise<DraftGenerationResult> {
    const draftInput = await this.repository.loadDraftInput(request.messageId, 6);
    if (!draftInput) throw new Error("customer_service_message_not_found");
    if (draftInput.current.text === null) {
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: request.messageId,
        trigger: request.trigger,
        intent: "image_only",
        riskLevel: "high",
        gateResult: "unresolved",
        gateReasons: ["image_only_without_text"],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return { status: "image_review_required", attemptId };
    }
    const gate = this.gateFor(draftInput.current.text, draftInput.context);
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

    const currentWebsiteInput = draftInput.current.channel === "website"
      ? sanitizeWebsiteModelInput(draftInput.current.text)
      : null;
    const websiteContextInputs = draftInput.current.channel === "website"
      ? draftInput.context.map((item) => sanitizeWebsiteModelInput(item.text))
      : [];
    if (currentWebsiteInput?.reviewRequired) {
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: request.messageId,
        trigger: request.trigger,
        intent: gate.intent,
        riskLevel: "high",
        gateResult: "unresolved",
        gateReasons: ["website_sensitive_input"],
        knowledgeVersion: this.knowledge.knowledgeVersion,
      });
      return { status: "gate_blocked", attemptId };
    }
    const providerContext = draftInput.current.channel === "website"
      ? draftInput.context.map((item, index) => ({
        ...item,
        text: websiteContextInputs[index].text,
      }))
      : draftInput.context;
    const providerQuery = draftInput.current.channel === "website"
      ? currentWebsiteInput?.text ?? ""
      : draftInput.current.text;

    const imageContext = await this.repository.selectImageContext(request.messageId);
    if (imageContext || attachmentSourceContext?.length) {
      const attemptId = await this.repository.createGateBlockedAttempt({
        messageId: request.messageId,
        trigger: request.trigger,
        intent: gate.intent,
        riskLevel: "high",
        gateResult: "pilot_limit",
        gateReasons: [imageContext?.hasUnsupportedAttachments
          ? "unsupported_attachment"
          : "image_manual_review_required"],
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
      ...(draftInput.current.channel === "website" ? {
        websiteDailyWarningMicrousd: this.budget.websiteDailyWarningMicrousd,
        websiteDailyHardStopMicrousd: this.budget.websiteDailyHardStopMicrousd,
        websiteTotalHardStopMicrousd: this.budget.websiteTotalHardStopMicrousd,
      } : {}),
    });
    if (reservation.status === "budget_blocked") {
      return { status: "budget_blocked", attemptId: reservation.attemptId };
    }
    if (reservation.status === "human_reply_received") {
      return { status: "human_reply_received", attemptId: reservation.attemptId };
    }

    let caseMemories: Awaited<ReturnType<CustomerServiceRepository["retrieveApprovedCaseMemories"]>> = [];
    try {
      caseMemories = await this.repository.retrieveApprovedCaseMemories({
        attemptId: reservation.attemptId,
        intent: gate.intent,
        riskClass: gate.riskLevel === "high" ? "medium" : gate.riskLevel,
        productCategory: null,
        market: "unknown",
        policyReferences: sources.rules.map((rule) => rule.id),
        knowledgeVersion: this.knowledge.knowledgeVersion,
        query: providerQuery,
        limit: 3,
        now: new Date(),
      });
    } catch {
      caseMemories = [];
    }
    const prompt = draftInput.current.channel === "website"
      ? buildWebsiteDecisionPrompt({
        intent: gate.intent,
        context: providerContext,
        productContext: draftInput.current.productContext ?? null,
        approvedCaseMemoryCount: caseMemories.length,
      })
      : buildDraftPrompt({
        intent: gate.intent,
        context: providerContext,
        rules: sources.rules,
        examples: sources.examples,
        goldenExamples: sources.goldenExamples,
        qualityGuide: sources.qualityGuide,
        toneGuide: this.knowledge.toneGuide,
        caseMemories,
      });
    const invocation = await this.repository.confirmProviderInvocation({
      attemptId: reservation.attemptId,
      dailyScopeKey,
    });
    if (invocation.status === "human_reply_received") {
      return { status: "human_reply_received", attemptId: reservation.attemptId };
    }
    try {
      const generated = await this.provider.generate(prompt);
      let candidateText = generated.text;
      if (draftInput.current.channel === "website") {
        const parsed = parseWebsiteDecision(generated.text);
        if (!parsed.ok) {
          await this.repository.completeProviderAttempt({
            attemptId: reservation.attemptId,
            status: "output_blocked",
            provider: generated.provider,
            model: generated.model,
            rejectedOutputHash: createHash("sha256").update(generated.text).digest("hex"),
            validatorCodes: [parsed.code],
            inputTokens: generated.usage.inputTokens,
            cachedInputTokens: generated.usage.cachedInputTokens,
            outputTokens: generated.usage.outputTokens,
            estimatedCostMicrousd: generated.estimatedCostMicrousd,
            latencyMs: generated.latencyMs,
            dailyScopeKey,
          });
          return { status: "output_blocked", attemptId: reservation.attemptId };
        }
        const acknowledgement = classifyAcknowledgement({
          currentText: draftInput.current.text,
          recentHistory: draftInput.context,
        });
        const rendered = renderWebsiteDecision({
          decision: parsed.decision,
          expectedIntent: gate.intent,
          productCategory: draftInput.current.productContext?.category ?? null,
          acknowledgementAllowed: acknowledgement.suppress,
          policyDecision: gate.decision,
        });
        if (rendered.ok && rendered.outcome === "no_reply") {
          await this.repository.completeProviderAttempt({
            attemptId: reservation.attemptId,
            status: "abandoned",
            provider: generated.provider,
            model: generated.model,
            validatorCodes: [],
            inputTokens: generated.usage.inputTokens,
            cachedInputTokens: generated.usage.cachedInputTokens,
            outputTokens: generated.usage.outputTokens,
            estimatedCostMicrousd: generated.estimatedCostMicrousd,
            latencyMs: generated.latencyMs,
            dailyScopeKey,
          });
          return { status: "no_reply_needed", attemptId: reservation.attemptId };
        }
        if (!rendered.ok || rendered.outcome !== "rendered") {
          const code = rendered.ok ? `website_decision_${rendered.outcome}` : rendered.code;
          await this.repository.completeProviderAttempt({
            attemptId: reservation.attemptId,
            status: "output_blocked",
            provider: generated.provider,
            model: generated.model,
            rejectedOutputHash: createHash("sha256").update(generated.text).digest("hex"),
            validatorCodes: [code],
            inputTokens: generated.usage.inputTokens,
            cachedInputTokens: generated.usage.cachedInputTokens,
            outputTokens: generated.usage.outputTokens,
            estimatedCostMicrousd: generated.estimatedCostMicrousd,
            latencyMs: generated.latencyMs,
            dailyScopeKey,
          });
          return { status: "output_blocked", attemptId: reservation.attemptId };
        }
        candidateText = rendered.text;
      }
      const textValidation = this.outputValidator(candidateText, {
        intent: gate.intent,
        ...(draftInput.current.channel === "website" ? { channel: "website" as const } : {}),
      });
      const validation = {
        ok: textValidation.ok,
        codes: textValidation.codes,
      };
      await this.repository.completeProviderAttempt({
        attemptId: reservation.attemptId,
        status: validation.ok ? "draft_ready" : "output_blocked",
        provider: generated.provider,
        model: generated.model,
        ...(validation.ok
          ? { draftText: candidateText }
          : {
            draftText: undefined,
            rejectedOutputHash: createHash("sha256").update(candidateText).digest("hex"),
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
        estimatedCostMicrousd: null,
        latencyMs: 0,
        providerErrorCode: "provider_request_failed",
        dailyScopeKey,
      });
      return { status: "provider_error", attemptId: reservation.attemptId };
    }
  }
}
