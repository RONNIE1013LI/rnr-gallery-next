export type WebsiteModelInputRedactionCode =
  | "email"
  | "phone"
  | "address"
  | "payment_identifier"
  | "order_identifier"
  | "tracking_identifier"
  | "url_parameters"
  | "url_identifier";

export type SanitizedWebsiteModelInput = Readonly<{
  text: string;
  redactionCodes: readonly WebsiteModelInputRedactionCode[];
  reviewRequired: boolean;
}>;

function replaceAndRecord(
  input: string,
  pattern: RegExp,
  replacement: string,
  code: WebsiteModelInputRedactionCode,
  codes: Set<WebsiteModelInputRedactionCode>,
) {
  if (!pattern.test(input)) return input;
  codes.add(code);
  pattern.lastIndex = 0;
  return input.replace(pattern, replacement);
}

export function sanitizeWebsiteModelInput(rawText: string): SanitizedWebsiteModelInput {
  const codes = new Set<WebsiteModelInputRedactionCode>();
  let text = rawText;

  text = replaceAndRecord(
    text,
    /\b(?:\d[ -]*?){13,19}\b|\b\d{2}-\d{4}-\d{7}-\d{2,3}\b/gi,
    "[payment details removed]",
    "payment_identifier",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[email removed]",
    "email",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\b(?:order|invoice)\s*(?:number|no\.?|#|:)?\s*[A-Z0-9][A-Z0-9-]{5,}\b/gi,
    "[order reference removed]",
    "order_identifier",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\b(?:tracking|track)\s*(?:number|no\.?|#|:)?\s*[A-Z0-9][A-Z0-9-]{7,}\b/gi,
    "[tracking reference removed]",
    "tracking_identifier",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\b[A-Z]{2,10}\d{8,}\b/g,
    "[tracking reference removed]",
    "tracking_identifier",
    codes,
  );
  text = replaceAndRecord(
    text,
    /(?:\+?\d[\d ()-]{7,}\d)/g,
    "[phone removed]",
    "phone",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\b(?:Unit\s+[A-Za-z0-9-]+\s*,?\s*)?\d{1,6}[A-Za-z]?\s+(?:[A-Za-z0-9][A-Za-z0-9'-]*\s+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Close|Cl|Drive|Dr|Lane|Ln|Place|Pl|Court|Ct|Way|Crescent|Cres|Terrace|Tce|Parade|Pde|Boulevard|Blvd|Circuit|Cct|Esplanade)\b(?:\s*,\s*[A-Za-z][A-Za-z\s'-]*?(?:\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT))?)?(?:\s+\d{4})?\b/gi,
    "[address removed]",
    "address",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\b\d{1,6}\s+State\s+Highway\s+\d+[A-Za-z]?(?:\s*,\s*[A-Za-z][A-Za-z\s'-]*)?(?:\s+\d{4})?\b/gi,
    "[address removed]",
    "address",
    codes,
  );
  text = replaceAndRecord(
    text,
    /\bRural\s+Delivery\s+\d+|\bRD\s*\d+\s*,\s*[A-Za-z][A-Za-z\s'-]*(?:\s+\d{4})?\b/gi,
    "[address removed]",
    "address",
    codes,
  );
  text = text.replace(
    /\[address removed\]\s*(?:(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*)?\d{4}\b/gi,
    "[address removed]",
  );
  text = replaceAndRecord(
    text,
    /\bP\.?\s*O\.?\s*Box\s+\d+[A-Z]?(?:,\s*[A-Za-z][A-Za-z\s'-]*)?/gi,
    "[address removed]",
    "address",
    codes,
  );
  text = text.replace(
    /https?:\/\/[^\s?#]*(?:track|tracking)[^\s]*/gi,
    () => {
      codes.add("tracking_identifier");
      return "[tracking link removed]";
    },
  );
  text = text.replace(/https?:\/\/[^\s]+/gi, (url) => {
    if (/[?#]/.test(url)) codes.add("url_parameters");
    codes.add("url_identifier");
    return "[link removed]";
  });

  return Object.freeze({
    text: text.replace(/\s{2,}/g, " ").trim(),
    redactionCodes: Object.freeze([...codes]),
    reviewRequired: codes.has("payment_identifier"),
  });
}
