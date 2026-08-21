import type { CustomerServiceIntent } from "./intent-detection";

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
    if (/\b(?:system|developer)\s+(?:prompt|message|instructions?)\b|\bconfirmed rules\b|\bAI-SCOPE-\d+\b|\bknowledge base\b|\bpolicy (?:ids?|rules?|status)\b/i.test(value)) {
      return { ok: false, codes: ["internal_instruction_disclosure"] };
    }
    if (/https?:\/\/|\bwww\./i.test(value)) {
      return { ok: false, codes: ["external_url"] };
    }
    if (
      /\b(?:used|called|ran|invoked)\b.{0,40}\b(?:tool|api|action)\b/i.test(value)
      || /\b(?:I|we)(?:['’]ve| have)?\s+(?:applied|created|placed|updated|changed|cancelled|canceled|processed|issued|booked|scheduled|marked|confirmed)\b.{0,80}\b(?:discount|order|payment|refund|shipping|delivery|booking|status)\b/i.test(value)
    ) {
      return { ok: false, codes: ["business_action_claim"] };
    }
    if (/\b(?:your|the)\s+(?:order|payment|refund|shipment|delivery)\b.{0,80}\b(?:is|was|has been|will be|will)\s+(?:paid|confirmed|approved|complete|completed|shipped|dispatched|ready|due|arrive|arriving)\b/i.test(value)) {
      return { ok: false, codes: ["realtime_business_claim"] };
    }
    if (/\banother customer['’]?s\b|\bprivate case\b|\bcustomer record\b/i.test(value)) {
      return { ok: false, codes: ["private_case_disclosure"] };
    }
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
