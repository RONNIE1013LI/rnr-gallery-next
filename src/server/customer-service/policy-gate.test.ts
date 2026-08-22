import { describe, expect, it } from "vitest";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { evaluatePolicyGate } from "./policy-gate";

describe("customer service policy gate", () => {
  it("allows confirmed low-risk draft scopes", () => {
    expect(evaluatePolicyGate({
      message: "What details do you need to prepare a quote?",
      knowledge: compiledKnowledge,
    })).toMatchObject({
      decision: "DRAFT_ALLOWED",
      intent: "quote_information_collection",
      providerAllowed: true,
      ruleIds: ["AI-SCOPE-03"],
    });
  });

  it.each([
    "I want a refund",
    "Please cancel my order",
    "The item arrived damaged",
    "I need a reprint for this misprint",
    "I want compensation",
    "I am filing a chargeback",
    "Can you guarantee delivery by Friday?",
    "Can you guarantee this urgent order tomorrow?",
  ])("blocks high-risk message before a provider: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge })).toMatchObject({
      decision: "NEEDS_HUMAN_REVIEW",
      providerAllowed: false,
      riskLevel: "high",
      reason: "high_risk_topic",
    });
  });

  it("blocks live price, timing and order data", () => {
    expect(evaluatePolicyGate({
      message: "How much is an A1 canvas today?",
      knowledge: compiledKnowledge,
    })).toMatchObject({ decision: "REALTIME_DATA_REQUIRED", providerAllowed: false });
    expect(evaluatePolicyGate({
      message: "What is my order status?",
      knowledge: compiledKnowledge,
    })).toMatchObject({ decision: "REALTIME_DATA_REQUIRED", providerAllowed: false });
  });

  it.each([
    "Can I see my design draft?",
    "Can I review my current design draft?",
    "Can I see the draft for order 123456?",
    "What details do you need from my current design draft to prepare a quote?",
    "How does the deposit process work for the current proof?",
    "Can you explain the design process and show me the proof attached to order 123456?",
  ])("blocks private or current design records before a provider: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge, channel: "website" })).toMatchObject({
      decision: "REALTIME_DATA_REQUIRED",
      providerAllowed: false,
      reason: "realtime_data_required",
    });
  });

  it.each([
    "What details do you need from my current\ndesign draft to prepare a quote?",
    "Can you explain the design process and show me the latest proof?",
    "What wording is on the draft you prepared for me?",
    "Can you explain the design process and show the proof linked to my order?",
  ])("fails closed for Website private-record wording variants: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge, channel: "website" })).toMatchObject({
      decision: "REALTIME_DATA_REQUIRED",
      providerAllowed: false,
      reason: "realtime_data_required",
    });
  });

  it("does not change the existing Facebook gate for private-record wording", () => {
    expect(evaluatePolicyGate({
      message: "What details do you need from my current design draft to prepare a quote?",
      knowledge: compiledKnowledge,
      channel: "facebook",
    })).toMatchObject({
      decision: "DRAFT_ALLOWED",
      providerAllowed: true,
    });
  });

  it("checks current high-risk and realtime wording before a contextual intent override", () => {
    expect(evaluatePolicyGate({
      message: "I want a refund",
      intentOverride: "quote_information_collection",
      knowledge: compiledKnowledge,
    })).toMatchObject({ providerAllowed: false, reason: "high_risk_topic" });
    expect(evaluatePolicyGate({
      message: "How much is it?",
      intentOverride: "quote_information_collection",
      knowledge: compiledKnowledge,
    })).toMatchObject({ providerAllowed: false, reason: "realtime_data_required" });
    expect(evaluatePolicyGate({
      message: "Australia",
      intentOverride: "quote_information_collection",
      knowledge: compiledKnowledge,
    })).toMatchObject({ providerAllowed: true, intent: "quote_information_collection" });
    expect(evaluatePolicyGate({
      message: "A1",
      intentOverride: "quote_information_collection",
      isContextualQuoteDetail: true,
      knowledge: compiledKnowledge,
    })).toMatchObject({ providerAllowed: true, intent: "quote_information_collection" });
    expect(evaluatePolicyGate({
      message: "How much is A1?",
      intentOverride: "quote_information_collection",
      knowledge: compiledKnowledge,
    })).toMatchObject({ providerAllowed: false, reason: "realtime_data_required" });
  });

  it("blocks evidence-based and unresolved supporting rules", () => {
    expect(evaluatePolicyGate({
      message: "How many free revisions do I get?",
      knowledge: compiledKnowledge,
    })).toMatchObject({
      decision: "NEEDS_HUMAN_REVIEW",
      providerAllowed: false,
      reason: "policy_not_confirmed",
    });
    expect(evaluatePolicyGate({
      message: "Can I use Afterpay?",
      knowledge: compiledKnowledge,
    })).toMatchObject({ decision: "NEEDS_HUMAN_REVIEW", providerAllowed: false });
  });
});
