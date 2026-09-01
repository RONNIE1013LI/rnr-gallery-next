import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveConversationState } from "./conversation/conversation-state";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { evaluatePolicyGate } from "./policy-gate";
import { resolveApprovedPricing } from "./pricing-source";
import type { ConversationContextItem } from "./repositories/customer-service-repository";
import type { CustomerServiceChannel } from "./types";

const at = "2026-09-01T07:00:00.000Z";
const customer = (text: string): ConversationContextItem => ({ role: "customer", text, receivedAt: at });
const staff = (text: string): ConversationContextItem => ({ role: "staff", text, receivedAt: at });

function businessOutcome(
  channel: CustomerServiceChannel,
  currentText: string,
  history: readonly ConversationContextItem[],
) {
  const state = resolveConversationState({
    currentText,
    history,
    productContext: null,
    registry: defaultProductRegistry,
  });
  const gate = evaluatePolicyGate({
    message: currentText,
    knowledge: compiledKnowledge,
    channel,
    intentOverride: state.intent.value,
    isContextualQuoteDetail: state.intent.value === "quote_information_collection"
      && state.intent.source !== "current_message",
  });
  const pricing = state.asksCataloguePrice
    ? resolveApprovedPricing({ state, registry: defaultProductRegistry, revision: 12 })
    : null;
  return {
    intent: state.intent.value,
    market: state.market?.value ?? null,
    productKey: state.product?.productKey ?? null,
    productCandidates: state.productCandidates,
    size: state.size?.value ?? null,
    peoplePets: state.peoplePets?.value ?? null,
    missingFields: state.missingFields,
    gate: { decision: gate.decision, reason: gate.reason },
    pricing: pricing?.status === "verified"
      ? {
        status: pricing.status,
        amountInclTaxCents: pricing.facts[0]?.amountInclTaxCents ?? null,
      }
      : pricing?.status === "clarification_required"
        ? { status: pricing.status, missing: pricing.missing }
        : pricing,
  };
}

describe("Facebook and Website business parity", () => {
  it.each([
    {
      name: "Roll-up follow-up NZ",
      currentText: "New Zealand",
      history: [
        customer("How much for roll up banner?"),
        staff("Is this for New Zealand or Australia?"),
        customer("New Zealand"),
      ],
      expected: {
        intent: "quote_information_collection",
        market: "NZ",
        productKey: "roll-up-banner",
        productCandidates: [],
        size: "standard",
        peoplePets: null,
        missingFields: [],
        gate: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        pricing: { status: "verified", amountInclTaxCents: 26_450 },
      },
    },
    {
      name: "Roll-up direct NZ",
      currentText: "How much is a roll up banner in NZ?",
      history: [customer("How much is a roll up banner in NZ?")],
      expected: {
        intent: "quote_information_collection",
        market: "NZ",
        productKey: "roll-up-banner",
        productCandidates: [],
        size: "standard",
        peoplePets: null,
        missingFields: [],
        gate: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        pricing: { status: "verified", amountInclTaxCents: 26_450 },
      },
    },
    {
      name: "A2 Canvas follow-up",
      currentText: "A2, 3 people",
      history: [
        customer("How much for canvas in NZ?"),
        staff("Which Canvas type would you like?"),
        customer("A2, 3 people"),
      ],
      expected: {
        intent: "quote_information_collection",
        market: "NZ",
        productKey: null,
        productCandidates: [
          "photo-print-canvas",
          "digital-oil-painting-canvas",
          "custom-themed-canvas",
        ],
        size: "a2",
        peoplePets: 3,
        missingFields: ["PRODUCT_TYPE"],
        gate: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        pricing: { status: "clarification_required", missing: ["product"] },
      },
    },
    {
      name: "Wall Banner AU",
      currentText: "How much for a wall hanging banner in Australia?",
      history: [customer("How much for a wall hanging banner in Australia?")],
      expected: {
        intent: "quote_information_collection",
        market: "AU",
        productKey: "custom-themed-wall-banner",
        productCandidates: [],
        size: null,
        peoplePets: null,
        missingFields: ["SIZE"],
        gate: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        pricing: { status: "clarification_required", missing: ["size"] },
      },
    },
    {
      name: "Brisbane shipping",
      currentText: "Do you ship to Brisbane?",
      history: [customer("Do you ship to Brisbane?")],
      expected: {
        intent: "unknown",
        market: null,
        productKey: null,
        productCandidates: [],
        size: null,
        peoplePets: null,
        missingFields: [],
        gate: { decision: "NEEDS_HUMAN_REVIEW", reason: "unresolved_intent" },
        pricing: null,
      },
    },
    {
      name: "Turnaround",
      currentText: "How long does it take?",
      history: [customer("How long does it take?")],
      expected: {
        intent: "unknown",
        market: null,
        productKey: null,
        productCandidates: [],
        size: null,
        peoplePets: null,
        missingFields: [],
        gate: { decision: "NEEDS_HUMAN_REVIEW", reason: "unresolved_intent" },
        pricing: null,
      },
    },
  ])("keeps $name at the same business outcome", ({ currentText, history, expected }) => {
    const facebook = businessOutcome("facebook", currentText, history);
    const website = businessOutcome("website", currentText, history);

    expect(facebook).toEqual(expected);
    expect(website).toEqual(expected);
    expect(website).toEqual(facebook);
  });
});
