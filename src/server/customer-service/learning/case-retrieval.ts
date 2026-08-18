type Risk = "low" | "medium";
type Market = "NZ" | "AU" | "other" | "unknown";

function tokens(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

export function scoreCaseMemory(input: Readonly<{
  current: Readonly<{
    intent: string;
    riskClass: Risk;
    productCategory: string | null;
    market: Market;
    policyReferences: readonly string[];
    query: string;
    now: Date;
  }>;
  memory: Readonly<{
    intent: string;
    riskClass: Risk;
    productCategory: string | null;
    market: Market;
    policyReferences: readonly string[];
    normalizedSituation: string;
    createdAt: Date;
    fullTextRank?: number;
  }>;
}>) {
  const policyCompatible = input.memory.policyReferences.every((item) => input.current.policyReferences.includes(item));
  const productCompatible = !input.current.productCategory || !input.memory.productCategory
    || input.current.productCategory === input.memory.productCategory;
  const marketCompatible = input.current.market === "unknown" || input.memory.market === "unknown"
    || input.current.market === input.memory.market;
  const eligible = input.current.intent === input.memory.intent && policyCompatible && productCompatible && marketCompatible;
  if (!eligible) return Object.freeze({ eligible: false as const, totalScore: 0, components: Object.freeze({}) });
  const queryTokens = tokens(input.current.query);
  const memoryTokens = tokens(input.memory.normalizedSituation);
  const overlap = [...queryTokens].filter((token) => memoryTokens.has(token)).length;
  const lexicalRatio = queryTokens.size ? overlap / queryTokens.size : 0;
  const ftsRatio = Math.min(1, Math.max(0, (input.memory.fullTextRank ?? 0) * 5));
  const text = Math.min(20, Math.round(Math.max(lexicalRatio, ftsRatio) * 20));
  const ageDays = Math.max(0, (input.current.now.getTime() - input.memory.createdAt.getTime()) / 86_400_000);
  const components = Object.freeze({
    intent: 35,
    policy: 20,
    text,
    product: input.current.productCategory && input.memory.productCategory ? 10 : 5,
    market: input.current.market !== "unknown" && input.memory.market !== "unknown" ? 5 : 3,
    risk: input.current.riskClass === input.memory.riskClass ? 5 : 3,
    recency: Math.max(0, 5 - Math.floor(ageDays / 90)),
  });
  const totalScore = Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0));
  return Object.freeze({ eligible: true as const, totalScore, components });
}
