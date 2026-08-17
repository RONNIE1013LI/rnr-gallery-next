export type ImageDraftValidationResult = Readonly<{
  ok: boolean;
  codes: readonly string[];
}>;

type ImageClaimCode =
  | "visual_restoration_claim"
  | "visual_print_suitability_claim";

type ClaimClassifier = Readonly<{
  code: ImageClaimCode;
  candidates: readonly RegExp[];
}>;

const modifiers = String.raw`(?:(?:[a-z]+ly|not|never|yet)\s+)*`;
const imageSubject = String.raw`(?:photo|image|picture|file|it|this|that)`;
const qualifiedImageSubject = String.raw`(?:(?:this|that|the|your)\s+)?${imageSubject}`;
const restorationResult = String.raw`(?:restore(?:d)?|fix(?:ed)?|repair(?:ed)?)`;
const printAssessment = String.raw`(?:perfect|ideal|ready|suitable)`;
const printPurpose = String.raw`(?:for\s+print(?:ing)?|to\s+print)`;
const activeAgent = String.raw`(?:we(?:'ll|\s+(?:will|can))|i(?:'ll|\s+(?:will|can))|our\s+team\s+(?:will|can))`;
const printReadyResult = String.raw`(?:print[-\s]?ready|suitable\s+for\s+print(?:ing)?)`;

const classifiers: readonly ClaimClassifier[] = [
  {
    code: "visual_restoration_claim",
    candidates: [
      new RegExp(
        String.raw`\b(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}(?:be\s+${modifiers})?${restorationResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}${qualifiedImageSubject}\s+${modifiers}be\s+${modifiers}(?:restored|fixed|repaired)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}be|(?:am|is|are|was|were|be|been|being))\s+${modifiers}able\s+to\s+${modifiers}(?:restore|fix|repair)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:full\s+)?restoration\s+is\s+${modifiers}guaranteed\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${activeAgent}\s+${modifiers}(?:restore|fix|repair)\s+${modifiers}${qualifiedImageSubject}\b`,
        "gi",
      ),
    ],
  },
  {
    code: "visual_print_suitability_claim",
    candidates: [
      new RegExp(
        String.raw`\b${imageSubject}\s+(?:(?:is|are|looks?|appears?)\s+${modifiers}|(?:will|can|could|may|might)\s+${modifiers}be\s+${modifiers})${printAssessment}\s+${printPurpose}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:will|can|could|may|might)\s+${modifiers}${qualifiedImageSubject}\s+${modifiers}be\s+${modifiers}${printAssessment}\s+${printPurpose}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\bwill\s+${modifiers}print\s+${modifiers}perfectly\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\bprint\s+quality\s+is\s+${modifiers}guaranteed\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${activeAgent}\s+${modifiers}make\s+${modifiers}${qualifiedImageSubject}\s+${modifiers}${printReadyResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualifiedImageSubject}\s+will\s+${modifiers}print\s+${modifiers}(?:beautifully|perfectly|well)\b`,
        "gi",
      ),
    ],
  },
];

const assessmentContext = /\b(?:assess|review|check|determine|confirm)\s+(?:if|whether)\b/i;
const withheldContext = /\b(?:cannot|can't|can\s+not|could\s+not|couldn't|do\s+not|don't|does\s+not|doesn't|did\s+not|didn't|will\s+not|won't)\s+(?:yet\s+)?(?:confirm|say|guarantee|determine|know)\b/i;
const notYetPossibleContext = /\bnot\s+(?:yet\s+)?possible\s+to\s+(?:confirm|say|determine|know)\s+(?:if|whether)\b/i;
const uncertainOrNegatedCandidate = /\b(?:may|might|could|perhaps|possibly|probably|likely|unlikely|cannot|can't|not|never)\b/i;
const dependentAssessment = /\b(?:if|whether)\b.+\bdepends?\s+on\b/i;
const governingUncertaintyContext = new RegExp(
  String.raw`(?:\b(?:may|might)\s+be\s+possible\s+that|\b(?:perhaps|possibly|probably|likely|unlikely))\s+(?:(?:we|it|this|that|(?:(?:this|that|the|your)\s+)?(?:photo|image|picture|file))\s+)?$`,
  "i",
);

function claimIsQualified(clause: string, candidate: RegExpMatchArray) {
  if (clause.endsWith("?")) return true;

  const candidateStart = candidate.index ?? 0;
  const context = clause.slice(0, candidateStart);
  return assessmentContext.test(context)
    || withheldContext.test(context)
    || notYetPossibleContext.test(context)
    || governingUncertaintyContext.test(context)
    || uncertainOrNegatedCandidate.test(candidate[0])
    || dependentAssessment.test(clause);
}

function hasDefinitiveClaim(clause: string, patterns: readonly RegExp[]) {
  for (const pattern of patterns) {
    for (const candidate of clause.matchAll(pattern)) {
      if (!claimIsQualified(clause, candidate)) return true;
    }
  }
  return false;
}

export function validateImageDraft(draft: string): ImageDraftValidationResult {
  const value = String(draft ?? "").trim();
  const codes: ImageClaimCode[] = [];
  const sentences = value.match(/[^.!?;\n]+[.!?]?/g) ?? [];
  for (const sentence of sentences) {
    const clauses = sentence.split(
      /[,:\u2013\u2014]|\s+-\s+|\b(?:and|but|however|because|even\s+though|although|though|while|whereas|then|so)\b/i,
    );
    for (const item of clauses) {
      const clause = item.trim();
      if (!clause) continue;

      for (const classifier of classifiers) {
        if (!codes.includes(classifier.code) && hasDefinitiveClaim(clause, classifier.candidates)) {
          codes.push(classifier.code);
        }
      }
    }
  }
  return { ok: codes.length === 0, codes };
}
