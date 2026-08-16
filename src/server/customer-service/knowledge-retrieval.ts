import type { PolicyGateResult, PolicyKnowledge, PolicyRule } from "./policy-gate";
import { validateDraft } from "./output-validator";

type ReplyExample = Readonly<{
  intent: string;
  customer: string;
  reply: string;
  risk: string;
  provenance: string;
}>;

export type GoldenReply = Readonly<{
  intent: string;
  customerQuestion: string;
  approvedAnswer: string;
}>;

export type AnswerQualityGuide = Readonly<{
  intent: string;
  minimumRequiredContent: readonly string[];
  recommendedDetailLevel: string;
  preferredStructure: readonly string[];
  usefulFollowUpQuestions: readonly string[];
  forbiddenClaims: readonly string[];
  requiredPoints: readonly Readonly<{
    id: string;
    description: string;
    matchAny: readonly string[];
  }>[];
  knowledgeRuleIds: readonly string[];
}>;

type RetrievalKnowledge = PolicyKnowledge & Readonly<{
  replyExamples: readonly ReplyExample[];
  goldenReplies: readonly GoldenReply[];
  qualityGuides: Readonly<Record<string, AnswerQualityGuide>>;
}>;

export function retrieveKnowledge({
  gate,
  knowledge,
}: Readonly<{ gate: PolicyGateResult; knowledge: RetrievalKnowledge }>): Readonly<{
  rules: readonly PolicyRule[];
  examples: readonly ReplyExample[];
  goldenExamples: readonly GoldenReply[];
  qualityGuide: AnswerQualityGuide | null;
}> {
  if (!gate.providerAllowed) {
    return { rules: [], examples: [], goldenExamples: [], qualityGuide: null };
  }

  const qualityGuide = knowledge.qualityGuides[gate.intent] ?? null;
  const bundleRuleIds = new Set([...gate.ruleIds, ...(qualityGuide?.knowledgeRuleIds ?? [])]);
  const rules = knowledge.rules.filter((rule) => (
    bundleRuleIds.has(rule.id)
    && rule.evidenceStatus === "CONFIRMED"
    && !rule.highRisk
    && rule.mayAnswerAutomatically
  ));
  const matching = knowledge.replyExamples.filter((example) => example.intent === gate.intent);
  const goldenExamples = knowledge.goldenReplies.filter((example) => (
    example.intent === gate.intent
    && validateDraft(example.approvedAnswer, { intent: gate.intent }).ok
  ));
  return {
    rules,
    examples: matching.slice(0, 2),
    goldenExamples: goldenExamples.slice(0, 2),
    qualityGuide,
  };
}
