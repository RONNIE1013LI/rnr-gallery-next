export type ImageDraftValidationResult = Readonly<{
  ok: boolean;
  codes: readonly string[];
}>;

const restorationClaim = /\bwill\s+(?:be\s+)?(?:fully\s+)?(?:restore(?:d)?|fix(?:ed)?|repair(?:ed)?)\b|\bcan\s+(?:(?:definitely|certainly|absolutely|fully)\s+)?(?:fix|restore|repair)\b|\bcan\s+be\s+(?:fully\s+)?(?:restored|fixed|repaired)\b|\b(?:full\s+)?restoration\s+is\s+guaranteed\b/i;
const printClaim = /\b(?:photo|image|picture|file)\s+(?:is|will\s+be|looks?|appears?)\s+(?:perfect|ideal|ready|suitable)\s+(?:for\s+print(?:ing)?|to\s+print)\b|\bprint\s+quality\s+is\s+guaranteed\b|\bwill\s+print\s+perfectly\b/i;

function explicitlyDefersAssessment(clause: string) {
  if (clause.endsWith("?")) return true;
  return /\b(?:need|needs|would\s+need|will\s+need)\s+to\s+(?:assess|review|check|determine|confirm)\s+whether\b/i.test(clause)
    || /\b(?:assess|review|check|determine|confirm)\s+whether\b/i.test(clause)
    || /\b(?:cannot|can't|can\s+not|could\s+not|couldn't|will\s+not|won't)\s+(?:confirm|say|guarantee|determine|know)\b/i.test(clause)
    || /\bnot\s+(?:yet\s+)?possible\s+to\s+(?:confirm|say|determine|know)\s+whether\b/i.test(clause)
    || /\bwhether\b.+\bdepends?\s+on\b/i.test(clause);
}

export function validateImageDraft(draft: string): ImageDraftValidationResult {
  const value = String(draft ?? "").trim();
  const codes: string[] = [];
  const sentences = value.match(/[^.!?;\n]+[.!?]?/g) ?? [];
  for (const sentence of sentences) {
    const clauses = sentence.split(/,|\b(?:and|but|however)\b/i);
    for (const item of clauses) {
      const clause = item.trim();
      if (!clause || explicitlyDefersAssessment(clause)) continue;
      if (!codes.includes("visual_restoration_claim") && restorationClaim.test(clause)) {
        codes.push("visual_restoration_claim");
      }
      if (!codes.includes("visual_print_suitability_claim") && printClaim.test(clause)) {
        codes.push("visual_print_suitability_claim");
      }
    }
  }
  return { ok: codes.length === 0, codes };
}
