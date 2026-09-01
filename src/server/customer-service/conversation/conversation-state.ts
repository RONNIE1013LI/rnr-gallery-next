import type { ProductRegistryDocument } from "@/domain/catalogue/product-registry";
import type { Market } from "@/domain/markets/types";
import {
  detectIntent,
  isStaticCataloguePricingEnquiry,
  type CustomerServiceIntent,
} from "../intent-detection";
import type { ConversationContextItem } from "../repositories/customer-service-repository";
import type { SafeProductContext } from "../types";

export type ConversationStateSource =
  | "current_message"
  | "customer_history"
  | "server_page_context";

export type ConversationFollowUpField =
  | "MARKET"
  | "PRODUCT_TYPE"
  | "SIZE"
  | "PEOPLE_COUNT"
  | "PHOTO_COUNT"
  | "REQUIRED_DATE"
  | "DELIVERY_LOCATION";

export type ResolvedConversationValue<T> = Readonly<{
  value: T;
  source: ConversationStateSource;
}>;

export type ConversationState = Readonly<{
  intent: ResolvedConversationValue<CustomerServiceIntent>;
  market: ResolvedConversationValue<Market> | null;
  product: Readonly<{
    productKey: string;
    source: ConversationStateSource;
  }> | null;
  productCandidates: readonly string[];
  size: ResolvedConversationValue<string> | null;
  peoplePets: ResolvedConversationValue<number> | null;
  photoCount: ResolvedConversationValue<number> | null;
  requiredDate: ResolvedConversationValue<string> | null;
  deliveryLocation: ResolvedConversationValue<string> | null;
  asksCataloguePrice: boolean;
  missingFields: readonly ConversationFollowUpField[];
}>;

type CustomerText = Readonly<{
  text: string;
  source: Exclude<ConversationStateSource, "server_page_context">;
}>;

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-NZ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsPhrase(value: string, phrase: string) {
  return ` ${value} `.includes(` ${phrase} `);
}

function marketMention(value: string): Market | null {
  const australia = /\b(?:australia|australian|aud)\b/i.test(value);
  const newZealand = /\b(?:new zealand|nzd)\b/i.test(value)
    || /(?:^|\W)nz(?:$|\W)/i.test(value);
  if (australia === newZealand) return null;
  return australia ? "AU" : "NZ";
}

function activeProductMatches(value: string, registry: ProductRegistryDocument) {
  const text = normalized(value);
  const aliases: Readonly<Record<string, readonly string[]>> = {
    "digital-oil-painting-canvas": ["digital oil canvas"],
    "roll-up-banner": ["roll up"],
    "custom-themed-wall-banner": ["wall banner", "wall hanging banner"],
  };
  return registry.products.filter((product) => {
    if (!product.active) return false;
    const names = [product.key, product.slug, product.title, ...(aliases[product.key] ?? [])]
      .map(normalized)
      .filter(Boolean);
    return names.some((name) => containsPhrase(text, name));
  });
}

function categoryCandidates(value: string, registry: ProductRegistryDocument) {
  if (/\bcanvas(?:es)?\b/i.test(value)) {
    return registry.products.filter((product) => product.active && product.category === "canvas");
  }
  if (/\bbanners?\b/i.test(value)) {
    return registry.products.filter((product) => product.active && product.category === "banners");
  }
  return [];
}

function sizeMention(value: string) {
  const aSize = value.match(/\bA([0-4])\b/i);
  if (aSize) return `a${aSize[1]}`;
  const dimensions = value.match(/\b(\d+)\s*[x×]\s*(\d+)\s*(?:cm)?\b/i);
  return dimensions ? `${dimensions[1]}x${dimensions[2]}` : null;
}

function countMention(value: string, subject: "people" | "photos") {
  const pattern = subject === "people"
    ? /\b(\d{1,2})\s*(?:people|persons?|adults?|children|kids|pets?|faces?)\b/i
    : /\b(\d{1,2})\s*(?:photos?|images?|pictures?)\b/i;
  const match = value.match(pattern);
  return match ? Number(match[1]) : null;
}

function priorHistoryWithoutCurrent(
  currentText: string,
  history: readonly ConversationContextItem[],
) {
  let skippedCurrent = false;
  return [...history].reverse().flatMap((entry): ConversationContextItem[] => {
    if (!skippedCurrent && entry.role === "customer" && entry.text.trim() === currentText.trim()) {
      skippedCurrent = true;
      return [];
    }
    return [entry];
  }).reverse();
}

function openCanvasSubtypeCompletion(input: Readonly<{
  currentText: string;
  history: readonly ConversationContextItem[];
  registry: ProductRegistryDocument;
}>) {
  const currentExact = activeProductMatches(input.currentText, input.registry);
  if (currentExact.length !== 1 || currentExact[0]!.category !== "canvas") return null;

  const priorHistory = priorHistoryWithoutCurrent(input.currentText, input.history);
  let canvasTopicIndex = -1;
  let canvasOptions: ReturnType<typeof categoryCandidates> = [];
  for (let index = priorHistory.length - 1; index >= 0; index -= 1) {
    const entry = priorHistory[index]!;
    if (entry.role !== "customer") continue;
    const exact = activeProductMatches(entry.text, input.registry);
    const options = exact.length ? exact : categoryCandidates(entry.text, input.registry);
    if (!options.length) continue;
    canvasTopicIndex = index;
    canvasOptions = options;
    break;
  }
  if (
    canvasTopicIndex < 0
    || canvasOptions.length < 2
    || canvasOptions.some((product) => product.category !== "canvas")
    || !canvasOptions.some((product) => product.key === currentExact[0]!.key)
  ) return null;

  const topicHistory = priorHistory.slice(canvasTopicIndex);
  if (!topicHistory.some((entry) => entry.role === "staff")) return null;
  const customerTopicTexts = topicHistory
    .filter((entry) => entry.role === "customer")
    .map((entry) => entry.text);
  const selectedProduct = currentExact[0]!;
  const priorSize = [...customerTopicTexts].reverse()
    .map(sizeMention)
    .find((value): value is string => value !== null) ?? null;
  const sizeCompatible = priorSize !== null
    && selectedProduct.configuration.sizes.some((size) => size.key === priorSize);
  const priorPeople = [...customerTopicTexts].reverse()
    .map((text) => countMention(text, "people"))
    .find((value): value is number => value !== null) ?? null;
  const peopleCompatible = selectedProduct.configuration.peoplePetsMode !== "required"
    || priorPeople !== null;
  const hasCustomerMarket = customerTopicTexts.some((text) => marketMention(text) !== null);
  const hasPriceIntent = customerTopicTexts.some(isStaticCataloguePricingEnquiry);
  return sizeCompatible && peopleCompatible && hasCustomerMarket && hasPriceIntent
    ? selectedProduct.key
    : null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export function isQuoteDetailQuestion(value: string) {
  return /\b(?:country|area|location|located|address|size|date|day|when|how many (?:photos?|faces?|people)|wording|theme)\b/i.test(value)
    || /\bnew zealand\b.{0,30}\baustralia\b|\baustralia\b.{0,30}\bnew zealand\b/i.test(value)
    || /\bwhich\s+canvas\s+type\b|\b(?:which\s+)?product\s+format\b/i.test(value);
}

export function isQuoteDetailAnswer(value: string) {
  return Boolean(
    marketMention(value)
    || sizeMention(value)
    || countMention(value, "people") !== null
    || countMention(value, "photos") !== null
    || value.trim(),
  );
}

function customerTexts(currentText: string, history: readonly ConversationContextItem[]) {
  let skippedCurrent = false;
  const earlier = [...history].reverse().flatMap((entry): CustomerText[] => {
    if (entry.role !== "customer") return [];
    if (!skippedCurrent && entry.text.trim() === currentText.trim()) {
      skippedCurrent = true;
      return [];
    }
    return [{ text: entry.text, source: "customer_history" }];
  });
  return [
    { text: currentText, source: "current_message" as const },
    ...earlier,
  ];
}

function resolveIntent(
  texts: readonly CustomerText[],
  history: readonly ConversationContextItem[],
  completesOpenCanvasSubtype: boolean,
): ResolvedConversationValue<CustomerServiceIntent> {
  const currentIntent = detectIntent(texts[0]?.text ?? "");
  if (currentIntent !== "unknown") {
    return { value: currentIntent, source: "current_message" };
  }
  const lastStaff = [...history].reverse().find((entry) => entry.role === "staff");
  const priorIntent = texts.slice(1)
    .map((entry) => ({ value: detectIntent(entry.text), source: entry.source }))
    .find((entry) => entry.value !== "unknown" && entry.value !== "tone_adjustment");
  if (completesOpenCanvasSubtype) {
    return {
      value: priorIntent?.value === "quote_information_collection"
        ? priorIntent.value
        : "quote_information_collection",
      source: priorIntent?.source ?? "customer_history",
    };
  }
  if (lastStaff && isQuoteDetailQuestion(lastStaff.text) && isQuoteDetailAnswer(texts[0]?.text ?? "")) {
    return {
      value: priorIntent?.value === "quote_information_collection"
        ? priorIntent.value
        : "quote_information_collection",
      source: priorIntent?.source ?? "current_message",
    };
  }
  return priorIntent && /^(?:yes|yeah|this one|that one)$/i.test(texts[0]?.text.trim() ?? "")
    ? priorIntent
    : { value: "unknown", source: "current_message" };
}

export function resolveConversationState(input: Readonly<{
  currentText: string;
  history: readonly ConversationContextItem[];
  productContext: SafeProductContext | null;
  pageMarket?: Market | null;
  registry: ProductRegistryDocument;
}>): ConversationState {
  const texts = customerTexts(input.currentText, input.history);
  const openCanvasSubtypeProductKey = openCanvasSubtypeCompletion(input);
  const intent = resolveIntent(texts, input.history, openCanvasSubtypeProductKey !== null);
  const asksCataloguePrice = texts.some((entry) => (
    isStaticCataloguePricingEnquiry(entry.text)
    || (detectIntent(entry.text) === "quote_information_collection" && /\bquote\b/i.test(entry.text))
  ));
  const currentSize = sizeMention(input.currentText);

  let market: ResolvedConversationValue<Market> | null = null;
  for (const entry of texts) {
    const value = marketMention(entry.text);
    if (value) {
      market = { value, source: entry.source };
      break;
    }
  }
  if (!market && input.productContext) {
    market = { value: input.productContext.market, source: "server_page_context" };
  }
  if (!market && input.pageMarket) {
    market = { value: input.pageMarket, source: "server_page_context" };
  }

  let product: ConversationState["product"] = null;
  let productCandidates: readonly string[] = [];
  let productMentionSource: ConversationStateSource | null = null;
  for (const entry of texts) {
    const exact = activeProductMatches(entry.text, input.registry);
    const candidates = exact.length ? exact : categoryCandidates(entry.text, input.registry);
    if (!candidates.length) continue;
    productMentionSource = entry.source;
    if (candidates.length === 1) {
      product = { productKey: candidates[0]!.key, source: entry.source };
    } else {
      productCandidates = candidates.map((candidate) => candidate.key);
    }
    break;
  }
  if (!product && productCandidates.length === 0 && input.productContext) {
    const contextual = input.registry.products.find((candidate) => (
      candidate.active && candidate.key === input.productContext?.productKey
    ));
    if (contextual) {
      product = { productKey: contextual.key, source: "server_page_context" };
      productMentionSource = "server_page_context";
    }
  }
  if (!product && productCandidates.length === 0 && asksCataloguePrice && currentSize) {
    const sizeCompatibleProducts = input.registry.products.filter((candidate) => (
      candidate.active
      && candidate.configuration.sizes.some((size) => size.key === currentSize)
    ));
    const compatibleCategories = new Set(sizeCompatibleProducts.map((candidate) => candidate.category));
    if (compatibleCategories.size === 1) {
      productCandidates = sizeCompatibleProducts.map((candidate) => candidate.key);
    }
  }

  const currentExactProducts = activeProductMatches(input.currentText, input.registry);
  const currentCategoryProducts = categoryCandidates(input.currentText, input.registry);
  const currentHasProductMention = currentExactProducts.length > 0
    || currentCategoryProducts.length > 0;
  const completesOpenProductSlot = currentExactProducts.length === 1
    && currentExactProducts[0]!.key === openCanvasSubtypeProductKey;
  const startsNewProductTopic = currentHasProductMention && !completesOpenProductSlot;
  const selectedProduct = product
    ? input.registry.products.find((candidate) => candidate.key === product.productKey) ?? null
    : null;
  let size: ResolvedConversationValue<string> | null = null;
  if (currentSize) {
    size = { value: currentSize, source: "current_message" };
  } else if (!startsNewProductTopic) {
    for (const entry of texts.slice(1)) {
      const value = sizeMention(entry.text);
      const compatible = !selectedProduct
        || selectedProduct.configuration.sizes.some((candidate) => candidate.key === value);
      if (value && compatible) {
        size = { value, source: entry.source };
        break;
      }
    }
  }
  if (!size && selectedProduct?.configuration.sizes.length === 1) {
    size = {
      value: selectedProduct.configuration.sizes[0]!.key,
      source: productMentionSource ?? product?.source ?? "server_page_context",
    };
  }

  const resolveCount = (subject: "people" | "photos") => {
    for (const entry of texts) {
      if (startsNewProductTopic && entry.source === "customer_history") continue;
      const value = countMention(entry.text, subject);
      if (value !== null) return { value, source: entry.source } as const;
    }
    return null;
  };
  const resolvedPeople = resolveCount("people");
  const peoplePets = selectedProduct?.configuration.peoplePetsMode === "none"
    ? null
    : resolvedPeople;
  const photoCount = resolveCount("photos");

  const missingFields: ConversationFollowUpField[] = [];
  if (asksCataloguePrice) {
    if (!market) missingFields.push("MARKET");
    if (!product) missingFields.push("PRODUCT_TYPE");
    if (product && !size) missingFields.push("SIZE");
    if (selectedProduct?.configuration.peoplePetsMode === "required" && !peoplePets) {
      missingFields.push("PEOPLE_COUNT");
    }
  }

  return deepFreeze({
    intent,
    market,
    product,
    productCandidates: [...productCandidates],
    size,
    peoplePets,
    photoCount,
    requiredDate: null,
    deliveryLocation: null,
    asksCataloguePrice,
    missingFields,
  });
}
