export type ReplyRisk = "GREEN" | "YELLOW" | "RED";

export type FinalRiskInput = Readonly<{
  message: string;
  deterministicRisk?: ReplyRisk;
  knowledgeRisk?: ReplyRisk;
  toolRisk?: ReplyRisk;
  modelRisk: ReplyRisk;
  outputRisk?: ReplyRisk;
  channelRisk?: ReplyRisk;
  businessRuleStatuses?: readonly ("CONFIRMED" | "REVIEW")[];
  incompleteMaterialContext?: boolean;
  toolFailed?: boolean;
  unsupportedClaim?: boolean;
}>;

export type FinalRiskDecision = Readonly<{
  risk: ReplyRisk;
  autoReplyEligible: boolean;
  reasons: readonly string[];
}>;

const ordinal: Readonly<Record<ReplyRisk, number>> = {
  GREEN: 0,
  YELLOW: 1,
  RED: 2,
};

const redMessagePatterns = [
  /\brefund\b/i,
  /\bchargeback\b/i,
  /\blegal (?:action|threat)|\blawyer\b|\bsolicitor\b/i,
  /\bserious complaint\b/i,
  /\bdisputed? payment\b|\bcharged twice\b|\bduplicate charge\b/i,
  /\bspecial discount\b/i,
  /\bcompensation\b/i,
];

const yellowMessagePatterns = [
  /\bcomplex custom quote\b/i,
  /\b(?:today|tomorrow|urgent|tight deadline)\b/i,
  /\b(?:unusual|custom|split|weekly) payment (?:arrangement|plan)?\b/i,
  /\b(?:major|significant) revision\b/i,
];

function deterministicMessageRisk(message: string): ReplyRisk {
  if (redMessagePatterns.some((pattern) => pattern.test(message))) return "RED";
  if (yellowMessagePatterns.some((pattern) => pattern.test(message))) return "YELLOW";
  return "GREEN";
}

function maximum(risks: readonly ReplyRisk[]) {
  return risks.reduce<ReplyRisk>((highest, risk) => (
    ordinal[risk] > ordinal[highest] ? risk : highest
  ), "GREEN");
}

export function evaluateFinalRisk(input: FinalRiskInput): FinalRiskDecision {
  const reasons: string[] = [];
  const deterministicRisk = maximum([
    deterministicMessageRisk(input.message),
    input.deterministicRisk ?? "GREEN",
  ]);
  if (deterministicRisk !== "GREEN") reasons.push("deterministic_risk");

  const reviewRule = input.businessRuleStatuses?.includes("REVIEW") ?? false;
  if (reviewRule) reasons.push("business_rule_review");
  if (input.incompleteMaterialContext) reasons.push("incomplete_material_context");
  if (input.toolFailed) reasons.push("tool_failure");
  if (input.unsupportedClaim) reasons.push("unsupported_claim");

  const risk = maximum([
    deterministicRisk,
    input.knowledgeRisk ?? "GREEN",
    input.toolRisk ?? "GREEN",
    input.modelRisk,
    input.outputRisk ?? "GREEN",
    input.channelRisk ?? "GREEN",
    reviewRule ? "YELLOW" : "GREEN",
    input.incompleteMaterialContext ? "YELLOW" : "GREEN",
    input.toolFailed ? "RED" : "GREEN",
    input.unsupportedClaim ? "RED" : "GREEN",
  ]);

  return Object.freeze({
    risk,
    autoReplyEligible: risk === "GREEN",
    reasons: Object.freeze(reasons),
  });
}
