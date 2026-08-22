import { buildLearningCandidateProposal } from "./learning-candidate";

type SummaryMatch = Readonly<{
  caseId: string;
  conversationKeyHash: string;
  intent: string;
  editReasonCodes: readonly string[];
  approvedLowRisk: boolean;
}>;

const safeProposal: Record<string, string> = {
  missing_next_step: "Include one useful next step when the confirmed rules support it.",
  too_long: "Use the shortest reply that still includes the required information.",
  too_generic: "Add the confirmed product or process details relevant to the question.",
  tone_too_formal: "Use Ronnie's short, warm and practical customer-service tone.",
};

export function buildLearningSummary(
  matches: readonly SummaryMatch[],
  minimumMatchedReplies = 50,
  matchedReplyCount = matches.length,
) {
  if (!Number.isSafeInteger(minimumMatchedReplies) || minimumMatchedReplies < 3) {
    throw new Error("learning_summary_threshold_invalid");
  }
  if (!Number.isSafeInteger(matchedReplyCount) || matchedReplyCount < matches.length) {
    throw new Error("learning_summary_match_count_invalid");
  }
  if (matchedReplyCount < minimumMatchedReplies) return null;
  const counts = new Map<string, number>();
  const groups = new Map<string, SummaryMatch[]>();
  for (const match of matches) {
    for (const reason of match.editReasonCodes) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      const key = `${match.intent}\n${reason}`;
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
  }
  const commonEditReasons = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  const candidates = [...groups.entries()].flatMap(([key, evidence]) => {
    const approved = evidence.filter((item) => item.approvedLowRisk);
    const [intent, reasonCode] = key.split("\n");
    const proposal = buildLearningCandidateProposal({
      intent,
      reasonCode,
      proposedChange: safeProposal[reasonCode] ?? "Review this repeated edit pattern before changing the approved guidance.",
      caseIds: approved.map((item) => item.caseId),
      conversationCount: new Set(approved.map((item) => item.conversationKeyHash)).size,
      allApprovedLowRisk: approved.length === evidence.length,
    });
    return proposal ? [{ ...proposal, requiresAdminApproval: true as const }] : [];
  });
  return Object.freeze({
    matchedReplies: matchedReplyCount,
    commonEditReasons: Object.freeze(commonEditReasons),
    candidates: Object.freeze(candidates),
  });
}
