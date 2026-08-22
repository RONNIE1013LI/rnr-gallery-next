export type WebsiteHumanReviewReason =
  | "high_risk"
  | "unresolved"
  | "realtime_required"
  | "budget_blocked"
  | "provider_error"
  | "output_blocked"
  | "system_failure";

export type WebsiteHumanReviewResponse = Readonly<{
  reason: WebsiteHumanReviewReason;
  body: string;
  kind: "policy_acknowledgement" | "provider_fallback";
}>;

const REALTIME_REQUIRED = "I can help collect the details for our team. Please send the product, size, number of people/photos, required date, and your suburb or postcode if delivery is needed. We’ll review the current details and get back to you.";
const HUMAN_REVIEW_REQUIRED = "Thanks for letting us know. Our team needs to review this before replying, and we’ll get back to you as soon as we can.";
const FALLBACK_REQUIRED = "Thanks for your message. Our team will review it and reply here as soon as we can.";
const SYSTEM_FALLBACK = "Sorry, I can’t complete that right now. I’ve marked your message for our team to review, so you don’t need to send it again.";

const RESPONSES: Readonly<Record<WebsiteHumanReviewReason, WebsiteHumanReviewResponse>> = Object.freeze({
  realtime_required: { reason: "realtime_required", body: REALTIME_REQUIRED, kind: "policy_acknowledgement" },
  high_risk: { reason: "high_risk", body: HUMAN_REVIEW_REQUIRED, kind: "policy_acknowledgement" },
  unresolved: { reason: "unresolved", body: HUMAN_REVIEW_REQUIRED, kind: "policy_acknowledgement" },
  budget_blocked: { reason: "budget_blocked", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
  provider_error: { reason: "provider_error", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
  output_blocked: { reason: "output_blocked", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
  system_failure: { reason: "system_failure", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
});

function contextualBody(reason: WebsiteHumanReviewReason, message: string) {
  if (["budget_blocked", "provider_error", "output_blocked", "system_failure"].includes(reason)) {
    return SYSTEM_FALLBACK;
  }
  if (/private|sensitive|confidential/i.test(message)) {
    return "Of course. I’ve marked this for our team to review privately. If you have an order number, please send that through, but please don’t include any sensitive payment or personal information here.";
  }
  if (/charged twice|duplicate charge|charged (?:two times|again)|two charges/i.test(message)) {
    return "I’m sorry about that. Please send your order number and, if possible, the date and amount of the two charges so our team can check what happened. Please don’t send any card numbers or other sensitive payment details here.";
  }
  if (/damaged|broken|cracked|torn/i.test(message)) {
    return "I’m sorry to hear that. Please send your order number and a few clear photos showing the damage. I’ll pass this to our team to review before we confirm the next step.";
  }
  if (/refund|cancell?ation|cancel/i.test(message)) {
    return "Thanks for letting us know. Please send your order number so our team can review the current order status and your cancellation/refund request before confirming what options are available.";
  }
  if (reason === "realtime_required" && /shipping|delivery/i.test(message)) {
    return /brisbane/i.test(message)
      ? "Sure 😊 Please send your Brisbane suburb or postcode and let me know which product and size you’re interested in. Our team can then confirm the current delivery cost for you."
      : "Sure 😊 Please send your suburb or postcode and let me know which product and size you’re interested in. Our team can then confirm the current delivery cost for you.";
  }
  if (reason === "realtime_required" && /\bA3\b/i.test(message) && /price|cost|how much/i.test(message)) {
    return "I can help with that. Is this for a custom design using your photos, or are you supplying your own finished design? Once I know that, I can ask for any other details needed and our team can confirm the current A3 price for you.";
  }
  return RESPONSES[reason].body;
}

export function websiteHumanReviewResponse(
  reason: WebsiteHumanReviewReason,
  context?: Readonly<{ message: string }>,
): WebsiteHumanReviewResponse {
  return context
    ? { ...RESPONSES[reason], body: contextualBody(reason, context.message) }
    : RESPONSES[reason];
}
