import { createHash } from "node:crypto";
import type { CustomerServiceIntent } from "@/server/customer-service/intent-detection";
import type { AiProviderResult } from "@/server/customer-service/providers/ai-provider";
import type {
  AllowedFact,
  HumanReviewReason,
  ProductType,
  WebsiteDecision,
} from "@/server/customer-service/website/structured-decision";
import type { CompiledBusinessBrain } from "../business-brain/schema";
import type { RnrAiDecision, RnrAiRequest } from "../types";

export type WebsiteBrainInput = Readonly<{
  current: Readonly<{
    id: string;
    text: string | null;
    pageMarket?: "NZ" | "AU" | null;
    productContext?: Readonly<{ category: "canvas" | "banners" }> | null;
  }>;
  context: readonly Readonly<{
    role: "customer" | "staff";
    text: string;
    receivedAt: string;
  }>[];
  expectedIntent: CustomerServiceIntent;
}>;

export type WebsiteBrainAdapter = Readonly<{
  generate(input: WebsiteBrainInput): Promise<AiProviderResult>;
}>;

type Brain = Readonly<{ generate(request: RnrAiRequest): Promise<RnrAiDecision> }>;

const LOCAL_FACTS: Readonly<Record<string, Readonly<Partial<Record<CustomerServiceIntent, AllowedFact>>>>> =
  Object.freeze({
    "design-capabilities": Object.freeze({
      photo_guidance: "PHOTO_COMBINE_SUBJECTS",
      design_process: "DESIGN_INPUTS",
    }),
    "workflow-proof-before-print": Object.freeze({
      design_process: "DESIGN_DRAFT_REVIEW_BEFORE_PRINTING",
    }),
    "production-standard-target": Object.freeze({
      production_process: "PRODUCTION_AFTER_APPROVAL",
    }),
    "website-payment-flow": Object.freeze({
      payment_process: "PAYMENT_DEPOSIT_STARTS_DESIGN",
    }),
    "image-integrity": Object.freeze({
      photo_guidance: "PHOTO_QUALITY_ASSESSMENT",
    }),
  });

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function productType(input: WebsiteBrainInput): ProductType {
  if (input.current.productContext?.category === "canvas") return "CANVAS";
  if (input.current.productContext?.category === "banners") return "BANNER";
  return "UNSPECIFIED";
}

function reviewDecision(
  input: WebsiteBrainInput,
  reason: HumanReviewReason,
): WebsiteDecision {
  return Object.freeze({
    response_type: "HUMAN_REVIEW_REQUIRED",
    intent: input.expectedIntent,
    product_type: productType(input),
    missing_fields: Object.freeze([]),
    follow_up_fields: Object.freeze([]),
    allowed_facts: Object.freeze([]),
    human_review_reason: reason,
  });
}

function mapDecision(input: WebsiteBrainInput, decision: RnrAiDecision): WebsiteDecision {
  if (decision.nextAction === "NO_REPLY") {
    return Object.freeze({
      response_type: "NO_REPLY_NEEDED",
      intent: input.expectedIntent,
      product_type: productType(input),
      missing_fields: Object.freeze([]),
      follow_up_fields: Object.freeze([]),
      allowed_facts: Object.freeze([]),
      human_review_reason: "NONE",
    });
  }
  if (decision.risk !== "GREEN" || decision.nextAction !== "AUTO_REPLY_ELIGIBLE") {
    return reviewDecision(input, decision.risk === "RED" ? "HIGH_RISK" : "MODEL_UNCERTAIN");
  }

  const facts = [...new Set(decision.claims.flatMap((claim) => {
    const fact = LOCAL_FACTS[claim.sourceId]?.[input.expectedIntent];
    return fact ? [fact] : [];
  }))];
  if (facts.length === 0) return reviewDecision(input, "MODEL_UNCERTAIN");

  return Object.freeze({
    response_type: "ANSWER_SAFE",
    intent: input.expectedIntent,
    product_type: productType(input),
    missing_fields: Object.freeze([]),
    follow_up_fields: Object.freeze([]),
    allowed_facts: Object.freeze(facts),
    human_review_reason: "NONE",
  });
}

export function createWebsiteBrainAdapter(input: Readonly<{
  brain: Brain;
  businessBrain: CompiledBusinessBrain;
}>): WebsiteBrainAdapter {
  return Object.freeze({
    async generate(request): Promise<AiProviderResult> {
      const startedAt = Date.now();
      const decision = await input.brain.generate({
        channel: "website",
        market: request.current.pageMarket ?? "UNKNOWN",
        conversation: Object.freeze(request.context.map((turn, index) => Object.freeze({
          providerMessageKey: hash(`${request.current.id}\0${index}\0${turn.receivedAt}\0${turn.role}`),
          role: turn.role,
          sentAt: turn.receivedAt,
          text: turn.text,
          channel: "website" as const,
          attachmentOrdinals: Object.freeze([]),
        }))),
        attachments: Object.freeze([]),
        businessBrain: input.businessBrain,
        toolContext: Object.freeze({ conversationKeyHash: hash(request.current.id) }),
      });
      const usage = decision.providerRun?.usage ?? Object.freeze({
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      return Object.freeze({
        text: JSON.stringify(mapDecision(request, decision)),
        provider: "openai",
        model: decision.providerRun?.model ?? "gpt-5.6-sol",
        usage,
        estimatedCostMicrousd: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    },
  });
}
