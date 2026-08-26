export function assessCaseMemoryEligibility(input: Readonly<{
  riskClass: "low" | "medium" | "high";
  gateReasons: readonly string[];
  customerSituation: string;
  humanReply: string;
  redactionCodes: readonly string[];
}>) {
  const value = `${input.customerSituation}\n${input.humanReply}`;
  const codes: string[] = [];
  if (input.riskClass === "high" || input.gateReasons.some((reason) => /high_risk|unresolved/i.test(reason))) codes.push("high_risk");
  if (/\bdiscount\b|special price|price override/i.test(value)) codes.push("special_discount");
  if (/\bcompensation\b|store credit/i.test(value)) codes.push("compensation");
  if (/\brefund\b|\bcancell?ation\b/i.test(value)) codes.push("refund_or_cancellation");
  if (/damaged|misprint|reprint|consumer rights/i.test(value)) codes.push("damaged_or_misprint");
  if (/chargeback|payment dispute/i.test(value)) codes.push("payment_dispute");
  if (
    /(?:NZ|AU)?\$\s?\d+(?:\.\d{1,2})?\b/i.test(value)
    || /\b(?:price|cost|charge|shipping|delivery)(?:\s+(?:price|cost|quote))?\s+(?:was|is|costs?|quoted at)?\s*\d+(?:\.\d{1,2})?\b/i.test(value)
    || /\b(?:A[0-4]|canvas|banner|roll[- ]?up|wall banner)\b.{0,40}\b(?:is|was|costs?)\s+\d+(?:\.\d{1,2})?\b/i.test(value)
  ) codes.push("realtime_value");
  if (
    /arrive (?:today|tomorrow|by)|guaranteed delivery|delivery guarantee|ETA\b/i.test(value)
    || /\b(?:finish|complete|produce|print|ready)\b.{0,24}\bby\s+(?:today|tomorrow|[A-Z][a-z]+|\d{1,2}(?:st|nd|rd|th)?)\b/i.test(value)
    || /\bdelivery\s+(?:takes?|is)\s+\d+(?:\s*[-–]\s*\d+)?\s+(?:working\s+)?days?\b/i.test(value)
    || /\bfit\s+(?:your|the)\s+order\s+in\s+before\s+\S+/i.test(value)
  ) codes.push("delivery_or_eta");
  if (/one[- ]off shipping|special delivery arrangement|temporary promotion|\bpromo(?:tion)?\s+code\b|\bcoupon\s+code\b|\buse\s+code\s+[A-Z0-9_-]+\b/i.test(value)) codes.push("one_off_or_promotion");
  if (
    /\b\d{1,3}%\s*off\b|\b(?:promotion|promo|sale)\b|\bcurrent(?:ly)?\s+(?:price|capacity|availability)\b/i.test(value)
    || /\b(?:have room|fully booked|capacity|availability)\b.{0,24}\b(?:today|tomorrow|this week|next week)\b/i.test(value)
    || /\byour\s+(?:order|tracking|parcel|shipment)\s+(?:is|shows?|status)\b/i.test(value)
    || /\b(?:the|your)\s+(?:parcel|shipment|order)\s+(?:has been|was|is)\s+(?:dispatched|shipped|delivered|collected|returned|delayed)\b/i.test(value)
    || /\b(?:the|your)\s+(?:parcel|shipment|order)\s+has\s+left\s+(?:our|the)\s+(?:studio|workshop|warehouse)\b/i.test(value)
    || /\byour\s+(?:remaining\s+)?balance\s+(?:is|due)\b/i.test(value)
    || /\b(?:current\s+)?price\s+is\s+\d+(?:\.\d{1,2})?\b/i.test(value)
  ) codes.push("realtime_value");
  if (input.gateReasons.some((reason) => /realtime/i.test(reason))) codes.push("realtime_source");
  if (input.redactionCodes.length) codes.push("sensitive_source");
  const exclusionCodes = [...new Set(codes)];
  return Object.freeze(exclusionCodes.length
    ? { eligible: false as const, status: "excluded" as const, exclusionCodes: Object.freeze(exclusionCodes) }
    : { eligible: true as const, status: "pending_review" as const, exclusionCodes: Object.freeze([] as string[]) });
}

type AutoReusableCaseMemory = Readonly<{
  id: string;
  conversationKey: string;
  intent: string;
  riskClass: "low" | "medium";
  sourceConfidence: "medium" | "high";
  editClassification: string;
  policyReferences: readonly string[];
  productCategory: string | null;
  market: "NZ" | "AU" | "other" | "unknown";
  normalizedSituation: string;
  humanFinalReply: string;
  exclusionCodes: readonly string[];
}>;

const AUTO_REUSABLE_INTENTS = new Set([
  "tone_adjustment",
  "product_differences",
  "quote_information_collection",
  "design_process",
]);

const AUTO_REUSABLE_EDIT_CLASSIFICATIONS = new Set([
  "accepted_unchanged",
  "edited_light",
  "edited_significant",
  "ai_ignored",
  "independent_reply",
]);

const SIMILARITY_STOP_WORDS = new Set([
  "a", "about", "and", "are", "for", "how", "i", "is", "it", "of", "or", "the", "to", "we", "what", "with", "you", "your",
]);

function reusableTokens(value: string) {
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length > 1 && !SIMILARITY_STOP_WORDS.has(token)));
}

function diceSimilarity(left: string, right: string) {
  const leftTokens = reusableTokens(left);
  const rightTokens = reusableTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function isSafeAutoReusableCase(memory: AutoReusableCaseMemory) {
  return memory.riskClass === "low"
    && memory.sourceConfidence === "high"
    && AUTO_REUSABLE_INTENTS.has(memory.intent)
    && AUTO_REUSABLE_EDIT_CLASSIFICATIONS.has(memory.editClassification)
    && memory.policyReferences.length > 0
    && memory.exclusionCodes.length === 0;
}

function reuseScope(memory: AutoReusableCaseMemory) {
  return JSON.stringify([
    memory.intent,
    memory.productCategory,
    memory.market,
    [...memory.policyReferences].sort(),
  ]);
}

export function selectAutoReusableCaseMemoryIds(
  memories: readonly AutoReusableCaseMemory[],
  minimumDistinctConversations = 3,
) {
  if (!Number.isSafeInteger(minimumDistinctConversations) || minimumDistinctConversations < 3) {
    throw new Error("auto_reusable_case_threshold_invalid");
  }
  const selected = new Set<string>();
  const groups = new Map<string, AutoReusableCaseMemory[]>();
  for (const memory of memories.filter(isSafeAutoReusableCase)) {
    const key = reuseScope(memory);
    groups.set(key, [...(groups.get(key) ?? []), memory]);
  }
  for (const group of groups.values()) {
    const remaining = [...group];
    while (remaining.length) {
      const anchor = remaining.shift()!;
      const cluster = [anchor];
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (
          diceSimilarity(anchor.normalizedSituation, candidate.normalizedSituation) >= 0.65
          && diceSimilarity(anchor.humanFinalReply, candidate.humanFinalReply) >= 0.65
        ) {
          cluster.push(candidate);
          remaining.splice(index, 1);
        }
      }
      if (new Set(cluster.map((memory) => memory.conversationKey)).size >= minimumDistinctConversations) {
        cluster.forEach((memory) => selected.add(memory.id));
      }
    }
  }
  return Object.freeze(memories.map((memory) => memory.id).filter((id) => selected.has(id)));
}
