import type { CustomerServiceIntent } from "./intent-detection";
import { validateWebsitePublicOutput } from "./website/output-safety-validator";

export type DraftValidationResult = Readonly<{
  ok: boolean;
  codes: readonly string[];
}>;

export function validateDraft(
  draft: string,
  { intent, channel }: Readonly<{
    intent: CustomerServiceIntent;
    channel?: "facebook" | "website";
  }>,
): DraftValidationResult {
  const value = String(draft ?? "").trim();
  if (!value) return { ok: false, codes: ["empty_draft"] };
  if (/\bas an ai\b|\bai assistant\b|valued enquiry/i.test(value)) {
    return { ok: false, codes: ["ai_style"] };
  }
  if (channel === "website") {
    const websiteSafety = validateWebsitePublicOutput(value, intent);
    if (!websiteSafety.ok) return { ok: false, codes: [websiteSafety.code] };
  }
  if (/\bguarantee(?:d)?\b|\brefund\b|\bcancel\b|\bcompensation\b|\bchargeback\b|\breprint\b/i.test(value)) {
    return { ok: false, codes: ["forbidden_commitment"] };
  }
  if (/(?:NZ\$|AU\$|\$)\s*\d|\b(?:NZD|AUD)\s*\d/i.test(value)) {
    return { ok: false, codes: ["monetary_claim"] };
  }
  if (/%/.test(value) && !(intent === "payment_process" && /\b50%(?:\s|$)/.test(value))) {
    return { ok: false, codes: ["unapproved_percentage"] };
  }

  const policyLeaks: Partial<Record<CustomerServiceIntent, RegExp>> = {
    product_differences: /\b(?:includes?|comes? with|has|provided with)\b.{0,40}\b(?:stand|eyelets?|pegs?|carry bag)\b/i,
    design_process: /\b(?:free|included) revisions?\b|\b\d+ revisions?\b|preview before printing|non[- ]?refundable/i,
    production_process: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:working|business)?\s*days?\b|\b(?:today|tomorrow)\b/i,
    payment_process: /\bafterpay\b|\bzip\b|\bweekly\b|\bsplit payment\b|\bpay partly\b|\bbank transfer\b|\bcash\b/i,
  };
  if (policyLeaks[intent]?.test(value)) {
    return { ok: false, codes: ["unconfirmed_policy_claim"] };
  }

  const lines = value.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 5 || value.length > 800) return { ok: false, codes: ["tone_length"] };
  return { ok: true, codes: [] };
}
