import {
  schemaFromRegistry,
  type ProductRegistryDocument,
} from "@/domain/catalogue/product-registry";
import type { Market } from "@/domain/markets/types";
import { quoteMarketConfiguration } from "@/domain/pricing/market-quote";
import { InvalidPricingInputError } from "@/domain/pricing/types";
import type { ConversationState } from "./conversation/conversation-state";
import type { SafeProductContext } from "./types";

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

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-NZ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveMarket(
  message: string,
  context: readonly Readonly<{ text: string; role?: unknown }>[],
  productContext: SafeProductContext | null,
): Market | null {
  const marketMention = (value: string): Market | "ambiguous" | null => {
    const mentionsAustralia = /\b(?:australia|australian|aud)\b/i.test(value);
    const mentionsNewZealand = /\b(?:new zealand|nzd)\b/i.test(value) || /(?:^|\W)nz(?:$|\W)/i.test(value);
    if (mentionsAustralia && mentionsNewZealand) return "ambiguous";
    if (mentionsAustralia) return "AU";
    if (mentionsNewZealand) return "NZ";
    return null;
  };
  const currentMention = marketMention(message);
  if (currentMention === "ambiguous") return null;
  if (currentMention) return currentMention;
  for (const item of [...context].reverse()) {
    if (item.role === "staff") continue;
    const mention = marketMention(item.text);
    if (mention === "ambiguous") return null;
    if (mention) return mention;
  }
  return productContext?.market === "NZ" || productContext?.market === "AU"
    ? productContext.market
    : null;
}

function explicitlyNamedProducts(message: string, registry: ProductRegistryDocument) {
  const value = ` ${normalized(message)} `;
  return registry.products.filter((product) => {
    if (!product.active) return false;
    const names = [product.title, product.key, product.slug].map(normalized);
    return names.some((name) => name && value.includes(` ${name} `));
  });
}

function matchingProducts(
  message: string,
  productContext: SafeProductContext | null,
  registry: ProductRegistryDocument,
) {
  const named = explicitlyNamedProducts(message, registry);
  if (named.length) return named;
  if (/\bwall banners?\b/i.test(message)) {
    return registry.products.filter((product) => (
      product.active && normalized(product.title).includes("wall banner")
    ));
  }
  if (productContext?.productKey) {
    const contextual = registry.products.find(
      (product) => product.active && product.key === productContext.productKey,
    );
    if (contextual) return [contextual];
  }
  if (/\bcanvas(?:es)?\b/i.test(message)) {
    return registry.products.filter((product) => product.active && product.category === "canvas");
  }
  if (/\bbanners?\b/i.test(message)) {
    return registry.products.filter((product) => product.active && product.category === "banners");
  }
  return [];
}

function requestedSizeKey(message: string) {
  const aSize = message.match(/\bA([0-4])\b/i);
  return aSize ? `a${aSize[1]}` : null;
}

function requestedDimensions(message: string) {
  const match = message.match(/\b(\d+)\s*[x×]\s*(\d+)\s*(?:cm)?\b/i);
  return match ? [Number(match[1]), Number(match[2])] as const : null;
}

function sizeDimensions(label: string) {
  const match = label.match(/\b(\d+)\s*[x×]\s*(\d+)\s*(?:cm)?\b/i);
  return match ? [Number(match[1]), Number(match[2])] as const : null;
}

function formattedAmount(currency: "NZD" | "AUD", amountInclTaxCents: number) {
  return `${currency === "NZD" ? "NZ$" : "AU$"}${(amountInclTaxCents / 100).toFixed(2)}`;
}

type StatePricingInput = Readonly<{
  state: ConversationState;
  registry: ProductRegistryDocument;
  revision: number;
}>;

type LegacyPricingInput = Readonly<{
  message: string;
  context: readonly Readonly<{ text: string; role?: unknown }>[];
  productContext: SafeProductContext | null;
  registry: ProductRegistryDocument;
  revision: number;
}>;

function resolveApprovedPricingFromState(input: StatePricingInput): ApprovedPricingResolution {
  const market = input.state.market?.value ?? null;
  const productKey = input.state.product?.productKey ?? null;
  const sizeKey = input.state.size?.value ?? null;
  const missing: ("market" | "product" | "size" | "peoplePets")[] = [];
  if (!market) missing.push("market");
  if (!productKey) missing.push("product");
  if (!sizeKey) missing.push("size");
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

function resolveApprovedPricingLegacy(input: LegacyPricingInput): ApprovedPricingResolution {
  const market = resolveMarket(input.message, input.context, input.productContext);
  const products = matchingProducts(input.message, input.productContext, input.registry);
  const missing: ("market" | "product" | "size")[] = [];
  if (!market) missing.push("market");
  if (products.length !== 1) missing.push("product");
  if (!market || products.length !== 1) {
    return { status: "clarification_required", missing, sourceRevision: input.revision };
  }

  const product = products[0]!;
  const requestedSize = requestedSizeKey(input.message);
  const dimensions = requestedDimensions(input.message);
  const sizes = requestedSize
    ? product.configuration.sizes.filter((size) => size.key === requestedSize)
    : dimensions
      ? product.configuration.sizes.filter((size) => {
        const configured = sizeDimensions(size.label);
        return configured?.[0] === dimensions[0] && configured[1] === dimensions[1];
      })
      : product.configuration.sizes;
  if (dimensions && sizes.length === 0) {
    return { status: "unavailable", reason: "size_not_configured" };
  }
  if (sizes.length !== 1) {
    return {
      status: "clarification_required",
      missing: ["size"],
      sourceRevision: input.revision,
    };
  }

  const priceBook = input.registry.markets[market];
  if (!priceBook.enabled) return { status: "unavailable", reason: "market_disabled" };
  const productPrices = priceBook.products.find((candidate) => candidate.productKey === product.key);
  const amountInclTaxCents = productPrices?.sizes.find(
    (candidate) => candidate.sizeKey === sizes[0].key,
  )?.amountInclTaxCents;
  if (amountInclTaxCents === null || amountInclTaxCents === undefined) {
    return { status: "unavailable", reason: "price_not_configured" };
  }

  return {
    status: "verified",
    sourceRevision: input.revision,
    market,
    facts: [{
      productKey: product.key,
      productTitle: product.title,
      sizeKey: sizes[0].key,
      sizeLabel: sizes[0].label,
      currency: priceBook.currency,
      amountInclTaxCents,
      formattedAmount: formattedAmount(priceBook.currency, amountInclTaxCents),
    }],
  };
}

export function resolveApprovedPricing(
  input: StatePricingInput | LegacyPricingInput,
): ApprovedPricingResolution {
  return "state" in input
    ? resolveApprovedPricingFromState(input)
    : resolveApprovedPricingLegacy(input);
}
