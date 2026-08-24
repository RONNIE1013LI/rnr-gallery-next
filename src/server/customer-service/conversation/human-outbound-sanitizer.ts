import { createHash } from "node:crypto";

export type HumanOutboundRedactionCode =
  | "empty_text_withheld"
  | "attachment_only_withheld"
  | "payment_details_withheld"
  | "customer_name_redacted"
  | "email_redacted"
  | "phone_redacted"
  | "order_id_redacted"
  | "address_redacted"
  | "url_query_redacted";

export type HumanOutboundSanitization = Readonly<{
  text: string;
  bodyHash: string;
  redactionCodes: readonly HumanOutboundRedactionCode[];
  learningEligible: boolean;
  withheld: boolean;
}>;

const WITHHELD_TEXT = "[Sensitive staff reply withheld]";

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function containsPaymentDetails(value: string) {
  const compactDigits = value.replace(/\D/g, "");
  return /\b\d{2}-\d{4}-\d{7}-\d{2,3}\b/.test(value)
    || (/\b(?:bank\s+account|account\s+number|credit\s+card|card)\b/i.test(value) && compactDigits.length >= 8)
    || /\b(?:\d[ -]?){13,19}\b/.test(value);
}

export function sanitizeHumanOutboundText(rawText: string): HumanOutboundSanitization {
  const normalized = normalizeText(rawText);
  const bodyHash = hashText(normalized);
  if (!normalized) {
    return Object.freeze({
      text: WITHHELD_TEXT,
      bodyHash,
      redactionCodes: Object.freeze(["empty_text_withheld"] as const),
      learningEligible: false,
      withheld: true,
    });
  }
  if (normalized === "[Staff sent an attachment]") {
    return Object.freeze({
      text: normalized,
      bodyHash,
      redactionCodes: Object.freeze(["attachment_only_withheld"] as const),
      learningEligible: false,
      withheld: true,
    });
  }
  if (containsPaymentDetails(normalized)) {
    return Object.freeze({
      text: WITHHELD_TEXT,
      bodyHash,
      redactionCodes: Object.freeze(["payment_details_withheld"] as const),
      learningEligible: false,
      withheld: true,
    });
  }

  const redactionCodes: HumanOutboundRedactionCode[] = [];
  let text = normalized;
  text = text.replace(/^(Hi|Hello|Kia ora|Thanks|Thank you)\s+[A-Z][A-Za-z'-]{1,40},/i, (match, greeting: string) => {
    redactionCodes.push("customer_name_redacted");
    return `${greeting} there,`;
  });
  text = text.replace(
    /\b((?:my|our)\s+(?:son|daughter|child|mum|mother|dad|father|partner|husband|wife)\s+)\p{Lu}[\p{L}'-]{1,40}/giu,
    (_match, relationship: string) => {
      redactionCodes.push("customer_name_redacted");
      return `${relationship}[name]`;
    },
  );
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => {
    redactionCodes.push("email_redacted");
    return "[email redacted]";
  });
  text = text.replace(/\+?\d(?:[\s().-]*\d){7,14}\b/g, () => {
    redactionCodes.push("phone_redacted");
    return "[phone redacted]";
  });
  text = text.replace(/\bRNR[- ]?[A-Z0-9-]{4,}\b/gi, () => {
    redactionCodes.push("order_id_redacted");
    return "[order id redacted]";
  });
  text = text.replace(
    /\b\d{1,5}\s+(?:[A-Za-z'-]+\s+){0,5}(?:Street|St|Road|Rd|Avenue|Ave|Close|Crescent|Lane|Drive|Way|Place|Pl|Court|Ct|Terrace|Tce|Boulevard|Blvd|Highway|Hwy|Parkway|Pkwy|Circle|Cir|Trail|Trl|Square|Sq)(?:,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+){0,3})?/gi,
    () => {
      redactionCodes.push("address_redacted");
      return "[address redacted]";
    },
  );
  text = text.replace(
    /\bP\.?\s*O\.?\s*Box\s+\d+[A-Za-z-]*(?:,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+){0,3})?/gi,
    () => {
      redactionCodes.push("address_redacted");
      return "[address redacted]";
    },
  );
  text = text.replace(
    /\b((?:ask for|contact|named|called|customer|client|recipient|recipient(?:'s)? name is|customer(?:'s)? name is)\s+)(?!(?:asks?|wants?|needs?|says?|can|could|would|should|is|was|has|have)\b)\p{Lu}[\p{L}'-]{1,40}(?:\s+\p{Lu}[\p{L}'-]{1,40}){0,2}/giu,
    (_match, prefix: string) => {
      redactionCodes.push("customer_name_redacted");
      return `${prefix}[name]`;
    },
  );
  text = text.replace(/https:\/\/[^\s]+/gi, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (!url.search && !url.hash) return rawUrl;
      redactionCodes.push("url_query_redacted");
      return `${url.origin}${url.pathname}`;
    } catch {
      return rawUrl;
    }
  });

  return Object.freeze({
    text,
    bodyHash,
    redactionCodes: Object.freeze(redactionCodes),
    learningEligible: redactionCodes.length === 0,
    withheld: false,
  });
}
