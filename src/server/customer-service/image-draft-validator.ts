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
const imageNoun = String.raw`(?:photo|image|picture|file)`;
const imageDescriptor = String.raw`(?:damaged|faded|blurry|blurred|old|low[-\s]?resolution)`;
const qualifiedImageNoun = String.raw`(?:(?:this|that|the|your)\s+)?(?:${imageDescriptor}\s+)*${imageNoun}`;
const imageSubject = String.raw`(?:${qualifiedImageNoun}|it|this|that)`;
const qualifiedImageSubject = imageSubject;
const restorationResult = String.raw`(?:restore(?:d)?|fix(?:ed)?|repair(?:ed)?)`;
const visualChangeAction = String.raw`(?:restore|fix|repair|recover|enhance|improve|upscale|reconstruct|recreate|rebuild)`;
const visualChangeInfinitiveOrGerund = String.raw`(?:restor(?:e|ing)|fix(?:ing)?|repair(?:ing)?|recover(?:ing)?|enhanc(?:e|ing)|improv(?:e|ing)|upscal(?:e|ing)|reconstruct(?:ing)?|recreat(?:e|ing)|rebuild(?:ing)?)`;
const visualChangeResult = String.raw`(?:restored|fixed|repaired|recovered|enhanced|improved|upscaled|reconstructed|recreated|rebuilt)`;
const restorationCapability = String.raw`(?:restorable|repairable|recoverable)`;
const missingDetail = String.raw`(?:(?:the|any|some|every)\s+)?(?:missing|lost|obscured)\s+(?:details?|parts?|areas?|background)`;
const printAssessment = String.raw`(?:perfect|ideal|ready|suitable)`;
const printPurpose = String.raw`(?:for\s+print(?:ing)?|to\s+print)`;
const activeAgent = String.raw`(?:we(?:'ll|\s+(?:will|can))|i(?:'ll|\s+(?:will|can))|our\s+team\s+(?:will|can))`;
const printReadyResult = String.raw`(?:print[-\s]?ready|press[-\s]?ready|printable|ready\s+(?:for\s+print(?:ing)?|to\s+print)|suitable\s+for\s+print(?:ing)?)`;
const promiseAgent = String.raw`(?:we|i|our\s+team)\s+(?:promise|guarantee|assure\s+you)`;

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
        String.raw`\b(?:(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}be|(?:am|is|are|was|were|be|been|being))\s+${modifiers}(?:able\s+to|capable\s+of)\s+${modifiers}${visualChangeInfinitiveOrGerund}\b`,
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
      new RegExp(
        String.raw`\b(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}${visualChangeAction}\s+${modifiers}(?:${qualifiedImageSubject}|(?:the\s+)?quality\s+of\s+${qualifiedImageNoun}|${missingDetail})\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualifiedImageSubject}\s+(?:(?:is|are|was|were)\s+${modifiers}|(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}be\s+${modifiers})${restorationCapability}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:${qualifiedImageSubject}|${missingDetail})\s+(?:(?:is|are|was|were)\s+${modifiers}|(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}be\s+${modifiers})${visualChangeResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}(?:${missingDetail}\s+${modifiers}be\s+${modifiers}${visualChangeResult}|(?:reconstruct|recreate|rebuild|recover|fill\s+in)\s+${modifiers}${missingDetail})\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${missingDetail}\s+(?:(?:is|are|was|were)\s+${modifiers}|(?:will|can(?:not)?|can't|could|may|might)\s+${modifiers}be\s+${modifiers})(?:${restorationCapability}|${visualChangeResult})\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${promiseAgent}(?:\s+that)?(?:\s+(?:we|i)\s+(?:will|can))?\s+(?:to\s+)?${modifiers}${visualChangeAction}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${promiseAgent}\b[^.!?;:]{0,48}\b(?:make\s+${qualifiedImageSubject}\s+(?:clear(?:er)?|sharp(?:er)?|look\s+(?:like\s+new|new\s+again))|(?:sharper|clearer)\b)`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:photo\s+)?(?:restoration|enhancement|improvement|upscaling)\s+is\s+${modifiers}(?:guaranteed|possible)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:it\s+)?(?:(?:is|was)|(?:may|might|could)\s+be)\s+${modifiers}possible\s+to\s+${modifiers}${visualChangeAction}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${activeAgent}\s+${modifiers}(?:make\s+${modifiers}(?:${qualifiedImageSubject}\s+${modifiers}(?:look\s+)?(?:clear(?:er)?|sharp(?:er)?|(?:like\s+)?new\s+again)|${missingDetail}\s+${modifiers}visible\s+again)|bring\s+${modifiers}${qualifiedImageSubject}\s+back\s+to\s+(?:its|the)\s+original\s+condition)\b`,
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
        String.raw`\b${activeAgent}\s+${modifiers}(?:make|get)\s+${modifiers}${qualifiedImageSubject}\s+${modifiers}${printReadyResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualifiedImageSubject}\s+will\s+${modifiers}print\s+${modifiers}(?:beautifully|perfectly|well)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualifiedImageSubject}\s+(?:(?:is|are|looks?|appears?)\s+${modifiers}|(?:will|can|could|may|might)\s+${modifiers}be\s+${modifiers})${printReadyResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualifiedImageSubject}\s+(?:meets?|satisf(?:y|ies))\s+${modifiers}print[-\s]?quality\s+(?:requirements?|standards?)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:this|that|it)\s+is\s+${modifiers}(?:a\s+)?print[-\s]?quality\s+${imageNoun}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\bprint\s+(?:readiness|suitability)\s+(?:is\s+${modifiers}(?:guaranteed|confirmed)|depends?\s+on\s+(?:the\s+)?source\s+quality)\b`,
        "gi",
      ),
    ],
  },
];

const assessmentContext = /\b(?:assess|review|check|determine|confirm)\s+(?:if|whether|what|how)\b/i;
const withheldContext = /\b(?:cannot|can't|can\s+not|could\s+not|couldn't|do\s+not|don't|does\s+not|doesn't|did\s+not|didn't|will\s+not|won't)\s+(?:yet\s+)?(?:confirm|say|guarantee|determine|know)\b/i;
const notYetPossibleContext = /\bnot\s+(?:yet\s+)?possible\s+to\s+(?:confirm|say|determine|know)\s+(?:if|whether)\b/i;
const uncertainOrNegatedCandidate = /\b(?:may|might|could|perhaps|possibly|probably|likely|unlikely|cannot|can't|not|never)\b/i;
const dependentAssessment = /\b(?:if|whether)\b.+\bdepends?\s+on\b|\bdepends?\s+on\s+(?:the\s+)?source\s+quality\b/i;
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
