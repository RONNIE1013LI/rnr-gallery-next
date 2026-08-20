import { createHash } from "node:crypto";

export function buildLearningCandidateProposal(input: Readonly<{
  intent: string;
  reasonCode: string;
  proposedChange: string;
  caseIds: readonly string[];
  conversationCount: number;
  allApprovedLowRisk: boolean;
}>) {
  const distinctCases = [...new Set(input.caseIds)].sort();
  if (!input.allApprovedLowRisk || distinctCases.length < 3 || input.conversationCount < 3) return null;
  return Object.freeze({
    candidateKind: "answer_quality_rule" as const,
    intent: input.intent,
    proposedChange: input.proposedChange.trim(),
    evidenceCount: distinctCases.length,
    distinctCaseCount: input.conversationCount,
    reasonCodes: Object.freeze([input.reasonCode]),
    sourceCaseMemoryIds: Object.freeze(distinctCases),
    evidenceSignature: createHash("sha256").update([
      input.intent, input.reasonCode, ...distinctCases,
    ].join("\n")).digest("hex"),
    status: "pending" as const,
  });
}
