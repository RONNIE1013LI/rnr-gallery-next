import type { ConversationState } from "./conversation/conversation-state";
import type { AnswerQualityGuide } from "./knowledge-retrieval";
import type { PolicyGateResult } from "./policy-gate";
import type { ApprovedPricingResolution } from "./pricing-source";
import { getWebsiteDecisionPromptContract } from "./website/structured-decision";

export type ResolvedBusinessContext = Readonly<{
  version: 1;
  conversation: Readonly<{
    intent: string;
    market: "NZ" | "AU" | null;
    productKey: string | null;
    productCandidates: readonly string[];
    size: string | null;
    peoplePets: number | null;
    photoCount: number | null;
    missingFields: readonly string[];
    asksCataloguePrice: boolean;
  }>;
  knowledge: Readonly<{
    version: string;
    ruleIds: readonly string[];
    qualityGuideId: string | null;
    qualityRequirementIds: readonly string[];
  }>;
  canonicalQuote:
    | Readonly<{ status: "not_requested" }>
    | Readonly<{
      status: "clarification_required";
      sourceRevision: number;
      missing: readonly string[];
    }>
    | Readonly<{
      status: "verified";
      sourceRevision: number;
      facts: readonly Readonly<{
        productKey: string;
        sizeKey: string;
        peoplePets?: number;
        currency: "NZD" | "AUD";
      }>[];
    }>
    | Readonly<{ status: "unavailable"; reason: string }>;
  decision: Readonly<{
    allowedFactIds: readonly string[];
    allowedFollowUpFields: readonly string[];
    policy: Readonly<{
      decision: PolicyGateResult["decision"];
      reason: string;
    }>;
    handoff: Readonly<{
      required: boolean;
      reason: string | null;
    }>;
  }>;
}>;

export function pricingMissingFieldToFollowUp(field: "market" | "product" | "size" | "peoplePets") {
  if (field === "product") return "PRODUCT_TYPE";
  if (field === "peoplePets") return "PEOPLE_COUNT";
  return field.toUpperCase();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export function resolveBusinessContext(input: Readonly<{
  conversationState: ConversationState;
  gate: PolicyGateResult;
  knowledgeVersion: string;
  rules: readonly Readonly<{ id: string }>[];
  qualityGuide: AnswerQualityGuide | null;
  approvedPricing: ApprovedPricingResolution | null;
}>): ResolvedBusinessContext {
  const contract = getWebsiteDecisionPromptContract(input.gate.intent);
  const canonicalQuote: ResolvedBusinessContext["canonicalQuote"] = !input.approvedPricing
    ? { status: "not_requested" }
    : input.approvedPricing.status === "verified"
      ? {
        status: "verified",
        sourceRevision: input.approvedPricing.sourceRevision,
        facts: input.approvedPricing.facts.map((fact) => ({
          productKey: fact.productKey,
          sizeKey: fact.sizeKey,
          ...(fact.peoplePets === undefined ? {} : { peoplePets: fact.peoplePets }),
          currency: fact.currency,
        })),
      }
      : input.approvedPricing.status === "clarification_required"
        ? {
          status: "clarification_required",
          sourceRevision: input.approvedPricing.sourceRevision,
          missing: [...input.approvedPricing.missing],
        }
        : { status: "unavailable", reason: input.approvedPricing.reason };
  const allowedFactIds = input.approvedPricing?.status === "verified"
    ? ["APPROVED_CATALOGUE_PRICE"]
    : input.approvedPricing?.status === "clarification_required"
      ? []
      : contract.allowedFacts.filter((fact) => fact !== "APPROVED_CATALOGUE_PRICE");
  const allowedFollowUpFields = input.approvedPricing?.status === "verified"
    ? []
    : input.approvedPricing?.status === "clarification_required"
      ? input.approvedPricing.missing.map(pricingMissingFieldToFollowUp)
      : contract.followUpFields;
  const handoffRequired = input.gate.decision !== "DRAFT_ALLOWED";

  return deepFreeze({
    version: 1,
    conversation: {
      intent: input.conversationState.intent.value,
      market: input.conversationState.market?.value ?? null,
      productKey: input.conversationState.product?.productKey ?? null,
      productCandidates: [...input.conversationState.productCandidates],
      size: input.conversationState.size?.value ?? null,
      peoplePets: input.conversationState.peoplePets?.value ?? null,
      photoCount: input.conversationState.photoCount?.value ?? null,
      missingFields: [...input.conversationState.missingFields],
      asksCataloguePrice: input.conversationState.asksCataloguePrice,
    },
    knowledge: {
      version: input.knowledgeVersion,
      ruleIds: input.rules.map((rule) => rule.id),
      qualityGuideId: input.qualityGuide?.intent ?? null,
      qualityRequirementIds: input.qualityGuide?.requiredPoints.map((point) => point.id) ?? [],
    },
    canonicalQuote,
    decision: {
      allowedFactIds,
      allowedFollowUpFields,
      policy: { decision: input.gate.decision, reason: input.gate.reason },
      handoff: { required: handoffRequired, reason: handoffRequired ? input.gate.reason : null },
    },
  });
}
