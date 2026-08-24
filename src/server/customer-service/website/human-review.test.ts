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

  it.each([
    [
      "realtime_required",
      "How much is an A3 canvas today?",
      "I can help with that. Is this for a custom design using your photos, or are you supplying your own finished design? Once I know that, I can ask for any other details needed and our team can confirm the current A3 price for you.",
    ],
    [
      "realtime_required",
      "How much is delivery to Brisbane?",
      "Sure 😊 Please send your Brisbane suburb or postcode and let me know which product and size you’re interested in. Our team can then confirm the current delivery cost for you.",
    ],
    [
      "high_risk",
      "My order arrived damaged.",
      "I’m sorry to hear that. Please send your order number and a few clear photos showing the damage. I’ll pass this to our team to review before we confirm the next step.",
    ],
    [
      "high_risk",
      "I want to cancel my order and request a refund.",
      "Thanks for letting us know. Please send your order number so our team can review the current order status and your cancellation/refund request before confirming what options are available.",
    ],
    [
      "high_risk",
      "I think I was charged twice.",
      "I’m sorry about that. Please send your order number and, if possible, the date and amount of the two charges so our team can check what happened. Please don’t send any card numbers or other sensitive payment details here.",
    ],
    [
      "high_risk",
      "This is a private issue and I need a person.",
      "Of course. I’ve marked this for our team to review privately. If you have an order number, please send that through, but please don’t include any sensitive payment or personal information here.",
    ],
  ] as const)("uses an intent-specific %s response for %s", (reason, message, body) => {
    expect(websiteHumanReviewResponse(reason, { message })).toEqual({
      reason,
      body,
      kind: "policy_acknowledgement",
    });
  });

  it.each(["provider_error", "output_blocked", "system_failure"] as const)(
    "uses the approved system fallback for %s",
    (reason) => {
      expect(websiteHumanReviewResponse(reason, { message: "Can you help with my design?" })).toEqual({
        reason,
        body: "Sorry, I can’t complete that right now. I’ve marked your message for our team to review, so you don’t need to send it again.",
        kind: "provider_fallback",
      });
    },
  );
});
