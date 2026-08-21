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

const RESPONSES: Readonly<Record<WebsiteHumanReviewReason, WebsiteHumanReviewResponse>> = Object.freeze({
  realtime_required: { reason: "realtime_required", body: REALTIME_REQUIRED, kind: "policy_acknowledgement" },
  high_risk: { reason: "high_risk", body: HUMAN_REVIEW_REQUIRED, kind: "policy_acknowledgement" },
  unresolved: { reason: "unresolved", body: HUMAN_REVIEW_REQUIRED, kind: "policy_acknowledgement" },
  budget_blocked: { reason: "budget_blocked", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
  provider_error: { reason: "provider_error", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
  output_blocked: { reason: "output_blocked", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
  system_failure: { reason: "system_failure", body: FALLBACK_REQUIRED, kind: "provider_fallback" },
});

export function websiteHumanReviewResponse(reason: WebsiteHumanReviewReason): WebsiteHumanReviewResponse {
  return RESPONSES[reason];
}
