export type ImageDraftValidationResult = Readonly<{
  ok: boolean;
  codes: readonly string[];
}>;

export function validateImageDraft(draft: string): ImageDraftValidationResult {
  const value = String(draft ?? "").trim();
  const codes: string[] = [];
  if (
    /\bwill\s+(?:be\s+)?(?:fully\s+)?(?:restore(?:d)?|fix(?:ed)?|repair(?:ed)?)\b|\bcan\s+(?:(?:definitely|certainly|absolutely|fully)\s+)?(?:fix|restore|repair)\b/i.test(value)
  ) {
    codes.push("visual_restoration_claim");
  }
  if (
    /\b(?:photo|image|picture)\s+is\s+(?:perfect|ideal|ready|suitable)\s+(?:for\s+print(?:ing)?|to\s+print)\b|\bprint\s+quality\s+is\s+guaranteed\b|\bwill\s+print\s+perfectly\b/i.test(value)
  ) {
    codes.push("visual_print_suitability_claim");
  }
  return { ok: codes.length === 0, codes };
}
