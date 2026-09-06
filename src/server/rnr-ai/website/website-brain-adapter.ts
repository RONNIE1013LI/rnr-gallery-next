import { BRAIN_BUDGET_MS, type ReasoningExecutionOptions } from "../reasoning/brain";
import { createHash } from "node:crypto";
import type { CustomerServiceIntent } from "@/server/customer-service/intent-detection";
import type { AiProviderResult } from "@/server/customer-service/providers/ai-provider";
import type { CompiledBusinessBrain } from "../business-brain/schema";
import type { RnrAiDecision, RnrAiRequest } from "../types";

export type WebsiteBrainInput = Readonly<{
  current: Readonly<{
    id: string;
    text: string | null;
    pageMarket?: "NZ" | "AU" | null;
    productContext?: Readonly<{ productKey?: string; category: "canvas" | "banners" }> | null;
  }>;
  context: readonly Readonly<{
    role: "customer" | "staff";
    text: string;
    receivedAt: string;
  }>[];
  expectedIntent: CustomerServiceIntent;
}>;

export type WebsiteBrainAdapter = Readonly<{
  generate(input: WebsiteBrainInput): Promise<WebsiteBrainResult>;
}>;

type Brain = Readonly<{ generate(request: RnrAiRequest, execution?: ReasoningExecutionOptions): Promise<RnrAiDecision> }>;

export type WebsiteBrainResult = AiProviderResult & Readonly<{ decision: RnrAiDecision }>;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createWebsiteBrainAdapter(input: Readonly<{
  brain: Brain;
  businessBrain: CompiledBusinessBrain;
}>): WebsiteBrainAdapter {
  return Object.freeze({
    async generate(request): Promise<WebsiteBrainResult> {
      const startedAt = Date.now();
      const decision = await input.brain.generate({
        channel: "website",
        market: request.current.pageMarket ?? "UNKNOWN",
        conversation: Object.freeze(request.context.map((turn, index) => Object.freeze({
          providerMessageKey: `${String(index).padStart(10, "0")}-${hash(`${request.current.id}\0${index}\0${turn.receivedAt}\0${turn.role}`)}`,
          role: turn.role,
          sentAt: turn.receivedAt,
          text: turn.text,
          channel: "website" as const,
          attachmentOrdinals: Object.freeze([]),
        }))),
        attachments: Object.freeze([]),
        pageContext: request.current.productContext ? {
          productKey: request.current.productContext.productKey,
          category: request.current.productContext.category,
        } : null,
        businessBrain: input.businessBrain,
        toolContext: Object.freeze({ conversationKeyHash: hash(request.current.id) }),
      }, { deadlineAt: startedAt + BRAIN_BUDGET_MS });
      const usage = decision.providerRun?.usage ?? Object.freeze({
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      return Object.freeze({
        text: decision.replyText ?? "",
        decision,
        provider: "openai",
        model: decision.providerRun?.model ?? "gpt-5.6-luna",
        usage,
        estimatedCostMicrousd: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    },
  });
}
