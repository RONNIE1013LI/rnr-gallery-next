export type CaseMemorySanitization = Readonly<{
  text: string;
  codes: readonly string[];
  safe: boolean;
}>;

export function sanitizeCaseMemoryText(raw: string): CaseMemorySanitization {
  const codes: string[] = [];
  let text = raw.replace(/\s+/g, " ").trim();
  const replace = (pattern: RegExp, replacement: string, code: string) => {
    const next = text.replace(pattern, replacement);
    if (next !== text) codes.push(code);
    text = next;
  };
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]", "email_redacted");
  replace(/\+?\d(?:[\s().-]*\d){7,14}\b/g, "[phone]", "phone_redacted");
  replace(/\bRNR[- ]?[A-Z0-9-]{4,}\b/gi, "[order]", "order_id_redacted");
  replace(
    /\b\d{1,5}\s+(?:[A-Za-z'-]+\s+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Close|Crescent|Lane|Drive|Way|Place|Pl|Court|Ct|Terrace|Tce|Boulevard|Blvd|Highway|Hwy|Parkway|Pkwy|Circle|Cir|Trail|Trl|Square|Sq)(?:,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+){0,3})?/gi,
    "[address]",
    "address_redacted",
  );
  replace(
    /\bP\.?\s*O\.?\s*Box\s+\d+[A-Za-z-]*(?:,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+){0,3})?/gi,
    "[address]",
    "address_redacted",
  );
  replace(/\b\d{4}\b/g, "[postcode]", "postcode_redacted");
  replace(/\b(?:NZ|AU)?\$\s?\d+(?:\.\d{1,2})?\b/gi, "[current value]", "realtime_value_redacted");
  replace(
    /\b((?:[Mm]y|[Hh]is|[Hh]er|[Tt]heir|[Oo]ur|[Tt]he (?:customer|child)(?:'s)?)\s+name\s+is\s+)\p{Lu}[\p{L}'-]{1,40}(?:\s+\p{Lu}[\p{L}'-]{1,40}){0,2}/gu,
    "$1[name]",
    "name_redacted",
  );
  replace(
    /\b((?:Hi|Hello|Kia ora|Thanks|Thank you)\s+)\p{Lu}[\p{L}'-]{1,40}(?=[,!.])/gu,
    "$1[name]",
    "name_redacted",
  );
  replace(
    /\b((?:my|our)\s+(?:son|daughter|child|mum|mother|dad|father|partner|husband|wife)\s+)\p{Lu}[\p{L}'-]{1,40}/giu,
    "$1[name]",
    "name_redacted",
  );
  replace(
    /\b((?:ask for|contact|named|called|customer|client|recipient|recipient(?:'s)? name is|customer(?:'s)? name is)\s+)(?!(?:asks?|wants?|needs?|says?|can|could|would|should|is|was|has|have)\b)\p{Lu}[\p{L}'-]{1,40}(?:\s+\p{Lu}[\p{L}'-]{1,40}){0,2}/giu,
    "$1[name]",
    "name_redacted",
  );
  replace(/^([A-Z][A-Za-z'-]{1,40}),\s*/, "", "name_redacted");
  const uniqueCodes = [...new Set(codes)];
  return Object.freeze({ text, codes: Object.freeze(uniqueCodes), safe: uniqueCodes.length === 0 });
}
