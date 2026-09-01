import { describe, expect, it } from "vitest";
import {
  defaultProductRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import { resolveConversationState } from "./conversation/conversation-state";
import { resolveApprovedPricing } from "./pricing-source";
import type { ConversationContextItem } from "./repositories/customer-service-repository";
import type { SafeProductContext } from "./types";

const at = "2026-09-01T07:00:00.000Z";
const customer = (text: string) => ({ role: "customer" as const, text, receivedAt: at });

function stateFor(currentText: string, input: Readonly<{
  history?: readonly ConversationContextItem[];
  productContext?: SafeProductContext | null;
  registry?: ProductRegistryDocument;
}> = {}) {
  return resolveConversationState({
    currentText,
    history: input.history ?? [],
    productContext: input.productContext ?? null,
    registry: input.registry ?? defaultProductRegistry,
  });
}

describe("Reply Assistant approved pricing source", () => {
  it("uses the complete canonical A2 Digital Oil Canvas total for three people", () => {
    expect(resolveApprovedPricing({
      state: stateFor(
        "A2 digital oil painting canvas, 3 people",
        { history: [customer("I am in New Zealand. How much is it?")] },
      ),
      registry: defaultProductRegistry,
      revision: 42,
    })).toEqual({
      status: "verified",
      sourceRevision: 42,
      market: "NZ",
      facts: [{
        productKey: "digital-oil-painting-canvas",
        productTitle: "Digital Oil Painting Canvas",
        sizeKey: "a2",
        sizeLabel: "A2 — 59.4 × 42 cm",
        peoplePets: 3,
        currency: "NZD",
        amountInclTaxCents: 21_045,
        formattedAmount: "NZ$210.45",
      }],
    });
  });

  it("asks only for Canvas subtype when market, A2, and three people are known", () => {
    expect(resolveApprovedPricing({
      state: stateFor("A2 3 people", {
        history: [customer("How much for canvas in NZ?")],
      }),
      registry: defaultProductRegistry,
      revision: 43,
    })).toEqual({
      status: "clarification_required",
      missing: ["product"],
      sourceRevision: 43,
    });
  });

  it("quotes Roll-up after the customer supplies only the market on the next turn", () => {
    expect(resolveApprovedPricing({
      state: stateFor("New Zealand", {
        history: [customer("How much for roll up banner?")],
      }),
      registry: defaultProductRegistry,
      revision: 44,
    })).toMatchObject({
      status: "verified",
      sourceRevision: 44,
      market: "NZ",
      facts: [{
        productKey: "roll-up-banner",
        sizeKey: "standard",
        amountInclTaxCents: 26_450,
      }],
    });
  });

  it("asks for the missing market and product on a broad pricing question", () => {
    expect(resolveApprovedPricing({
      state: stateFor("How much are your products?"),
      registry: defaultProductRegistry,
      revision: 7,
    })).toEqual({
      status: "clarification_required",
      missing: ["market", "product"],
      sourceRevision: 7,
    });
  });

  it("returns an exact current price only from the selected market price book", () => {
    expect(resolveApprovedPricing({
      state: stateFor("What does a roll-up banner cost?", {
        history: [customer("I am in New Zealand.")],
      }),
      registry: defaultProductRegistry,
      revision: 8,
    })).toEqual({
      status: "verified",
      sourceRevision: 8,
      market: "NZ",
      facts: [{
        productKey: "roll-up-banner",
        productTitle: "Roll-Up Banner",
        sizeKey: "standard",
        sizeLabel: "85 × 200 cm",
        currency: "NZD",
        amountInclTaxCents: 26_450,
        formattedAmount: "NZ$264.50",
      }],
    });
  });

  it("asks which catalogue product instead of guessing an ambiguous canvas price", () => {
    expect(resolveApprovedPricing({
      state: stateFor("How much is an A1 canvas?", {
        history: [customer("NZ")],
      }),
      registry: defaultProductRegistry,
      revision: 9,
    })).toEqual({
      status: "clarification_required",
      missing: ["product"],
      sourceRevision: 9,
    });
  });

  it("fails closed when the requested current market price is not configured", () => {
    expect(resolveApprovedPricing({
      state: stateFor("What does a roll-up banner cost?", {
        history: [customer("Australia")],
      }),
      registry: defaultProductRegistry,
      revision: 10,
    })).toEqual({ status: "unavailable", reason: "market_disabled" });
  });

  it("prefers the customer's explicit product and market over stale page context", () => {
    expect(resolveApprovedPricing({
      state: stateFor("What does a roll-up banner cost in Australia?", {
        productContext: {
          market: "NZ",
          productKey: "custom-themed-canvas",
          productTitle: "Custom Themed Canvas",
          category: "canvas",
          pageKind: "product",
        },
      }),
      registry: defaultProductRegistry,
      revision: 11,
    })).toEqual({ status: "unavailable", reason: "market_disabled" });
  });

  it("ignores staff market choices when resolving customer pricing", () => {
    expect(resolveApprovedPricing({
      state: stateFor("What does a roll-up banner cost?", {
        history: [{
          role: "staff",
          text: "Is that for Australia or New Zealand?",
          receivedAt: at,
        }],
      }),
      registry: defaultProductRegistry,
      revision: 12,
    })).toEqual({
      status: "clarification_required",
      missing: ["market"],
      sourceRevision: 12,
    });
  });

  it("rejects a disabled market even if stale prices remain configured", () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.markets.NZ.enabled = false;
    expect(resolveApprovedPricing({
      state: stateFor("What does a roll-up banner cost in New Zealand?", { registry }),
      registry,
      revision: 13,
    })).toEqual({ status: "unavailable", reason: "market_disabled" });
  });

  it("resolves an exact configured numeric catalogue size", () => {
    expect(resolveApprovedPricing({
      state: stateFor("How much is a 160 x 80 cm wall banner in New Zealand?"),
      registry: defaultProductRegistry,
      revision: 14,
    })).toEqual({
      status: "verified",
      sourceRevision: 14,
      market: "NZ",
      facts: [{
        productKey: "custom-themed-wall-banner",
        productTitle: "Custom Themed Wall Banner",
        sizeKey: "160x80",
        sizeLabel: "160 × 80 cm",
        currency: "NZD",
        amountInclTaxCents: 18_975,
        formattedAmount: "NZ$189.75",
      }],
    });
  });

  it("fails closed for an unconfigured numeric size", () => {
    expect(resolveApprovedPricing({
      state: stateFor("How much is a 137 x 289 cm wall banner in New Zealand?"),
      registry: defaultProductRegistry,
      revision: 15,
    })).toEqual({ status: "unavailable", reason: "size_not_configured" });
  });
});
