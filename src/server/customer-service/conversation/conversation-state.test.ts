import { describe, expect, it } from "vitest";
import {
  defaultProductRegistry,
  parseProductRegistry,
} from "@/domain/catalogue/product-registry";
import { resolveConversationState } from "./conversation-state";

const registry = parseProductRegistry(defaultProductRegistry);
const at = "2026-09-01T07:00:00.000Z";
const customer = (text: string) => ({ role: "customer" as const, text, receivedAt: at });
const staff = (text: string) => ({ role: "staff" as const, text, receivedAt: at });

describe("resolveConversationState", () => {
  it("preserves the Roll-up price request when the customer answers New Zealand", () => {
    const state = resolveConversationState({
      currentText: "New Zealand",
      history: [
        customer("How much for roll up banner?"),
        staff("Is this for New Zealand or Australia?"),
      ],
      productContext: null,
      registry,
    });

    expect(state.intent).toEqual({
      value: "quote_information_collection",
      source: "customer_history",
    });
    expect(state.market).toEqual({ value: "NZ", source: "current_message" });
    expect(state.product).toEqual({
      productKey: "roll-up-banner",
      source: "customer_history",
    });
    expect(state.size).toEqual({ value: "standard", source: "customer_history" });
    expect(state.asksCataloguePrice).toBe(true);
    expect(state.missingFields).toEqual([]);
  });

  it("treats an A-size plus people count as Digital Oil Painting in a Canvas quote", () => {
    const state = resolveConversationState({
      currentText: "A2 3 people",
      history: [
        customer("How much for canvas in New Zealand?"),
        staff("Which Canvas type would you like?"),
      ],
      productContext: null,
      registry,
    });

    expect(state.intent.value).toBe("quote_information_collection");
    expect(state.market?.value).toBe("NZ");
    expect(state.size).toEqual({ value: "a2", source: "current_message" });
    expect(state.peoplePets).toEqual({ value: 3, source: "current_message" });
    expect(state.product).toEqual({
      productKey: "digital-oil-painting-canvas",
      source: "current_message",
    });
    expect(state.productCandidates).toEqual([]);
    expect(state.missingFields).toEqual([]);
  });

  it("uses the selected Website market and infers Digital Oil Painting from A-size plus people", () => {
    const state = resolveConversationState({
      currentText: "A2 5 people",
      history: [
        customer("I'd like to get a quote."),
        staff("Which product format are you considering?"),
      ],
      productContext: null,
      pageMarket: "NZ",
      registry,
    });

    expect(state.market).toEqual({ value: "NZ", source: "server_page_context" });
    expect(state.intent).toEqual({
      value: "quote_information_collection",
      source: "customer_history",
    });
    expect(state.size).toEqual({ value: "a2", source: "current_message" });
    expect(state.peoplePets).toEqual({ value: 5, source: "current_message" });
    expect(state.product).toEqual({
      productKey: "digital-oil-painting-canvas",
      source: "current_message",
    });
    expect(state.productCandidates).toEqual([]);
    expect(state.asksCataloguePrice).toBe(true);
    expect(state.missingFields).toEqual([]);
  });

  it("retains the answered Canvas fields when the requested subtype is selected", () => {
    const state = resolveConversationState({
      currentText: "Digital oil painting canvas",
      history: [
        customer("How much for canvas in New Zealand?"),
        staff("Which Canvas type would you like?"),
        customer("A2 3 people"),
      ],
      productContext: null,
      registry,
    });

    expect(state).toMatchObject({
      intent: { value: "quote_information_collection", source: "customer_history" },
      market: { value: "NZ", source: "customer_history" },
      product: {
        productKey: "digital-oil-painting-canvas",
        source: "current_message",
      },
      productCandidates: [],
      size: { value: "a2", source: "customer_history" },
      peoplePets: { value: 3, source: "customer_history" },
      asksCataloguePrice: true,
      missingFields: [],
    });
  });

  it.each([
    "Which type of Canvas would you like?",
    "Would you prefer Photo Print, Digital Oil Painting, or Custom Themed Canvas?",
  ])("uses the open customer-derived Canvas subtype slot without depending on staff prose: %s", (question) => {
    const state = resolveConversationState({
      currentText: "Digital oil painting canvas",
      history: [
        customer("How much for canvas in New Zealand?"),
        staff(question),
        customer("A2 3 people"),
      ],
      productContext: null,
      registry,
    });

    expect(state).toMatchObject({
      product: { productKey: "digital-oil-painting-canvas" },
      size: { value: "a2", source: "customer_history" },
      peoplePets: { value: 3, source: "customer_history" },
      asksCataloguePrice: true,
      missingFields: [],
    });
  });

  it("does not merge an unprompted exact Canvas mention into an older ambiguous topic", () => {
    const state = resolveConversationState({
      currentText: "Digital oil painting canvas",
      history: [
        customer("How much for canvas in New Zealand?"),
        customer("A2 3 people"),
      ],
      productContext: null,
      registry,
    });

    expect(state.product?.productKey).toBe("digital-oil-painting-canvas");
    expect(state.size).toBeNull();
    expect(state.peoplePets).toBeNull();
    expect(state.missingFields).toEqual(["SIZE", "PEOPLE_COUNT"]);
  });

  it("clears incompatible Canvas values when the customer switches to Roll-up Banner", () => {
    const state = resolveConversationState({
      currentText: "Actually how much for a roll up banner?",
      history: [customer("A2 digital oil painting canvas with 3 people in NZ")],
      productContext: null,
      registry,
    });

    expect(state.product?.productKey).toBe("roll-up-banner");
    expect(state.size).toEqual({ value: "standard", source: "current_message" });
    expect(state.peoplePets).toBeNull();
  });

  it("never treats a staff statement as a customer fact", () => {
    const state = resolveConversationState({
      currentText: "yes",
      history: [staff("You are in Australia and want an A2 canvas")],
      productContext: null,
      registry,
    });

    expect(state.market).toBeNull();
    expect(state.product).toBeNull();
    expect(state.size).toBeNull();
  });

  it("uses trusted Website page context only after customer messages", () => {
    const state = resolveConversationState({
      currentText: "How much is this?",
      history: [],
      productContext: {
        market: "AU",
        productKey: "photo-print-canvas",
        productTitle: "Photo Print Canvas",
        category: "canvas",
        pageKind: "product",
      },
      registry,
    });

    expect(state.market).toEqual({ value: "AU", source: "server_page_context" });
    expect(state.product).toEqual({
      productKey: "photo-print-canvas",
      source: "server_page_context",
    });
  });

  it("keeps a specific Website product context ahead of generic Canvas candidates", () => {
    const state = resolveConversationState({
      currentText: "A2 5 people",
      history: [
        customer("How much for canvas in New Zealand?"),
        staff("Which Canvas type would you like?"),
      ],
      productContext: {
        market: "NZ",
        productKey: "photo-print-canvas",
        productTitle: "Photo Print Canvas",
        category: "canvas",
        pageKind: "product",
      },
      registry,
    });

    expect(state.product).toEqual({
      productKey: "photo-print-canvas",
      source: "server_page_context",
    });
    expect(state.productCandidates).toEqual([]);
    expect(state.peoplePets).toBeNull();
  });

  it("returns deeply immutable state", () => {
    const state = resolveConversationState({
      currentText: "How much for canvas in NZ?",
      history: [],
      productContext: null,
      registry,
    });

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.productCandidates)).toBe(true);
    expect(Object.isFrozen(state.missingFields)).toBe(true);
  });
});
