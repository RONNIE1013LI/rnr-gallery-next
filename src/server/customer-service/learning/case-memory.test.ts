import { describe, expect, it } from "vitest";
import { assessCaseMemoryEligibility, selectAutoReusableCaseMemoryIds } from "./case-memory";

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
    ["percentage promotion", { humanReply: "We can offer 20% off this week." }, "realtime_value"],
    ["current capacity", { humanReply: "We have room to complete it this week." }, "realtime_value"],
    ["order status", { humanReply: "Your order is ready for pickup." }, "realtime_value"],
    ["tracking status", { humanReply: "Your tracking status shows delivered." }, "realtime_value"],
    ["customer balance", { humanReply: "Your remaining balance is 120." }, "realtime_value"],
    ["price without currency", { humanReply: "The current price is 189.75." }, "realtime_value"],
    ["historical price without currency", { humanReply: "The price was 189.75 for that order." }, "realtime_value"],
    ["shipping quote without currency", { humanReply: "The shipping quote is 68 for this address." }, "realtime_value"],
    ["promo code", { humanReply: "Use promo code FAMILY20 at checkout." }, "one_off_or_promotion"],
    ["production promise", { humanReply: "We can finish it by Friday." }, "delivery_or_eta"],
    ["delivery duration", { humanReply: "Delivery takes 2 working days." }, "delivery_or_eta"],
    ["parcel status", { humanReply: "The parcel has been dispatched." }, "realtime_value"],
    ["product price statement", { humanReply: "A1 canvas is 189.75 including GST." }, "realtime_value"],
    ["generic promo code", { humanReply: "Use code SAVE20 at checkout." }, "one_off_or_promotion"],
    ["production slot promise", { humanReply: "We can fit your order in before Friday." }, "delivery_or_eta"],
    ["parcel left studio", { humanReply: "Your parcel has left our studio." }, "realtime_value"],
    ["redacted source", { redactionCodes: ["phone_redacted"] }, "sensitive_source"],
  ])("excludes %s", (_label, override, code) => {
    expect(assessCaseMemoryEligibility({
      riskClass: "low",
      gateReasons: ["confirmed_rule"],
      customerSituation: "Customer asks a normal question.",
      humanReply: "Please send the details.",
      redactionCodes: [],
      ...override as Partial<Parameters<typeof assessCaseMemoryEligibility>[0]>,
    })).toMatchObject({ eligible: false, status: "excluded", exclusionCodes: expect.arrayContaining([code]) });
  });
});

describe("automatic low-risk case reuse", () => {
  const safeCase = (id: string, conversationKey: string, overrides = {}) => ({
    id,
    conversationKey,
    intent: "quote_information_collection",
    riskClass: "low" as const,
    sourceConfidence: "high" as const,
    editClassification: "independent_reply",
    policyReferences: ["QUOTE-INFO-01"],
    productCategory: "canvas",
    market: "NZ" as const,
    normalizedSituation: "Customer asks what information is needed for a canvas quote.",
    humanFinalReply: "Please send the canvas size, number of people and required date.",
    exclusionCodes: [] as readonly string[],
    ...overrides,
  });

  it("selects a repeated low-risk pattern from three distinct conversations", () => {
    expect(selectAutoReusableCaseMemoryIds([
      safeCase("case-1", "conversation-1"),
      safeCase("case-2", "conversation-2"),
      safeCase("case-3", "conversation-3"),
    ])).toEqual(["case-1", "case-2", "case-3"]);
  });

  it("does not count repeated replies from one conversation as independent evidence", () => {
    expect(selectAutoReusableCaseMemoryIds([
      safeCase("case-1", "conversation-1"),
      safeCase("case-2", "conversation-1"),
      safeCase("case-3", "conversation-2"),
    ])).toEqual([]);
  });

  it.each([
    ["medium risk", { riskClass: "medium" }],
    ["medium confidence", { sourceConfidence: "medium" }],
    ["missing policy evidence", { policyReferences: [] }],
    ["excluded source", { exclusionCodes: ["realtime_value"] }],
    ["payment intent", { intent: "payment_process" }],
    ["production intent", { intent: "production_process" }],
    ["photo intent", { intent: "photo_guidance" }],
    ["revision intent", { intent: "revision_policy" }],
  ])("fails closed for %s", (_label, override) => {
    expect(selectAutoReusableCaseMemoryIds([
      safeCase("case-1", "conversation-1", override),
      safeCase("case-2", "conversation-2", override),
      safeCase("case-3", "conversation-3", override),
    ])).toEqual([]);
  });

  it("does not combine different product, market or policy scopes", () => {
    expect(selectAutoReusableCaseMemoryIds([
      safeCase("case-1", "conversation-1"),
      safeCase("case-2", "conversation-2", { productCategory: "banners" }),
      safeCase("case-3", "conversation-3", { market: "AU" }),
      safeCase("case-4", "conversation-4", { policyReferences: ["QUOTE-INFO-02"] }),
    ])).toEqual([]);
  });

  it("requires similar customer situations and human replies", () => {
    expect(selectAutoReusableCaseMemoryIds([
      safeCase("case-1", "conversation-1"),
      safeCase("case-2", "conversation-2"),
      safeCase("case-3", "conversation-3", {
        normalizedSituation: "Customer asks whether a roll-up banner includes a stand.",
        humanFinalReply: "A roll-up banner includes a stand, carry bag, pegs and a box.",
      }),
    ])).toEqual([]);
  });
});
