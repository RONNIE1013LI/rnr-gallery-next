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
const modal = String.raw`(?:will|can(?:not)?|could|may|might|would)`;
const determiner = String.raw`(?:this|that|these|those|the|your|our|an?)`;
const imageNoun = String.raw`(?:photos?|photographs?|images?|pictures?|files?)`;
const imageDescriptor = String.raw`(?:uploaded|original|damaged|faded|blurry|blurred|old|low[-\s]?resolution|high[-\s]?resolution)`;
const namedImageSubject = String.raw`(?:${determiner}\s+)?(?:${imageDescriptor}\s+)*${imageNoun}`;
const imageSubject = String.raw`(?:${namedImageSubject}|it|this|that)`;
const missingDetail = String.raw`(?:(?:the|any|some|every)\s+)?(?:(?:missing|lost|obscured|absent)\s+(?:facial\s+)?(?:details?|parts?|areas?|background|features?)|(?:details?|parts?|areas?|background|features?)\s+that\s+(?:is|are)\s+missing)`;
const visualTarget = String.raw`(?:${imageSubject}|${missingDetail}|(?:the\s+)?damage)`;
const visualChangeAction = String.raw`(?:restore|fix|repair|recover|enhance|improve|upscale|sharpen|reconstruct|recreate|rebuild|generate|clean\s+up|add\s+back|fill\s+in)`;
const visualChangeInfinitiveOrGerund = String.raw`(?:restor(?:e|ing)|fix(?:ing)?|repair(?:ing)?|recover(?:ing)?|enhanc(?:e|ing)|improv(?:e|ing)|upscal(?:e|ing)|sharpen(?:ing)?|reconstruct(?:ing)?|recreat(?:e|ing)|rebuild(?:ing)?|generat(?:e|ing)|clean(?:ing)?\s+up|add(?:ing)?\s+back|fill(?:ing)?\s+in)`;
const visualChangeResult = String.raw`(?:restored|fixed|repaired|recovered|enhanced|improved|upscaled|sharpened|reconstructed|recreated|rebuilt)`;
const restorationCapability = String.raw`(?:restorable|repairable|recoverable)`;
const enhancementOutcome = String.raw`(?:clear(?:er)?|sharp(?:er)?|(?:like\s+)?new\s+again|like\s+new)`;
const qualitySubject = String.raw`(?:(?:the\s+)?${imageNoun}(?:'s)?\s+(?:quality|resolution)|(?:the\s+)?(?:image|photo|file)\s+(?:quality|resolution))`;
const printPurpose = String.raw`(?:for\s+print(?:ing)?|to\s+print)`;
const printReadyResult = String.raw`(?:print[-\s]?ready|press[-\s]?ready|printable|ready\s+(?:for\s+print(?:ing)?|to\s+print)|suitable\s+(?:for\s+print(?:ing)?|to\s+print)|(?:perfect|ideal)\s+for\s+print(?:ing)?)`;

const classifiers: readonly ClaimClassifier[] = [
  {
    code: "visual_restoration_claim",
    candidates: [
      new RegExp(
        String.raw`\b${modal}\s+${modifiers}(?:(?:be\s+${modifiers})?(?:able\s+to|capable\s+of)\s+${modifiers})?${visualChangeAction}\s+${modifiers}(?:${visualTarget}|(?:the\s+)?quality\s+of\s+${imageSubject})\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:am|is|are|was|were)\s+${modifiers}(?:able\s+to|capable\s+of)\s+${modifiers}${visualChangeInfinitiveOrGerund}\s+${modifiers}${visualTarget}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${visualTarget}\s+${modal}\s+${modifiers}(?:be\s+${modifiers})?${visualChangeResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:can|could|would|will)\s+${visualTarget}\s+${modifiers}be\s+${modifiers}${visualChangeResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${visualTarget}\s+(?:(?:is|are|was|were)\s+${modifiers}|${modal}\s+${modifiers}be\s+${modifiers})${restorationCapability}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${modal}\s+${modifiers}(?:make\s+${modifiers}(?:${imageSubject}\s+${modifiers}(?:look\s+)?${enhancementOutcome}|${missingDetail}\s+${modifiers}visible\s+again)|bring\s+${modifiers}${imageSubject}\s+back\s+to\s+(?:its|the)\s+original\s+condition)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${imageSubject}\s+${modal}\s+${modifiers}be\s+${modifiers}brought\s+back\s+to\s+(?:its|the)\s+original\s+condition\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:promise|guarantee|assure)\b[^.!?;:]{0,64}\b(?:${visualChangeAction}\s+${modifiers}${visualTarget}|make\s+${imageSubject}\s+(?:look\s+)?${enhancementOutcome}|(?:better|improved)\s+(?:image|photo)?\s*quality|(?:a\s+)?(?:sharper|clearer)\b)`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${imageSubject}\s+(?:is|are)\s+${modifiers}guaranteed\s+to\s+(?:look\s+)?${enhancementOutcome}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:(?:full|flawless)\s+)?(?:restoration|enhancement|improvement|upscaling)\s+(?:is|are)\s+${modifiers}(?:guaranteed|assured|possible)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:it\s+)?(?:(?:is|was)|(?:may|might|could)\s+be)\s+${modifiers}possible\s+to\s+${modifiers}${visualChangeAction}\s+${modifiers}${visualTarget}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualitySubject}\s+${modal}\s+${modifiers}(?:improve|be\s+(?:improved|enhanced|sharper|clearer))\b`,
        "gi",
      ),
    ],
  },
  {
    code: "visual_print_suitability_claim",
    candidates: [
      new RegExp(
        String.raw`\b${imageSubject}\s+(?:(?:is|are|looks?|appears?)\s+${modifiers}|${modal}\s+${modifiers}be\s+${modifiers})${printReadyResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:(?:can|could|would|will)\s+${imageSubject}\s+${modifiers}be|(?:is|are)\s+${imageSubject})\s+${modifiers}${printReadyResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${imageSubject}\s+${modal}\s+${modifiers}print\s+${modifiers}(?:beautifully|perfectly|well)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${modal}\s+${modifiers}(?:make|get)\s+${modifiers}${imageSubject}\s+${modifiers}${printReadyResult}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${modal}\s+${modifiers}prepare\s+${modifiers}${imageSubject}\s+${printPurpose}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${imageSubject}\s+(?:meets?|satisf(?:y|ies))\s+${modifiers}(?:print(?:ing)?[-\s]?)?(?:quality\s+)?(?:requirements?|standards?)\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${imageSubject}\s+is\s+${modifiers}good\s+enough\s+to\s+print\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${imageSubject}\s+has\s+${modifiers}enough\s+resolution\s+for\s+print(?:ing)?\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${qualitySubject}\s+(?:is|are)\s+${modifiers}(?:sufficient|adequate|good\s+enough)\s+for\s+print(?:ing)?\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:this|that|it)\s+is\s+${modifiers}(?:a\s+)?print[-\s]?quality\s+${imageNoun}\b`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:print\s+quality|print\s+(?:readiness|suitability))\s+(?:is|are)\s+${modifiers}(?:guaranteed|confirmed)\b`,
        "gi",
      ),
    ],
  },
];

const uncertainOrNegatedCandidate = /\b(?:may|might|could|would|perhaps|possibly|probably|likely|unlikely|cannot|not|never)\b/i;
const uncertaintyPrefix = /\b(?:unclear|uncertain|unsure|unknown|doubtful)\s+(?:if|whether)\s*$/i;
const governingUncertaintyPrefix = /\b(?:may|might|could|perhaps|possibly|probably|likely|unlikely)\b[^.!?;:]{0,48}$/i;
const assessmentPrefix = /\b(?:assess|review|check|inspect|evaluate|determine|confirm|see|find\s+out|tell(?:\s+you)?|let\s+you\s+know)\b[^.!?;:]{0,48}\b(?:if|whether|what|how)\s*$/i;
const negatedSpeechPrefix = /\b(?:cannot|can\s+not|(?:will|could|would|do|does|did)\s+not|not)\b[^.!?;:]{0,64}\b(?:promise|claim|assure|guarantee|confirm|say|determine|know)\b(?:\s+(?:you|we|i|that|if|whether|to))*\s*$/i;
const negatedOperatorPrefix = /\b(?:cannot|can\s+not|(?:will|could|would|do|does|did)\s+not|not)\s*$/i;
const dependentAssessmentSuffix = /^\s+depends?\s+on\s+(?:(?:assess|review|check|inspect)\w*\s+)?(?:the\s+)?(?:original|source\s+quality)\b/i;
const directQuestionCandidate = /^(?:can|could|would|will|is|are|was|were)\b/i;

function normalizeSyntax(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bcouldn't\b/gi, "could not")
    .replace(/\bwouldn't\b/gi, "would not")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bdoesn't\b/gi, "does not")
    .replace(/\bdidn't\b/gi, "did not")
    .replace(/\b([a-z]+)'ll\b/gi, "$1 will")
    .replace(/\b(we|you|they)'re\b/gi, "$1 are")
    .replace(/\bi'm\b/gi, "i am")
    .replace(/\bit's\b/gi, "it is");
}

function claimIsQualified(clause: string, candidate: RegExpMatchArray) {
  const candidateStart = candidate.index ?? 0;
  const candidateEnd = candidateStart + candidate[0].length;
  const prefix = clause.slice(0, candidateStart);
  const suffix = clause.slice(candidateEnd);
  const isDirectQuestion = clause.endsWith("?")
    && candidateStart === 0
    && directQuestionCandidate.test(candidate[0]);

  return isDirectQuestion
    || uncertaintyPrefix.test(prefix)
    || governingUncertaintyPrefix.test(prefix)
    || assessmentPrefix.test(prefix)
    || negatedSpeechPrefix.test(prefix)
    || negatedOperatorPrefix.test(prefix)
    || uncertainOrNegatedCandidate.test(candidate[0])
    || dependentAssessmentSuffix.test(suffix);
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
  const value = normalizeSyntax(String(draft ?? "").trim());
  const codes: ImageClaimCode[] = [];
  const sentences = value.match(/[^.!?;\n]+[.!?]?/g) ?? [];
  for (const sentence of sentences) {
    const clauses = sentence.split(
      /[,:\u2013\u2014]|\s+-\s+|\b(?:and|but|however|because|even\s+though|although|though|while|whereas|then|so|before|after|now\s+that|unless|once)\b/i,
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
