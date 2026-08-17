export type ModelPricing = Readonly<{
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}>;

const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gpt-5.6-luna": {
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 1.2,
  },
};

// Intentionally empty until a vision-capable model and its pricing are approved together.
const REVIEWED_IMAGE_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({});

export function pricingForModel(model: string): ModelPricing {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error(`pricing_not_configured:${model}`);
  return pricing;
}

export function pricingForReviewedImageModel(model: string): ModelPricing {
  const pricing = REVIEWED_IMAGE_MODEL_PRICING[model];
  if (!pricing) throw new Error("image_analysis_model_not_approved");
  return pricing;
}

export function estimateCostMicrousd(input: Readonly<{
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  pricing?: ModelPricing;
}>) {
  const pricing = input.pricing ?? pricingForModel(input.model);
  const cached = Math.min(Math.max(0, input.inputTokens), Math.max(0, input.cachedInputTokens));
  const uncached = Math.max(0, input.inputTokens - cached);
  const usd = (
    uncached * pricing.inputUsdPerMillion
    + cached * pricing.cachedInputUsdPerMillion
    + Math.max(0, input.outputTokens) * pricing.outputUsdPerMillion
  ) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

export function localDateScopeKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `daily:${values.year}-${values.month}-${values.day}`;
}
