import { describe, expect, it } from "vitest";
import { websiteHumanReviewResponse } from "./human-review";

describe("website human-review response policy", () => {
  it.each([
    [
      "realtime_required",
      "I can help collect the details for our team. Please send the product, size, number of people/photos, required date, and your suburb or postcode if delivery is needed. We’ll review the current details and get back to you.",
      "policy_acknowledgement",
    ],
    [
      "high_risk",
      "Thanks for letting us know. Our team needs to review this before replying, and we’ll get back to you as soon as we can.",
      "policy_acknowledgement",
    ],
    [
      "unresolved",
      "Thanks for letting us know. Our team needs to review this before replying, and we’ll get back to you as soon as we can.",
      "policy_acknowledgement",
    ],
    [
      "budget_blocked",
      "Thanks for your message. Our team will review it and reply here as soon as we can.",
      "provider_fallback",
    ],
    [
      "provider_error",
      "Thanks for your message. Our team will review it and reply here as soon as we can.",
      "provider_fallback",
    ],
    [
      "output_blocked",
      "Thanks for your message. Our team will review it and reply here as soon as we can.",
      "provider_fallback",
    ],
    [
      "system_failure",
      "Thanks for your message. Our team will review it and reply here as soon as we can.",
      "provider_fallback",
    ],
  ] as const)("uses the reviewed %s acknowledgement", (reason, body, kind) => {
    expect(websiteHumanReviewResponse(reason)).toEqual({ reason, body, kind });
  });
});
