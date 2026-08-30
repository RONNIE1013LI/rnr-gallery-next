import { createHash } from "node:crypto";
import { assessCaseMemoryEligibility } from "./case-memory";

const PLACEHOLDER_GUIDANCE = "Review this repeated edit pattern before changing the approved guidance.";
export const LEARNING_PATTERN_VERSION = "learning-pattern-v2";
export const MAX_LEARNING_CANDIDATE_EVIDENCE = 25;
export const MAX_LEARNING_CANDIDATE_SUPPORTING_CASES = 5;

type LearningPatternDefinition = Readonly<{
  intent: string | null;
  observedPattern: string;
  proposedGuidance: string;
  detectedChange: string;
}>;

export const LEARNING_PATTERN_DEFINITIONS = Object.freeze({
  missing_next_step: Object.freeze({
    intent: null,
    observedPattern: "Across approved cases, human replies added a useful next step that the AI draft omitted.",
    proposedGuidance: "Include one useful next step when the confirmed rules support it.",
    detectedChange: "Human reply added a supported next step that was missing from the AI draft.",
  }),
  too_long: Object.freeze({
    intent: null,
    observedPattern: "Across approved cases, human replies removed unnecessary detail while preserving the required answer.",
    proposedGuidance: "Use the shortest reply that still includes the required information.",
    detectedChange: "Human reply made the answer shorter without removing required information.",
  }),
  too_generic: Object.freeze({
    intent: null,
    observedPattern: "Across approved cases, human replies replaced generic wording with relevant confirmed product or process details.",
    proposedGuidance: "Add the confirmed product or process details relevant to the question.",
    detectedChange: "Human reply replaced generic wording with relevant confirmed details.",
  }),
  tone_too_formal: Object.freeze({
    intent: null,
    observedPattern: "Across approved cases, human replies used a shorter, warmer and more practical tone than the AI draft.",
    proposedGuidance: "Use Ronnie's short, warm and practical customer-service tone.",
    detectedChange: "Human reply changed the draft to a shorter, warmer and more practical tone.",
  }),
  quote_confirm_market_and_banner_format: Object.freeze({
    intent: "quote_information_collection",
    observedPattern: "For banner price enquiries missing market and format, human replies first confirm NZ or Australia and roll-up versus wall-hanging.",
    proposedGuidance: "For banner price enquiries that lack market or format, first confirm NZ or Australia and whether the customer needs a roll-up or wall-hanging banner. Do not request the full quote checklist at once.",
    detectedChange: "Human reply narrowed the first step to market and banner format instead of requesting the full quote checklist.",
  }),
  quote_ask_next_missing_detail: Object.freeze({
    intent: "quote_information_collection",
    observedPattern: "When customers already supplied part of the quote information, human replies ask only for the next essential missing detail.",
    proposedGuidance: "When a customer has already supplied some quote information, acknowledge it and ask only for the next essential missing detail instead of repeating the full quote checklist.",
    detectedChange: "Human reply acknowledged known quote information and asked only for the next missing detail.",
  }),
  design_collect_photos_wording_theme: Object.freeze({
    intent: "design_process",
    observedPattern: "For customers starting a custom design, human replies consistently ask for photos, wording and the preferred theme.",
    proposedGuidance: "When a customer asks how to start a custom design and these details are missing, collect the required photos, wording and preferred theme.",
    detectedChange: "Human reply replaced an unrelated or incomplete draft with the three relevant design inputs: photos, wording and theme.",
  }),
  tone_concise_acknowledgement: Object.freeze({
    intent: "tone_adjustment",
    observedPattern: "When no further action was needed, human replies used a concise acknowledgement instead of adding an unrelated next step.",
    proposedGuidance: "When the customer is only acknowledging or thanking the team and no action is needed, use a concise acknowledgement without adding an unrelated next step.",
    detectedChange: "Human reply removed an unnecessary next step and kept only a concise acknowledgement.",
  }),
} satisfies Readonly<Record<string, LearningPatternDefinition>>);

export type LearningPatternCode = keyof typeof LEARNING_PATTERN_DEFINITIONS;

export function getLearningPatternDefinition(code: string) {
  return Object.prototype.hasOwnProperty.call(LEARNING_PATTERN_DEFINITIONS, code)
    ? LEARNING_PATTERN_DEFINITIONS[code as LearningPatternCode]
    : null;
}

export function isApprovedLearningGuidance(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (text.length < 20 || text.length > 800 || text === PLACEHOLDER_GUIDANCE) return false;
  if (/\b(?:automatically|auto)\b/i.test(text)) {
    return false;
  }
  if (/(?:\b(?:without|with no|no)(?: (?:human|staff))? review\b|\b(?:without|with no|no) approval\b|\bbefore (?:anyone|a human|staff|the team) reviews?\b)/i.test(text)) {
    return false;
  }
  const outboundCommand = "(?:send(?:s|ing)?|respond(?:s|ed|ing)?|repl(?:y|ies|ied|ying)|answer(?:s|ed|ing)?|contact(?:s|ed|ing)?)";
  if (new RegExp(`(?:^|[.!?]\\s+)(?:(?:please|kindly|always|immediately|keep)\\s+)*${outboundCommand}\\b`, "i").test(text)) {
    return false;
  }
  return assessCaseMemoryEligibility({
    riskClass: "low",
    gateReasons: [],
    customerSituation: "",
    humanReply: text,
    redactionCodes: [],
  }).eligible;
}

export function buildLearningCandidateEvidenceSignature(input: Readonly<{
  candidateKind: string;
  intent: string;
  reasonCode: string;
  proposedChange: string;
}>) {
  return createHash("md5").update([
    LEARNING_PATTERN_VERSION,
    input.candidateKind,
    input.intent,
    input.reasonCode,
    input.proposedChange.trim(),
  ].join("\n")).digest("hex");
}

export function isActionableLearningCandidate(input: Readonly<{
  candidateKind: string;
  intent: string;
  proposedChange: string;
  reasonCodes: readonly string[];
  evidenceCount: number;
  distinctCaseCount: number;
  sourceCaseMemoryIds: readonly string[];
  evidenceSignature: string;
}>) {
  if (input.reasonCodes.length !== 1 || !Number.isSafeInteger(input.evidenceCount)
    || !Number.isSafeInteger(input.distinctCaseCount)) return false;
  const definition = getLearningPatternDefinition(input.reasonCodes[0]);
  const distinctCases = new Set(input.sourceCaseMemoryIds);
  return Boolean(
    definition
    && input.candidateKind === "answer_quality_rule"
    && (!definition.intent || definition.intent === input.intent)
    && input.proposedChange === definition.proposedGuidance
    && input.evidenceCount >= 3
    && input.evidenceCount <= MAX_LEARNING_CANDIDATE_EVIDENCE
    && input.sourceCaseMemoryIds.length === input.evidenceCount
    && input.evidenceCount === distinctCases.size
    && input.distinctCaseCount >= 3
    && input.distinctCaseCount <= input.evidenceCount
    && input.evidenceSignature === buildLearningCandidateEvidenceSignature({
      candidateKind: input.candidateKind,
      intent: input.intent,
      reasonCode: input.reasonCodes[0],
      proposedChange: input.proposedChange,
    }),
  );
}

export function buildLearningCandidateProposal(input: Readonly<{
  intent: string;
  reasonCode: string;
  proposedChange: string;
  caseIds: readonly string[];
  conversationCount: number;
  allApprovedLowRisk: boolean;
}>) {
  const definition = getLearningPatternDefinition(input.reasonCode);
  const distinctCases = [...new Set(input.caseIds)].sort().slice(0, MAX_LEARNING_CANDIDATE_EVIDENCE);
  if (!definition || !input.allApprovedLowRisk || distinctCases.length < 3 || input.conversationCount < 3
    || (definition.intent && definition.intent !== input.intent)
    || input.proposedChange.trim() !== definition.proposedGuidance) return null;
  const proposal = Object.freeze({
    candidateKind: "answer_quality_rule" as const,
    intent: input.intent,
    observedPattern: definition.observedPattern,
    proposedChange: definition.proposedGuidance,
    evidenceCount: distinctCases.length,
    distinctCaseCount: input.conversationCount,
    reasonCodes: Object.freeze([input.reasonCode]),
    sourceCaseMemoryIds: Object.freeze(distinctCases),
    evidenceSignature: buildLearningCandidateEvidenceSignature({
      candidateKind: "answer_quality_rule",
      intent: input.intent,
      reasonCode: input.reasonCode,
      proposedChange: definition.proposedGuidance,
    }),
    status: "pending" as const,
  });
  return isActionableLearningCandidate(proposal) ? proposal : null;
}
