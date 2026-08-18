export type CaseMemorySanitization = Readonly<{
  text: string;
  codes: readonly string[];
  safe: boolean;
}>;

export function sanitizeCaseMemoryText(raw: string): CaseMemorySanitization {
  const codes: string[] = [];
  let text = raw.replace(/\s+/g, " ").trim();
  const replace = (pattern: RegExp, replacement: string, code: string) => {
    text = text.replace(pattern, () => {
      codes.push(code);
      return replacement;
    });
  };
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]", "email_redacted");
  replace(/(?:\+64|0)\s*\d(?:[\s-]*\d){7,10}\b/g, "[phone]", "phone_redacted");
  replace(/\bRNR[- ]?[A-Z0-9-]{4,}\b/gi, "[order]", "order_id_redacted");
  replace(
    /\b\d{1,5}\s+(?:[A-Za-z'-]+\s+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Close|Crescent|Lane|Drive|Way)(?:,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+){0,3})?/gi,
    "[address]",
    "address_redacted",
  );
  replace(/\b\d{4}\b/g, "[postcode]", "postcode_redacted");
  replace(/\b(?:NZ|AU)?\$\s?\d+(?:\.\d{1,2})?\b/gi, "[current value]", "realtime_value_redacted");
  replace(/^([A-Z][A-Za-z'-]{1,40}),\s*/, "", "name_redacted");
  const uniqueCodes = [...new Set(codes)];
  return Object.freeze({ text, codes: Object.freeze(uniqueCodes), safe: uniqueCodes.length === 0 });
}
