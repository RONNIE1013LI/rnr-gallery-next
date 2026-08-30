import {
  buildLearningCandidateProposal,
  getLearningPatternDefinition,
  MAX_LEARNING_CANDIDATE_EVIDENCE,
  type LearningPatternCode,
} from "./learning-candidate";

export type LearningSummaryMatch = Readonly<{
  caseId: string;
  conversationKeyHash: string;
  intent: string;
  editReasonCodes: readonly string[];
  approvedLowRisk: boolean;
  normalizedSituation?: string;
  aiDraft?: string | null;
  humanFinalReply?: string;
  editClassification?: string;
}>;

type DetectedLearningPattern = Readonly<{
  code: LearningPatternCode;
  intent: string;
}>;

const normalized = (value: string | null | undefined) => (value ?? "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s?-]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const wordCount = (value: string) => normalized(value).split(" ").filter(Boolean).length;

function asksForQuoteDetail(value: string) {
  const text = normalized(value);
  return [
    /\bsize\b/, /\bpeople\b/, /\bperson\b/, /\bphotos?\b/, /\bdate\b/, /\bwording\b/,
    /\bthemes?\b/, /\bproducts?\b/, /\bcanvas\b/, /\bbanners?\b/, /\bquantity\b/,
    /\bpostcodes?\b/, /\bsuburbs?\b/, /\blocations?\b/,
  ].some((pattern) => pattern.test(text));
}

function quoteDetailCount(value: string) {
  const text = normalized(value);
  return [
    /\bsize\b/, /\b(?:people|person)\b/, /\bphotos?\b/, /\bdate\b/, /\bwording\b/,
    /\bthemes?\b/, /\b(?:product|canvas|banner)s?\b/, /\bquantity\b/,
    /\b(?:postcode|suburb|location)s?\b/,
  ].filter((pattern) => pattern.test(text)).length;
}

export function detectLearningPattern(match: LearningSummaryMatch): DetectedLearningPattern | null {
  const specificReason = match.editReasonCodes.find((reason) => reason !== "independent_human_reply"
    && getLearningPatternDefinition(reason));
  if (specificReason) return { code: specificReason as LearningPatternCode, intent: match.intent };
  if (!match.editReasonCodes.includes("independent_human_reply")) return null;

  const human = normalized(match.humanFinalReply);
  const ai = normalized(match.aiDraft);
  if (!human) return null;

  if (match.intent === "design_process"
    && /\bphotos?\b/.test(human) && /\bwording\b/.test(human) && /\bthemes?\b/.test(human)) {
    return { code: "design_collect_photos_wording_theme", intent: "design_process" };
  }

  if (match.intent === "quote_information_collection") {
    const hasMarket = /\b(?:nz|new zealand|au|australia)\b/.test(human);
    const hasBannerFormat = /\broll[ -]?up\b/.test(human)
      && /\bwall[ -]?(?:hanging|hung|banner)\b/.test(human);
    if (hasMarket && hasBannerFormat) {
      return { code: "quote_confirm_market_and_banner_format", intent: "quote_information_collection" };
    }
    if (human.includes("?") && wordCount(human) <= 30 && asksForQuoteDetail(human)
      && (quoteDetailCount(ai) >= 3 || normalized(match.normalizedSituation).includes("already"))) {
      return { code: "quote_ask_next_missing_detail", intent: "quote_information_collection" };
    }
  }

  const acknowledgement = /^(?:thanks?|thank you|you(?: re| are) welcome|no worries|all good|perfect|great|okay|ok)\b/.test(human);
  if (acknowledgement && !human.includes("?") && wordCount(human) <= 12
    && (ai.includes("?") || wordCount(ai) >= wordCount(human) + 8)) {
    return { code: "tone_concise_acknowledgement", intent: "tone_adjustment" };
  }
  return null;
}

export function buildLearningSummary(
  matches: readonly LearningSummaryMatch[],
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
  const groups = new Map<string, { pattern: DetectedLearningPattern; evidence: LearningSummaryMatch[] }>();
  for (const match of matches) {
    for (const reason of match.editReasonCodes) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    const pattern = detectLearningPattern(match);
    if (!pattern) continue;
    const key = `${pattern.intent}\n${pattern.code}`;
    const existing = groups.get(key);
    groups.set(key, { pattern, evidence: [...(existing?.evidence ?? []), match] });
  }
  const commonEditReasons = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  const candidates = [...groups.values()].flatMap(({ pattern, evidence }) => {
    const approved = evidence.filter((item) => item.approvedLowRisk);
    const sortedApproved = [...approved].sort((left, right) => left.caseId.localeCompare(right.caseId));
    const firstPerConversation = new Map<string, LearningSummaryMatch>();
    for (const item of sortedApproved) {
      if (!firstPerConversation.has(item.conversationKeyHash)) firstPerConversation.set(item.conversationKeyHash, item);
    }
    const diverseEvidence = [...firstPerConversation.values()];
    const diverseIds = new Set(diverseEvidence.map((item) => item.caseId));
    const selectedApproved = [...diverseEvidence, ...sortedApproved.filter((item) => !diverseIds.has(item.caseId))]
      .slice(0, MAX_LEARNING_CANDIDATE_EVIDENCE);
    const definition = getLearningPatternDefinition(pattern.code);
    const proposal = definition ? buildLearningCandidateProposal({
      intent: pattern.intent,
      reasonCode: pattern.code,
      proposedChange: definition.proposedGuidance,
      caseIds: selectedApproved.map((item) => item.caseId),
      conversationCount: new Set(selectedApproved.map((item) => item.conversationKeyHash)).size,
      allApprovedLowRisk: approved.length === evidence.length,
    }) : null;
    return proposal ? [{ ...proposal, requiresAdminApproval: true as const }] : [];
  });
  return Object.freeze({
    matchedReplies: matchedReplyCount,
    commonEditReasons: Object.freeze(commonEditReasons),
    candidates: Object.freeze(candidates),
  });
}
