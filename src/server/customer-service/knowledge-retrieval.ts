import type { PolicyGateResult, PolicyKnowledge, PolicyRule } from "./policy-gate";

type ReplyExample = Readonly<{
  intent: string;
  customer: string;
  reply: string;
  risk: string;
  provenance: string;
}>;

type RetrievalKnowledge = PolicyKnowledge & Readonly<{
  replyExamples: readonly ReplyExample[];
}>;

export function retrieveKnowledge({
  gate,
  knowledge,
}: Readonly<{ gate: PolicyGateResult; knowledge: RetrievalKnowledge }>): Readonly<{
  rules: readonly PolicyRule[];
  examples: readonly ReplyExample[];
}> {
  if (!gate.providerAllowed) return { rules: [], examples: [] };

  const rules = gate.selectedRules.filter((rule) => rule.evidenceStatus === "CONFIRMED");
  const matching = knowledge.replyExamples.filter((example) => example.intent === gate.intent);
  return { rules, examples: matching.slice(0, 3) };
}
