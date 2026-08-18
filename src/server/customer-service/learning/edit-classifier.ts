export type HumanEditClassification =
  | "accepted_unchanged"
  | "edited_light"
  | "edited_significant"
  | "ai_ignored"
  | "independent_reply";

function normalized(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function classifyHumanEdit(aiDraft: string | null, humanReply: string) {
  if (!aiDraft) {
    return Object.freeze({ classification: "independent_reply" as const, similarityScore: null, reasonCodes: ["independent_human_reply"] });
  }
  const ai = normalized(aiDraft);
  const human = normalized(humanReply);
  if (ai === human) {
    return Object.freeze({ classification: "accepted_unchanged" as const, similarityScore: 10_000, reasonCodes: [] as string[] });
  }
  const maxLength = Math.max(ai.length, human.length, 1);
  const similarityScore = Math.max(0, Math.round((1 - levenshtein(ai, human) / maxLength) * 10_000));
  const classification: HumanEditClassification = similarityScore >= 8_000
    ? "edited_light"
    : similarityScore >= 3_500
      ? "edited_significant"
      : "ai_ignored";
  return Object.freeze({
    classification,
    similarityScore,
    reasonCodes: classification === "ai_ignored" ? ["independent_human_reply"] : [],
  });
}
