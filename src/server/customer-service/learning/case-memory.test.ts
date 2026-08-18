import { describe, expect, it } from "vitest";
import { assessCaseMemoryEligibility } from "./case-memory";

describe("case memory eligibility", () => {
  it("allows a normal low-risk process example only as pending review", () => {
    expect(assessCaseMemoryEligibility({
      riskClass: "low",
      gateReasons: ["confirmed_rule"],
      customerSituation: "Customer asks how the design process works.",
      humanReply: "Send your photos, wording and theme and we will prepare a draft.",
      redactionCodes: [],
    })).toEqual({ eligible: true, status: "pending_review", exclusionCodes: [] });
  });

  it.each([
    ["high risk", { riskClass: "high", humanReply: "We can help." }, "high_risk"],
    ["discount", { humanReply: "I can give you a $30 discount." }, "special_discount"],
    ["compensation", { humanReply: "We can offer compensation." }, "compensation"],
    ["refund", { humanReply: "We will make a refund exception." }, "refund_or_cancellation"],
    ["damaged goods", { customerSituation: "The item arrived damaged." }, "damaged_or_misprint"],
    ["payment dispute", { customerSituation: "Customer opened a chargeback." }, "payment_dispute"],
    ["shipping amount", { humanReply: "Shipping was $68." }, "realtime_value"],
    ["delivery promise", { humanReply: "It will arrive tomorrow." }, "delivery_or_eta"],
    ["redacted source", { redactionCodes: ["phone_redacted"] }, "sensitive_source"],
  ])("excludes %s", (_label, override, code) => {
    expect(assessCaseMemoryEligibility({
      riskClass: "low",
      gateReasons: ["confirmed_rule"],
      customerSituation: "Customer asks a normal question.",
      humanReply: "Please send the details.",
      redactionCodes: [],
      ...override,
    })).toMatchObject({ eligible: false, status: "excluded", exclusionCodes: expect.arrayContaining([code]) });
  });
});
