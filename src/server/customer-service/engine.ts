import { createHash } from "node:crypto";
import { evaluatePolicyGate, type PolicyKnowledge } from "./policy-gate";
import { retrieveKnowledge } from "./knowledge-retrieval";
import { validateDraft } from "./output-validator";
import { buildDraftPrompt } from "./prompt-builder";
import { localDateScopeKey } from "./usage-cost";
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
}>;

export class CustomerServiceEngine {
  private readonly repository: CustomerServiceRepository;
  private readonly provider: AiProvider;
  private readonly knowledge: EngineKnowledge;
  private readonly budget: Readonly<{
    reservationMicrousd: number;
    dailyHardStopMicrousd: number;
    totalHardStopMicrousd: number;
  }>;

  constructor(input: Readonly<{
    repository: CustomerServiceRepository;
    provider: AiProvider;
    knowledge: EngineKnowledge;
    budget: Readonly<{
      reservationMicrousd: number;
      dailyHardStopMicrousd: number;
      totalHardStopMicrousd: number;
    }>;
  }>) {
    this.repository = input.repository;
    this.provider = input.provider;
    this.knowledge = input.knowledge;
    this.budget = input.budget;
  }

  async generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult> {
    const draftInput = await this.repository.loadDraftInput(request.messageId, 6);
    if (!draftInput) throw new Error("customer_service_message_not_found");
    const gate = evaluatePolicyGate({ message: draftInput.current.body, knowledge: this.knowledge });
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
      toneGuide: this.knowledge.toneGuide,
    });
    try {
      const generated = await this.provider.generate(prompt);
      const validation = validateDraft(generated.text, { intent: gate.intent });
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
