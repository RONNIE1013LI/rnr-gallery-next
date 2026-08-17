export type ImageDraftValidationResult = Readonly<{
  ok: boolean;
  codes: readonly string[];
}>;

type ImageClaimCode =
  | "visual_restoration_claim"
  | "visual_print_suitability_claim";

type Candidate = Readonly<{
  code: ImageClaimCode;
  trigger: number;
}>;

type Bounds = Readonly<{
  start: number;
  end: number;
}>;

type TargetKind = "visual" | "design" | null;

const punctuationBoundaries = new Set([",", ".", "!", "?", ";", ":"]);
const clauseBoundaries = new Set([
  "after",
  "although",
  "because",
  "before",
  "but",
  "however",
  "now",
  "once",
  "since",
  "so",
  "then",
  "though",
  "unless",
  "whereas",
  "while",
]);
const coordinatingWords = new Set(["and", "or"]);
const auxiliaries = new Set([
  "am",
  "are",
  "be",
  "been",
  "being",
  "can",
  "could",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "is",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "was",
  "were",
  "will",
  "would",
]);
const questionAuxiliaries = new Set([
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "has",
  "have",
  "is",
  "was",
  "were",
  "will",
  "would",
]);
const subjectWords = new Set([
  "designer",
  "he",
  "i",
  "it",
  "ronnie",
  "she",
  "team",
  "they",
  "this",
  "that",
  "these",
  "those",
  "we",
  "you",
]);
const imageNouns = new Set([
  "file",
  "files",
  "image",
  "images",
  "photo",
  "photos",
  "photograph",
  "photographs",
  "picture",
  "pictures",
  "portrait",
  "portraits",
  "scan",
  "scans",
]);
const targetPronouns = new Set(["it", "them", "this", "that", "these", "those"]);
const designNouns = new Set([
  "alignment",
  "border",
  "borders",
  "colour",
  "colours",
  "color",
  "colors",
  "crop",
  "cropping",
  "design",
  "dimensions",
  "format",
  "layout",
  "name",
  "naming",
  "placement",
  "position",
  "size",
  "wording",
]);
const detailNouns = new Set([
  "area",
  "areas",
  "background",
  "backgrounds",
  "detail",
  "details",
  "eye",
  "eyes",
  "face",
  "faces",
  "feature",
  "features",
  "gap",
  "gaps",
  "mouth",
  "nose",
  "part",
  "parts",
  "portion",
  "portions",
  "section",
  "sections",
]);
const missingMarkers = new Set(["absent", "covered", "hidden", "lost", "missing", "obscured"]);
const qualityNouns = new Set(["blur", "damage", "quality", "resolution"]);
const visualActionWords = new Set([
  "clarified", "clarifies", "clarify", "clarifying",
  "deblur", "deblurred", "deblurring",
  "enhance", "enhanced", "enhances", "enhancing",
  "fix", "fixed", "fixes", "fixing",
  "generate", "generated", "generates", "generating",
  "improve", "improved", "improves", "improving",
  "infer", "inferred", "inferring",
  "rebuild", "rebuilding", "rebuilt",
  "recover", "recovered", "recovering", "recovers",
  "reconstruct", "reconstructed", "reconstructing", "reconstructs",
  "recreate", "recreated", "recreates", "recreating",
  "repair", "repaired", "repairing", "repairs",
  "restore", "restored", "restores", "restoring",
  "retouch", "retouched", "retouches", "retouching",
  "sharpen", "sharpened", "sharpening", "sharpens",
  "upscale", "upscaled", "upscales", "upscaling",
]);
const capabilityWords = new Set(["recoverable", "repairable", "restorable"]);
const enhancementOutcomes = new Set(["clear", "clearer", "sharp", "sharper"]);
const assessmentWords = new Set([
  "advise", "assess", "check", "confirm", "determine", "establish", "evaluate", "examine",
  "find", "inspect", "judge", "know", "review", "see", "tell", "verify",
  "work",
]);
const uncertaintyWords = new Set([
  "doubt", "doubtful", "likely", "may", "might", "perhaps", "possibly", "probably",
  "uncertain", "unclear", "unlikely", "unknown", "unsure",
]);
const speechWords = new Set([
  "assurance", "assure", "claim", "confirm", "determine", "guarantee", "know", "mean", "promise", "say", "think",
]);
const printSuitabilityWords = new Set([
  "adequate", "enough", "fit", "ideal", "perfect", "printable", "ready", "safe", "sufficient", "suitable",
]);

function normalizeSyntax(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, ";")
    .replace(/\s+-\s+/g, ";")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bcan't\b/gi, "can not")
    .replace(/\bcannot\b/gi, "can not")
    .replace(/\b(could|would|should|do|does|did|is|are|was|were|has|have|had)n't\b/gi, "$1 not")
    .replace(/\b([a-z]+)'ll\b/gi, "$1 will")
    .replace(/\b(we|you|they)'re\b/gi, "$1 are")
    .replace(/\bi'm\b/gi, "i am")
    .replace(/\b(it|that)'s\b/gi, "$1 is")
    .replace(/-/g, " ");
}

function tokenize(sentence: string) {
  return sentence.toLowerCase().match(/[a-z0-9]+|[,.!?;:]/g) ?? [];
}

function hasWord(tokens: readonly string[], word: string, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (tokens[index] === word) return true;
  }
  return false;
}

function hasAnyWord(tokens: readonly string[], words: ReadonlySet<string>, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (words.has(tokens[index])) return true;
  }
  return false;
}

function hasSequence(tokens: readonly string[], sequence: readonly string[], start: number, end: number) {
  for (let index = start; index <= end - sequence.length; index += 1) {
    if (sequence.every((word, offset) => tokens[index + offset] === word)) return true;
  }
  return false;
}

function isIndependentCoordination(tokens: readonly string[], index: number, end: number) {
  const subjectDeterminers = new Set(["our", "the", "their", "your"]);
  let cursor = index + 1;
  let sawSubject = false;

  if (subjectDeterminers.has(tokens[cursor])) {
    cursor += 1;
    while (cursor < end && !subjectWords.has(tokens[cursor]) && !imageNouns.has(tokens[cursor])) {
      if (auxiliaries.has(tokens[cursor]) || visualActionWords.has(tokens[cursor])) return false;
      cursor += 1;
    }
  }
  if (subjectWords.has(tokens[cursor]) || imageNouns.has(tokens[cursor])) sawSubject = true;
  else return false;

  for (; cursor < end; cursor += 1) {
    const word = tokens[cursor];
    if (punctuationBoundaries.has(word) || clauseBoundaries.has(word)) break;
    if (sawSubject && auxiliaries.has(word)) return true;
  }
  return false;
}

function assessmentGovernsIf(tokens: readonly string[], start: number, ifIndex: number) {
  const transparentWords = new Set(["can", "could", "me", "need", "out", "please", "to", "us", "we", "will", "you"]);
  for (let index = ifIndex - 1; index >= start; index -= 1) {
    const word = tokens[index];
    if (assessmentWords.has(word)) return true;
    if (!transparentWords.has(word)) return false;
  }
  return false;
}

function propositionBounds(tokens: readonly string[], trigger: number): Bounds {
  let start = 0;
  let end = tokens.length;

  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index];
    const fixedBoundary = (punctuationBoundaries.has(word)
      && (word !== "," || isIndependentCoordination(tokens, index, tokens.length)))
      || clauseBoundaries.has(word)
      || (word === "yet" && isIndependentCoordination(tokens, index, tokens.length));
    const coordinatedBoundary = coordinatingWords.has(word) && isIndependentCoordination(tokens, index, tokens.length);
    const conditionalBoundary = word === "if" && !assessmentGovernsIf(tokens, start, index);
    if (!fixedBoundary && !coordinatedBoundary && !conditionalBoundary) continue;

    if (index < trigger) start = index + 1;
    else if (index > trigger) {
      end = index;
      break;
    }
  }

  return { start, end };
}

function hasMissingContext(tokens: readonly string[], index: number, bounds: Bounds) {
  const start = Math.max(bounds.start, index - 4);
  const end = Math.min(bounds.end, index + 5);
  return hasAnyWord(tokens, missingMarkers, start, end);
}

function imageHasDesignProperty(tokens: readonly string[], imageIndex: number, bounds: Bounds) {
  const directEnd = Math.min(bounds.end, imageIndex + 4);
  if (hasAnyWord(tokens, designNouns, imageIndex + 1, directEnd)) return true;

  for (let index = imageIndex + 1; index < bounds.end; index += 1) {
    if (tokens[index] !== "with") continue;
    return hasAnyWord(tokens, designNouns, index + 1, bounds.end)
      && !hasAnyWord(tokens, qualityNouns, index + 1, bounds.end)
      && !hasAnyWord(tokens, missingMarkers, index + 1, bounds.end);
  }
  return false;
}

function targetAt(tokens: readonly string[], index: number, bounds: Bounds): TargetKind {
  const word = tokens[index];
  if (designNouns.has(word)) return "design";
  if (imageNouns.has(word)) return imageHasDesignProperty(tokens, index, bounds) ? "design" : "visual";
  if (targetPronouns.has(word) || qualityNouns.has(word)) return "visual";
  if (detailNouns.has(word) && (word === "gap" || word === "gaps" || hasMissingContext(tokens, index, bounds))) {
    return "visual";
  }
  return null;
}

function isVisualActionAt(tokens: readonly string[], index: number) {
  const word = tokens[index];
  if (visualActionWords.has(word)) return true;
  if ((word === "add" || word === "added" || word === "adding") && tokens[index + 1] === "back") return true;
  if ((word === "clean" || word === "cleaned" || word === "cleaning") && tokens[index + 1] === "up") return true;
  if ((word === "fill" || word === "filled" || word === "filling")
    && (tokens[index + 1] === "in" || hasAnyWord(tokens, new Set(["gap", "gaps"]), index + 1, tokens.length))) {
    return true;
  }
  if ((word === "touch" || word === "touched" || word === "touching") && tokens[index + 1] === "up") return true;
  if ((word === "bring" || word === "bringing" || word === "brought") && hasWord(tokens, "back", index + 1, tokens.length)) return true;
  if ((word === "boost" || word === "increase" || word === "increased")
    && hasAnyWord(tokens, qualityNouns, index + 1, tokens.length)) return true;
  if (word === "remove" && hasWord(tokens, "blur", index + 1, tokens.length)) return true;
  return false;
}

function findActionTarget(tokens: readonly string[], trigger: number, bounds: Bounds): TargetKind {
  for (let index = trigger + 1; index < bounds.end; index += 1) {
    if (isVisualActionAt(tokens, index) || coordinatingWords.has(tokens[index])) continue;
    const target = targetAt(tokens, index, bounds);
    if (target) return target;
  }

  for (let index = bounds.start; index < trigger; index += 1) {
    const target = targetAt(tokens, index, bounds);
    if (target) return target;
  }
  return null;
}

function visualTargetExists(tokens: readonly string[], trigger: number, bounds: Bounds) {
  return findActionTarget(tokens, trigger, bounds) === "visual";
}

function findRestorationCandidates(tokens: readonly string[]) {
  const candidates: Candidate[] = [];
  const outcomeGovernors = new Set(["be", "guarantee", "look", "make"]);
  const nominalOutcomes = new Set(["enhancement", "improvement", "restoration", "upscaling"]);
  const nominalResults = new Set(["assured", "guaranteed", "possible"]);

  for (let index = 0; index < tokens.length; index += 1) {
    const bounds = propositionBounds(tokens, index);
    const word = tokens[index];

    if (isVisualActionAt(tokens, index) && visualTargetExists(tokens, index, bounds)) {
      candidates.push({ code: "visual_restoration_claim", trigger: index });
      continue;
    }
    if (capabilityWords.has(word) && visualTargetExists(tokens, index, bounds)) {
      candidates.push({ code: "visual_restoration_claim", trigger: index });
      continue;
    }

    const clearOutcome = enhancementOutcomes.has(word)
      && hasAnyWord(tokens, outcomeGovernors, bounds.start, index + 1);
    const betterQuality = word === "better"
      && (hasWord(tokens, "look", bounds.start, index + 1) || hasWord(tokens, "quality", index, bounds.end));
    const goodAsNew = word === "good" && hasSequence(tokens, ["good", "as", "new"], index, bounds.end);
    const lookNewAgain = word === "new"
      && hasWord(tokens, "look", bounds.start, index)
      && hasWord(tokens, "again", index + 1, bounds.end);
    const visibleAgain = word === "visible" && hasWord(tokens, "again", index + 1, bounds.end);
    if ((clearOutcome || betterQuality || goodAsNew || lookNewAgain || visibleAgain)
      && visualTargetExists(tokens, index, bounds)) {
      candidates.push({ code: "visual_restoration_claim", trigger: index });
      continue;
    }

    if (nominalOutcomes.has(word) && hasAnyWord(tokens, nominalResults, index + 1, bounds.end)) {
      candidates.push({ code: "visual_restoration_claim", trigger: index });
    }
  }
  return candidates;
}

function isPrintWord(word: string) {
  return word === "print" || word === "printed" || word === "printing" || word === "printable";
}

function printTargetExists(tokens: readonly string[], trigger: number, bounds: Bounds) {
  if (visualTargetExists(tokens, trigger, bounds)) return true;
  return hasSequence(tokens, ["print", "quality"], bounds.start, bounds.end)
    || hasSequence(tokens, ["print", "readiness"], bounds.start, bounds.end)
    || hasSequence(tokens, ["print", "suitability"], bounds.start, bounds.end);
}

function hasPrintAssertionShape(tokens: readonly string[], bounds: Bounds) {
  const assertionWords = new Set([
    ...auxiliaries,
    "appears", "get", "gets", "go", "goes", "look", "looks", "make", "makes", "meet", "meets",
    "prepare", "prepares", "reproduce", "reproduces", "satisfies",
  ]);
  return hasAnyWord(tokens, assertionWords, bounds.start, bounds.end);
}

function findPrintCandidates(tokens: readonly string[]) {
  const candidates: Candidate[] = [];
  const printWords = new Set(["print", "printed", "printing"]);
  const qualityLevels = new Set(["adequate", "enough", "high", "sufficient"]);
  const resultWords = new Set(["beautifully", "perfectly", "reproduce", "reproduces", "well"]);

  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index];
    if (!isPrintWord(word) && !printSuitabilityWords.has(word)) continue;

    const bounds = propositionBounds(tokens, index);
    const hasPrint = isPrintWord(word) || hasAnyWord(tokens, printWords, bounds.start, bounds.end);
    const hasSuitability = printSuitabilityWords.has(word)
      || hasAnyWord(tokens, printSuitabilityWords, bounds.start, bounds.end);
    const hasQualityShape = hasAnyWord(tokens, qualityNouns, bounds.start, bounds.end)
      && hasAnyWord(tokens, qualityLevels, bounds.start, bounds.end);
    const hasResultShape = hasAnyWord(tokens, resultWords, bounds.start, bounds.end);
    const hasReadyCompound = word === "ready"
      && (tokens[index - 1] === "print" || tokens[index - 1] === "press" || hasPrint);
    const isRiskShape = word === "printable"
      || hasReadyCompound
      || (hasPrint && (hasSuitability || hasQualityShape || hasResultShape || hasPrintAssertionShape(tokens, bounds)));

    if (isRiskShape && printTargetExists(tokens, index, bounds)) {
      candidates.push({ code: "visual_print_suitability_claim", trigger: index });
    }
  }
  return candidates;
}

function isQuestionQualified(tokens: readonly string[], bounds: Bounds) {
  if (bounds.start !== 0 || !tokens.includes("?")) return false;
  const firstWord = tokens.find((token) => !punctuationBoundaries.has(token));
  return firstWord ? questionAuxiliaries.has(firstWord) : false;
}

function hasUncertaintyQualifier(tokens: readonly string[], candidate: Candidate, bounds: Bounds) {
  if (hasAnyWord(tokens, uncertaintyWords, bounds.start, candidate.trigger)) return true;
  if (hasSequence(tokens, ["not", "sure"], bounds.start, candidate.trigger)) return true;
  if (hasSequence(tokens, ["hard", "to", "know"], bounds.start, candidate.trigger)) return true;
  if (hasSequence(tokens, ["no", "way", "to", "know"], bounds.start, candidate.trigger)) return true;
  if (hasSequence(tokens, ["remains", "to", "be", "seen"], bounds.start, candidate.trigger)) return true;
  return hasWord(tokens, "could", bounds.start, candidate.trigger)
    && !hasAnyWord(tokens, visualActionWords, bounds.start, candidate.trigger);
}

function hasAssessmentQualifier(tokens: readonly string[], candidate: Candidate, bounds: Bounds) {
  for (let index = bounds.start; index < candidate.trigger; index += 1) {
    if (!["how", "if", "what", "whether"].includes(tokens[index])) continue;
    if (assessmentGovernsIf(tokens, bounds.start, index)) return true;
  }
  return false;
}

function hasNegationQualifier(tokens: readonly string[], candidate: Candidate, bounds: Bounds) {
  const nearStart = Math.max(bounds.start, candidate.trigger - 5);
  const nearEnd = Math.min(bounds.end, candidate.trigger + 6);
  if (hasWord(tokens, "not", nearStart, nearEnd)) return true;

  for (let index = bounds.start; index < candidate.trigger; index += 1) {
    const word = tokens[index];
    if (word !== "not" && word !== "never" && word !== "no" && word !== "refuse") continue;
    if (hasAnyWord(tokens, speechWords, index, candidate.trigger)) return true;
  }
  return false;
}

function hasDependencyQualifier(tokens: readonly string[], candidate: Candidate, bounds: Bounds) {
  const sourceWords = new Set(["file", "original", "quality", "source"]);
  const dependencyWords = new Set(["depend", "depended", "depending", "depends"]);
  const suffixStart = Math.min(candidate.trigger + 1, bounds.end);
  const dependency = hasAnyWord(tokens, dependencyWords, suffixStart, bounds.end)
    && hasAnyWord(tokens, sourceWords, suffixStart, bounds.end);
  const subjectToReview = hasSequence(tokens, ["subject", "to"], suffixStart, bounds.end)
    && hasAnyWord(tokens, sourceWords, suffixStart, bounds.end);
  return dependency || subjectToReview;
}

function isQualified(tokens: readonly string[], candidate: Candidate) {
  const bounds = propositionBounds(tokens, candidate.trigger);
  return isQuestionQualified(tokens, bounds)
    || hasUncertaintyQualifier(tokens, candidate, bounds)
    || hasAssessmentQualifier(tokens, candidate, bounds)
    || hasNegationQualifier(tokens, candidate, bounds)
    || hasDependencyQualifier(tokens, candidate, bounds);
}

export function validateImageDraft(draft: string): ImageDraftValidationResult {
  const value = normalizeSyntax(String(draft ?? "").trim());
  const foundCodes = new Set<ImageClaimCode>();
  const sentences = value.match(/[^.!?;\n]+[.!?]?/g) ?? [];

  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    const candidates = [...findRestorationCandidates(tokens), ...findPrintCandidates(tokens)];
    for (const candidate of candidates) {
      if (!isQualified(tokens, candidate)) foundCodes.add(candidate.code);
    }
  }

  const codes = (["visual_restoration_claim", "visual_print_suitability_claim"] as const)
    .filter((code) => foundCodes.has(code));
  return { ok: codes.length === 0, codes };
}
