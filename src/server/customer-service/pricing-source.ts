import {
  schemaFromRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import type { Market } from "@/domain/markets/types";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";
import { InvalidPricingInputError } from "@/domain/pricing/types";
import type { ConversationState } from "./conversation/conversation-state";

export type ApprovedPricingFact = Readonly<{
  productKey: string;
  productTitle: string;
  sizeKey: string;
  sizeLabel: string;
  peoplePets?: number;
  currency: "NZD" | "AUD";
  amountInclTaxCents: number;
  formattedAmount: string;
}>;

export type ApprovedPricingResolution =
  | Readonly<{
    status: "clarification_required";
    missing: readonly ("market" | "product" | "size" | "peoplePets")[];
    sourceRevision: number;
  }>
  | Readonly<{
    status: "verified";
    sourceRevision: number;
    market: Market;
    facts: readonly ApprovedPricingFact[];
  }>
  | Readonly<{
    status: "unavailable";
    reason: "price_not_configured" | "size_not_configured" | "market_disabled" | "catalogue_unavailable";
  }>;

function formattedAmount(currency: "NZD" | "AUD", amountInclTaxCents: number) {
  return `${currency === "NZD" ? "NZ$" : "AU$"}${(amountInclTaxCents / 100).toFixed(2)}`;
}

type StatePricingInput = Readonly<{
  state: ConversationState;
  registry: ProductRegistryDocument;
  revision: number;
}>;

export function resolveApprovedPricing(input: StatePricingInput): ApprovedPricingResolution {
  const market = input.state.market?.value ?? null;
  const productKey = input.state.product?.productKey ?? null;
  const sizeKey = input.state.size?.value ?? null;
  const missing: ("market" | "product" | "size" | "peoplePets")[] = [];
  if (!market) missing.push("market");
  if (!productKey) missing.push("product");
  if (productKey && !sizeKey) missing.push("size");
  if (missing.length) {
    return { status: "clarification_required", missing, sourceRevision: input.revision };
  }
  if (!market || !productKey || !sizeKey) {
    throw new Error("approved_pricing_state_invariant");
  }

  const product = input.registry.products.find((candidate) => (
    candidate.active && candidate.key === productKey
  ));
  const schema = schemaFromRegistry(input.registry, productKey);
  if (!product || !schema) return { status: "unavailable", reason: "price_not_configured" };
  const size = product.configuration.sizes.find((candidate) => candidate.key === sizeKey);
  if (!size) return { status: "unavailable", reason: "size_not_configured" };
  if (!input.registry.markets[market].enabled) {
    return { status: "unavailable", reason: "market_disabled" };
  }

  const peoplePets = schema.peoplePetsMode === "required"
    ? input.state.peoplePets?.value ?? null
    : 0;
  if (peoplePets === null) {
    return {
      status: "clarification_required",
      missing: ["peoplePets"],
      sourceRevision: input.revision,
    };
  }

  try {
    const quote = quoteMarketConfiguration(input.registry, market, productKey, {
      sizeKey,
      peoplePets,
      ...(input.state.photoCount
        ? { sourcePhotoCount: input.state.photoCount.value }
        : {}),
    });
    return {
      status: "verified",
      sourceRevision: input.revision,
      market,
      facts: [{
        productKey,
        productTitle: product.title,
        sizeKey,
        sizeLabel: size.label,
        ...(schema.peoplePetsMode === "required" ? { peoplePets } : {}),
        currency: quote.currency,
        amountInclTaxCents: quote.totalInclGstCents,
        formattedAmount: formattedAmount(quote.currency, quote.totalInclGstCents),
      }],
    };
  } catch (error) {
    if (!(error instanceof InvalidPricingInputError)) throw error;
    return {
      status: "unavailable",
      reason: /\bsize\b/i.test(error.message)
        ? "size_not_configured"
        : "price_not_configured",
    };
  }
}
