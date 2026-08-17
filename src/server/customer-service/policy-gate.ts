import { detectIntent, isGenericBannerQuoteEnquiry, type CustomerServiceIntent } from "./intent-detection";

export type PolicyRule = Readonly<{
  id: string;
  text: string;
  evidenceStatus: string;
  highRisk: boolean;
  realtimeRequired: boolean;
  mayAnswerAutomatically: boolean;
}>;

export type PolicyKnowledge = Readonly<{ rules: readonly PolicyRule[] }>;

export type PolicyGateResult = Readonly<{
  decision: "DRAFT_ALLOWED" | "NEEDS_HUMAN_REVIEW" | "REALTIME_DATA_REQUIRED";
  providerAllowed: boolean;
  intent: CustomerServiceIntent;
  riskLevel: "low" | "high";
  reason: string;
  ruleIds: readonly string[];
  selectedRules: readonly PolicyRule[];
}>;

const HIGH_RISK_PATTERNS = [
  /\brefund\b/i,
  /\bcancell?ation\b|\bcancel\b/i,
  /damaged goods|arrived damaged|item.*damaged|\bbroken\b|\bcracked\b|\btorn\b/i,
  /\bmisprint(?:ed)?\b|\breprint\b|printed wrong|wrong print|printing error/i,
  /\bcompensation\b|\bdiscount\b|store credit|partial refund/i,
  /\bchargeback\b|payment dispute|dispute.*payment|payment.*disput/i,
  /consumer rights/i,
  /guarantee.*deliver|deliver.*guarantee|guaranteed delivery/i,
  /guarantee.*urgent|urgent.*guarantee|guarantee.*complet|complet.*guarantee/i,
  /\b(?:arrive|deliver(?:ed)?) by\b/i,
  /\b(?:complete|finish|ready) (?:it )?(?:today|tomorrow|within (?:one|two|1|2) days?)\b/i,
];

const REALTIME_PATTERNS = [
  /\bhow much\b|\bcurrent price\b|\bprice (?:is|for)\b|\bcost (?:is|of|for)\b|\bquote for\b/i,
  /shipping (?:price|cost|fee|charge)|delivery (?:price|cost|fee|charge)/i,
  /\b(?:eta|tracking number|order status|my balance|customer balance)\b/i,
  /when will .*arrive|how long .*delivery|delivery.*how long/i,
  /pickup (?:address|hours|time)|where (?:can i|do i) (?:pick up|pickup|collect)/i,
  /\bpromotion\b/i,
  /how long.*(?:production|design|print)|when.*(?:ready|complete|finish)/i,
];

const INTENT_RULES: Record<CustomerServiceIntent, readonly string[]> = {
  tone_adjustment: ["AI-SCOPE-01"],
  product_differences: ["AI-SCOPE-02"],
  quote_information_collection: ["AI-SCOPE-03"],
  design_process: ["AI-SCOPE-04"],
  photo_guidance: ["AI-SCOPE-05"],
  production_process: ["AI-SCOPE-06"],
  payment_process: ["AI-SCOPE-07", "ORDER-01"],
  revision_policy: ["DESIGN-02"],
  unknown: [],
};

function realtimeReason(message: string, intent: CustomerServiceIntent) {
  if (intent === "quote_information_collection") {
    if (isGenericBannerQuoteEnquiry(message)) return "";
    return /\bhow much\b|\bcurrent price\b|\bprice (?:is|for)\b|\bcost (?:is|of|for)\b|\bquote for\b/i.test(message)
      ? "realtime_data_required"
      : "";
  }
  if (intent === "payment_process" && /how (?:does|do).*deposit|what.*deposit.*process/i.test(message) && !/\bmy\b|amount|balance|status/i.test(message)) {
    return "";
  }
  return REALTIME_PATTERNS.some((pattern) => pattern.test(message)) ? "realtime_data_required" : "";
}

export function evaluatePolicyGate({
  message,
  knowledge,
  intentOverride,
}: Readonly<{
  message: string;
  knowledge: PolicyKnowledge;
  intentOverride?: CustomerServiceIntent;
}>): PolicyGateResult {
  const value = String(message ?? "").trim();
  const intent = intentOverride ?? detectIntent(value);

  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(value))) {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      providerAllowed: false,
      intent,
      riskLevel: "high",
      reason: "high_risk_topic",
      ruleIds: [],
      selectedRules: [],
    };
  }

  if (realtimeReason(value, intent)) {
    return {
      decision: "REALTIME_DATA_REQUIRED",
      providerAllowed: false,
      intent,
      riskLevel: "high",
      reason: "realtime_data_required",
      ruleIds: [],
      selectedRules: [],
    };
  }

  let ruleIds = [...INTENT_RULES[intent]];
  if (intent === "payment_process") {
    if (/afterpay|\bzip\b/i.test(value)) ruleIds = ["AI-SCOPE-07", "ORDER-03"];
    if (/weekly|split|part(?:ly)? payment|pay partly/i.test(value)) ruleIds = ["AI-SCOPE-07", "ORDER-02"];
  }
  if (!ruleIds.length) {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      providerAllowed: false,
      intent,
      riskLevel: "high",
      reason: "unresolved_intent",
      ruleIds,
      selectedRules: [],
    };
  }

  const selectedRules = ruleIds
    .map((id) => knowledge.rules.find((rule) => rule.id === id))
    .filter((rule): rule is PolicyRule => Boolean(rule));
  const missingRule = selectedRules.length !== ruleIds.length;
  const nonConfirmed = selectedRules.some((rule) => rule.evidenceStatus !== "CONFIRMED");
  const disallowed = selectedRules.some((rule) => !rule.mayAnswerAutomatically);

  if (missingRule || nonConfirmed || disallowed) {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      providerAllowed: false,
      intent,
      riskLevel: "high",
      reason: missingRule
        ? "missing_policy_rule"
        : nonConfirmed
          ? "policy_not_confirmed"
          : "automation_not_permitted",
      ruleIds,
      selectedRules,
    };
  }

  return {
    decision: "DRAFT_ALLOWED",
    providerAllowed: true,
    intent,
    riskLevel: "low",
    reason: "confirmed_draft_scope",
    ruleIds,
    selectedRules,
  };
}
