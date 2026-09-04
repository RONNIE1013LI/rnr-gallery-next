import type { CustomerServiceIntent } from "./intent-detection";
import { validateWebsitePublicOutput } from "./website/output-safety-validator";

export type DraftValidationResult = Readonly<{
  ok: boolean;
  codes: readonly string[];
}>;

export function draftValidationRisk(result: DraftValidationResult): "GREEN" | "RED" {
  return result.ok ? "GREEN" : "RED";
}

type ApprovedPrice = Readonly<{
  currency: "NZD" | "AUD";
  amountInclTaxCents: number;
}>;

function monetaryClaimsAreApproved(value: string, approvedPrices: readonly ApprovedPrice[]) {
  const claims: Array<Readonly<{
    currency: "NZD" | "AUD" | null;
    amountInclTaxCents: number;
    start: number;
    end: number;
  }>> = [];
  const approvedCurrencies = new Set(approvedPrices.map((price) => price.currency));

  const currencyFor = (rawMarker: string) => {
    const marker = rawMarker.toUpperCase().replaceAll(".", "").trim();
    if (marker === "NZD" || marker === "NZ$" || marker === "NZ" || marker.startsWith("NZ ") || marker.startsWith("NEW ZEALAND")) {
      return "NZD" as const;
    }
    if (marker === "AUD" || marker === "AU$" || marker === "AU" || marker.startsWith("AU ") || marker.startsWith("AUSTRALIAN")) {
      return "AUD" as const;
    }
    return marker === "$" && approvedCurrencies.size === 1 ? [...approvedCurrencies][0] : null;
  };
  const amountInCents = (rawAmount: string) => {
    const amount = rawAmount.replaceAll(",", "");
    const [dollars, decimals = ""] = amount.split(".");
    return Number(dollars) * 100 + Number(decimals.padEnd(2, "0"));
  };

  for (const match of value.matchAll(/(?:(NZD|AUD|USD|NZ|AU|US|New Zealand|Australian|United States)\s*(?:dollars?)?\s*\$?\s*|((?:NZ|AU|US)\$|(?<![A-Za-z])\$)\s*)([0-9][\d,]*(?:\.\d{1,2})?)/gi)) {
    claims.push({
      currency: currencyFor(match[1] ?? match[2]),
      amountInclTaxCents: amountInCents(match[3]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  for (const match of value.matchAll(/([0-9][\d,]*(?:\.\d{1,2})?)\s*(NZD|AUD|USD|NZ dollars?|New Zealand dollars?|AU dollars?|Australian dollars?|US dollars?|United States dollars?)/gi)) {
    claims.push({
      currency: currencyFor(match[2]),
      amountInclTaxCents: amountInCents(match[1]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const covered = [...value].map(() => false);
  for (const claim of claims) {
    for (let index = claim.start; index < claim.end; index += 1) covered[index] = true;
  }
  const unmatched = [...value].map((character, index) => covered[index] ? " " : character).join("");
  const hasUnparsedMoney = /(?:NZD|AUD|USD|NZ\$|AU\$|US\$|Australian|New Zealand|United States|\$)\s*(?:dollars?)?\s*\$?\s*\d|\d[\d,.]*\s*(?:NZD|AUD|USD|NZ dollars?|New Zealand dollars?|AU dollars?|Australian dollars?|US dollars?|United States dollars?|dollars?)\b|\b(?:price|cost)\b.{0,20}\b\d+(?:\.\d{1,2})?\b/i.test(unmatched);
  if (hasUnparsedMoney) return false;
  if (!claims.length) return true;
  if (!approvedPrices.length) return false;
  return claims.every((claim) => (
    claim.currency !== null && approvedPrices.some(
      (price) => price.currency === claim.currency && price.amountInclTaxCents === claim.amountInclTaxCents,
    )
  ));
}

export function validateDraft(
  draft: string,
  { intent, channel, approvedPrices = [] }: Readonly<{
    intent: CustomerServiceIntent;
    channel?: "facebook" | "website";
    approvedPrices?: readonly ApprovedPrice[];
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
  if (!monetaryClaimsAreApproved(value, approvedPrices)) {
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
