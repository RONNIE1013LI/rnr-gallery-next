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
    "I think I was charged twice",
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

  it.each([
    "How much are your products?",
    "Can I see your prices?",
    "How much is a banner?",
    "How much is an A1 canvas?",
    "What does a roll-up banner cost?",
    "What's the price for your banner bundle?",
    "Can I get your price list?",
  ])("allows static first-party catalogue pricing questions: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge })).toMatchObject({
      decision: "DRAFT_ALLOWED",
      intent: "quote_information_collection",
      providerAllowed: true,
    });
  });

  it.each([
    "Has my payment arrived?",
    "Is my order ready now?",
    "Can you guarantee delivery tomorrow?",
    "What is the exact courier charge to this remote address right now?",
    "Is this item currently in stock?",
    "Where is my courier tracking right now?",
    "Can you quote a custom 137 x 289 cm canvas?",
    "Can you guarantee the current price for an A1 canvas?",
  ])("keeps transactional or genuinely live facts blocked: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge })).toMatchObject({
      providerAllowed: false,
      riskLevel: "high",
    });
  });

  it("does not let contextual quote-detail inheritance bypass live shipping checks", () => {
    expect(evaluatePolicyGate({
      message: "How much is shipping?",
      knowledge: compiledKnowledge,
      intentOverride: "quote_information_collection",
      isContextualQuoteDetail: true,
    })).toMatchObject({
      decision: "REALTIME_DATA_REQUIRED",
      providerAllowed: false,
    });
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

  it.each([
    "Can you explain the design process and show me the most recent proof?",
    "What wording is on the proof that belongs to me?",
    "Can you explain the design process and show us our proof?",
    "Can you show me the recent proof?",
    "Can you show me the up-to-date proof?",
    "Can you show me the proof that is mine?",
    "Can you explain the design process and show us our proofs?",
    "Can you show me the current prοof?",
    "Can you show me the proof we are using now?",
  ])("recognizes Website private-record ownership and recency: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge, channel: "website" })).toMatchObject({
      decision: "REALTIME_DATA_REQUIRED",
      providerAllowed: false,
    });
  });

  it.each([
    "Can you explain the design process from order confirmation to draft review?",
    "In the general design process, do you confirm the order before preparing a draft?",
    "What details do you need to prepare a quote and later create a draft after the order is confirmed?",
    "How is a design draft created, and can you explain the general process to me?",
    "Can you explain how a design draft is created before a finished product is prepared for me?",
  ])("keeps generic Website order and draft process questions eligible: %s", (message) => {
    expect(evaluatePolicyGate({ message, knowledge: compiledKnowledge, channel: "website" })).toMatchObject({
      decision: "DRAFT_ALLOWED",
      providerAllowed: true,
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
    })).toMatchObject({ providerAllowed: true, intent: "quote_information_collection" });
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
    })).toMatchObject({ providerAllowed: true, intent: "quote_information_collection" });
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
