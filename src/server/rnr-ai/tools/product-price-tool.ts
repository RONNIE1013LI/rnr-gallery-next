import type { CompiledBusinessBrain } from "../business-brain/schema";
import type { ToolEvidence } from "../types";
import type { CanonicalProductPriceRequest } from "./types";

export const priceRuleByProduct: Readonly<Record<"NZ" | "AU", Readonly<Record<string, string>>>> = {
  NZ: {
    photo_print_canvas: "nz-canvas-base-prices",
    digital_oil_painting_canvas: "nz-canvas-base-prices",
    roll_up_banner: "nz-roll-up-banner",
    wall_banner: "nz-wall-banner-prices",
    banner_bundle: "nz-banner-bundle-prices",
    grave_cover: "grave-cover-pricing-review",
    oil_painting_banner: "oil-painting-banner-pricing-review",
  },
  AU: {
    photo_print_canvas: "au-photo-canvas-prices",
    digital_oil_painting_canvas: "au-oil-painting-canvas-prices",
    custom_themed_canvas: "au-themed-canvas-prices",
    roll_up_banner: "au-roll-up-banner-price",
    wall_banner: "au-wall-banner-prices",
    oil_painting_banner: "au-oil-painting-banner-prices",
    grave_cover: "au-grave-cover-price",
    banner_bundle: "au-banner-bundle-prices",
  },
};

function numericFact(facts: Record<string, unknown>, size: string | undefined) {
  if (size) {
    const prices = facts.pricesMinor;
    if (prices && typeof prices === "object" && !Array.isArray(prices)) {
      const amount = (prices as Record<string, unknown>)[size];
      return typeof amount === "number" ? amount : null;
    }
  }
  return typeof facts.priceMinor === "number" ? facts.priceMinor : null;
}

export function canonicalProductPrice(
  businessBrain: CompiledBusinessBrain,
  request: CanonicalProductPriceRequest,
): ToolEvidence {
  const product = request.input.product.trim().toLowerCase();
  const ruleId = priceRuleByProduct[request.input.market][product];
  const rule = businessBrain.rules.find((candidate) => candidate.id === ruleId);
  if (!rule || rule.status === "REVIEW" || !rule.autonomous) {
    return Object.freeze({
      tool: request.name,
      status: "unavailable_review_required",
      source: rule?.id ?? "no_canonical_rule",
      facts: Object.freeze({}),
    });
  }
  const facts = (rule.facts ?? {}) as Record<string, unknown>;
  const amountMinor = numericFact(facts, request.input.size);
  if (amountMinor === null) {
    return Object.freeze({
      tool: request.name,
      status: "unavailable_review_required",
      source: rule.id,
      facts: Object.freeze({}),
    });
  }
  return Object.freeze({
    tool: request.name,
    status: "available",
    source: rule.id,
    facts: Object.freeze({
      amountMinor,
      currency: rule.currency,
      size: request.input.size ?? null,
      taxPresentation: facts.taxPresentation ?? null,
    }),
  });
}
