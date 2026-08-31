import { describe, expect, it } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveApprovedPricing } from "./pricing-source";

describe("Reply Assistant approved pricing source", () => {
  it("asks for the missing market and product on a broad pricing question", () => {
    expect(resolveApprovedPricing({
      message: "How much are your products?",
      context: [],
      productContext: null,
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
      message: "What does a roll-up banner cost?",
      context: [{ role: "customer", text: "I am in New Zealand." }],
      productContext: null,
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
      message: "How much is an A1 canvas?",
      context: [{ role: "customer", text: "NZ" }],
      productContext: null,
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
      message: "What does a roll-up banner cost?",
      context: [{ role: "customer", text: "Australia" }],
      productContext: null,
      registry: defaultProductRegistry,
      revision: 10,
    })).toEqual({ status: "unavailable", reason: "market_disabled" });
  });

  it("prefers the customer's explicit product and market over stale page context", () => {
    expect(resolveApprovedPricing({
      message: "What does a roll-up banner cost in Australia?",
      context: [],
      productContext: {
        market: "NZ",
        productKey: "custom-themed-canvas",
        productTitle: "Custom Themed Canvas",
        category: "canvas",
        pageKind: "product",
      },
      registry: defaultProductRegistry,
      revision: 11,
    })).toEqual({ status: "unavailable", reason: "market_disabled" });
  });

  it("ignores staff market choices when resolving customer pricing", () => {
    expect(resolveApprovedPricing({
      message: "What does a roll-up banner cost?",
      context: [{ role: "staff", text: "Is that for Australia or New Zealand?" }],
      productContext: null,
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
      message: "What does a roll-up banner cost in New Zealand?",
      context: [],
      productContext: null,
      registry,
      revision: 13,
    })).toEqual({ status: "unavailable", reason: "market_disabled" });
  });

  it("resolves an exact configured numeric catalogue size", () => {
    expect(resolveApprovedPricing({
      message: "How much is a 160 x 80 cm wall banner in New Zealand?",
      context: [],
      productContext: null,
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
      message: "How much is a 137 x 289 cm wall banner in New Zealand?",
      context: [],
      productContext: null,
      registry: defaultProductRegistry,
      revision: 15,
    })).toEqual({ status: "unavailable", reason: "size_not_configured" });
  });
});
