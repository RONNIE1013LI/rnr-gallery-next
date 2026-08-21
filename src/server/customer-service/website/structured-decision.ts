import type { CustomerServiceIntent } from "../intent-detection";

export const WEBSITE_RESPONSE_TEMPLATE_VERSION = "website-response-v1";
export const WEBSITE_DECISION_SCHEMA_NAME = "website_customer_service_decision_v1";

const RESPONSE_TYPES = [
  "ANSWER_SAFE",
  "ASK_FOR_INFORMATION",
  "NO_REPLY_NEEDED",
  "HUMAN_REVIEW_REQUIRED",
  "REALTIME_REQUIRED",
  "SYSTEM_FALLBACK",
] as const;
const INTENTS = [
  "tone_adjustment",
  "product_differences",
  "quote_information_collection",
  "design_process",
  "photo_guidance",
  "production_process",
  "payment_process",
  "revision_policy",
  "unknown",
] as const satisfies readonly CustomerServiceIntent[];
const PRODUCT_TYPES = ["CANVAS", "BANNER", "UNSPECIFIED"] as const;
const FOLLOW_UP_FIELDS = [
  "PRODUCT_TYPE",
  "SIZE",
  "PHOTO_COUNT",
  "ORIGINAL_PHOTOS",
  "WORDING",
  "THEME",
  "COLOUR_PREFERENCES",
  "REQUIRED_DATE",
  "DELIVERY_LOCATION",
] as const;
const ALLOWED_FACTS = [
  "CANVAS_WALL_KEEPSAKE",
  "BANNER_DISPLAY_OPTIONS",
  "DESIGN_INPUTS",
  "DESIGN_DRAFT_REVIEW_BEFORE_PRINTING",
  "PHOTO_ORIGINAL_FILES",
  "PHOTO_QUALITY_ASSESSMENT",
  "PHOTO_COMBINE_SUBJECTS",
  "PRODUCTION_AFTER_APPROVAL",
  "DELIVERY_AFTER_CONFIRMATION",
  "PAYMENT_DEPOSIT_STARTS_DESIGN",
] as const;
const HUMAN_REVIEW_REASONS = [
  "NONE",
  "HIGH_RISK",
  "UNRESOLVED",
  "REALTIME_DATA_REQUIRED",
  "MODEL_UNCERTAIN",
] as const;

type ResponseType = typeof RESPONSE_TYPES[number];
type ProductType = typeof PRODUCT_TYPES[number];
type FollowUpField = typeof FOLLOW_UP_FIELDS[number];
type AllowedFact = typeof ALLOWED_FACTS[number];
type HumanReviewReason = typeof HUMAN_REVIEW_REASONS[number];

export type WebsiteDecision = Readonly<{
  response_type: ResponseType;
  intent: CustomerServiceIntent;
  product_type: ProductType;
  missing_fields: readonly FollowUpField[];
  follow_up_fields: readonly FollowUpField[];
  allowed_facts: readonly AllowedFact[];
  human_review_reason: HumanReviewReason;
}>;

const REQUIRED_KEYS = [
  "response_type",
  "intent",
  "product_type",
  "missing_fields",
  "follow_up_fields",
  "allowed_facts",
  "human_review_reason",
] as const;

function enumSchema(values: readonly string[]) {
  return Object.freeze({ type: "string", enum: values });
}

function enumArraySchema(values: readonly string[]) {
  return Object.freeze({
    type: "array",
    items: enumSchema(values),
    uniqueItems: true,
    maxItems: 4,
  });
}

export const WEBSITE_DECISION_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    response_type: enumSchema(RESPONSE_TYPES),
    intent: enumSchema(INTENTS),
    product_type: enumSchema(PRODUCT_TYPES),
    missing_fields: enumArraySchema(FOLLOW_UP_FIELDS),
    follow_up_fields: enumArraySchema(FOLLOW_UP_FIELDS),
    allowed_facts: enumArraySchema(ALLOWED_FACTS),
    human_review_reason: enumSchema(HUMAN_REVIEW_REASONS),
  }),
  required: REQUIRED_KEYS,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isEnumArray<T extends string>(values: readonly T[], value: unknown): value is readonly T[] {
  return Array.isArray(value)
    && value.length <= 4
    && value.every((item) => isEnumValue(values, item))
    && new Set(value).size === value.length;
}

export function parseWebsiteDecision(raw: string):
  | Readonly<{ ok: true; decision: WebsiteDecision }>
  | Readonly<{ ok: false; code: "website_decision_schema_invalid" }> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "website_decision_schema_invalid" };
  }
  if (!isRecord(value)) return { ok: false, code: "website_decision_schema_invalid" };
  const keys = Object.keys(value).sort();
  if (keys.length !== REQUIRED_KEYS.length || keys.some((key, index) => key !== [...REQUIRED_KEYS].sort()[index])) {
    return { ok: false, code: "website_decision_schema_invalid" };
  }
  if (
    !isEnumValue(RESPONSE_TYPES, value.response_type)
    || !isEnumValue(INTENTS, value.intent)
    || !isEnumValue(PRODUCT_TYPES, value.product_type)
    || !isEnumArray(FOLLOW_UP_FIELDS, value.missing_fields)
    || !isEnumArray(FOLLOW_UP_FIELDS, value.follow_up_fields)
    || !isEnumArray(ALLOWED_FACTS, value.allowed_facts)
    || !isEnumValue(HUMAN_REVIEW_REASONS, value.human_review_reason)
  ) return { ok: false, code: "website_decision_schema_invalid" };
  return { ok: true, decision: value as WebsiteDecision };
}

const FACTS: Readonly<Record<AllowedFact, Readonly<{ intent: CustomerServiceIntent; text: string }>>> = Object.freeze({
  CANVAS_WALL_KEEPSAKE: {
    intent: "product_differences",
    text: "Canvas suits a wall display and keepsake-style presentation.",
  },
  BANNER_DISPLAY_OPTIONS: {
    intent: "product_differences",
    text: "Banners can suit event displays; tell us whether you need a wall or freestanding format.",
  },
  DESIGN_INPUTS: {
    intent: "design_process",
    text: "We’ll collect your photos, wording, theme and colour preferences.",
  },
  DESIGN_DRAFT_REVIEW_BEFORE_PRINTING: {
    intent: "design_process",
    text: "We’ll then prepare a design draft for you to review before printing.",
  },
  PHOTO_ORIGINAL_FILES: {
    intent: "photo_guidance",
    text: "Please send the original photo files where possible.",
  },
  PHOTO_QUALITY_ASSESSMENT: {
    intent: "photo_guidance",
    text: "We can assess them and let you know what may work; results depend on the quality of the original files.",
  },
  PHOTO_COMBINE_SUBJECTS: {
    intent: "photo_guidance",
    text: "We can combine people or pets from separate original photos, subject to assessing the files.",
  },
  PRODUCTION_AFTER_APPROVAL: {
    intent: "production_process",
    text: "Once your design is approved, we’ll proceed to printing and production.",
  },
  DELIVERY_AFTER_CONFIRMATION: {
    intent: "production_process",
    text: "Once the order is confirmed, we can arrange delivery.",
  },
  PAYMENT_DEPOSIT_STARTS_DESIGN: {
    intent: "payment_process",
    text: "Once the 50% deposit is received, we can begin the design work.",
  },
});

const QUESTIONS: Readonly<Record<FollowUpField, Readonly<{
  intents: readonly CustomerServiceIntent[];
  text: string;
}>>> = Object.freeze({
  PRODUCT_TYPE: {
    intents: ["product_differences", "quote_information_collection", "design_process"],
    text: "Which product format are you considering?",
  },
  SIZE: {
    intents: ["quote_information_collection", "design_process"],
    text: "What size do you need?",
  },
  PHOTO_COUNT: {
    intents: ["quote_information_collection", "photo_guidance"],
    text: "About how many photos would you like to include?",
  },
  ORIGINAL_PHOTOS: {
    intents: ["quote_information_collection", "design_process", "photo_guidance"],
    text: "Can you send the original photo files?",
  },
  WORDING: {
    intents: ["tone_adjustment", "quote_information_collection", "design_process"],
    text: "What wording would you like on the design?",
  },
  THEME: {
    intents: ["quote_information_collection", "design_process"],
    text: "What theme or background style do you have in mind?",
  },
  COLOUR_PREFERENCES: {
    intents: ["quote_information_collection", "design_process"],
    text: "Do you have preferred colours for the design?",
  },
  REQUIRED_DATE: {
    intents: ["quote_information_collection"],
    text: "What date do you need it for?",
  },
  DELIVERY_LOCATION: {
    intents: ["quote_information_collection"],
    text: "Which suburb or postcode would delivery be to?",
  },
});

function productCompatible(productType: ProductType, productCategory: "canvas" | "banners" | null) {
  if (productType === "UNSPECIFIED" || productCategory === null) return true;
  return (productType === "CANVAS" && productCategory === "canvas")
    || (productType === "BANNER" && productCategory === "banners");
}

function allEmpty(decision: WebsiteDecision) {
  return decision.missing_fields.length === 0
    && decision.follow_up_fields.length === 0
    && decision.allowed_facts.length === 0;
}

export function renderWebsiteDecision(input: Readonly<{
  decision: WebsiteDecision;
  expectedIntent: CustomerServiceIntent;
  productCategory: "canvas" | "banners" | null;
  acknowledgementAllowed: boolean;
  policyDecision?: "DRAFT_ALLOWED" | "NEEDS_HUMAN_REVIEW" | "REALTIME_DATA_REQUIRED";
}>):
  | Readonly<{ ok: true; outcome: "rendered"; text: string; templateVersion: typeof WEBSITE_RESPONSE_TEMPLATE_VERSION }>
  | Readonly<{ ok: true; outcome: "no_reply" }>
  | Readonly<{ ok: true; outcome: "human_review" | "realtime_required" | "system_fallback" }>
  | Readonly<{ ok: false; code: "website_decision_policy_blocked" | "website_decision_incompatible" }> {
  const { decision } = input;
  if ((input.policyDecision ?? "DRAFT_ALLOWED") !== "DRAFT_ALLOWED") {
    return { ok: false, code: "website_decision_policy_blocked" };
  }
  if (decision.intent !== input.expectedIntent || !productCompatible(decision.product_type, input.productCategory)) {
    return { ok: false, code: "website_decision_incompatible" };
  }
  if (decision.allowed_facts.some((fact) => FACTS[fact].intent !== decision.intent)) {
    return { ok: false, code: "website_decision_incompatible" };
  }
  if ([...decision.missing_fields, ...decision.follow_up_fields]
    .some((field) => !QUESTIONS[field].intents.includes(decision.intent))) {
    return { ok: false, code: "website_decision_incompatible" };
  }

  if (decision.response_type === "ANSWER_SAFE") {
    if (
      decision.allowed_facts.length === 0
      || decision.missing_fields.length > 0
      || decision.follow_up_fields.length > 0
      || decision.human_review_reason !== "NONE"
    ) return { ok: false, code: "website_decision_incompatible" };
    return {
      ok: true,
      outcome: "rendered",
      text: decision.allowed_facts.map((fact) => FACTS[fact].text).join("\n"),
      templateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
    };
  }
  if (decision.response_type === "ASK_FOR_INFORMATION") {
    const sameFields = decision.missing_fields.length === decision.follow_up_fields.length
      && decision.missing_fields.every((field, index) => decision.follow_up_fields[index] === field);
    if (
      !sameFields
      || decision.follow_up_fields.length === 0
      || decision.allowed_facts.length > 0
      || decision.human_review_reason !== "NONE"
    ) return { ok: false, code: "website_decision_incompatible" };
    return {
      ok: true,
      outcome: "rendered",
      text: decision.follow_up_fields.map((field) => QUESTIONS[field].text).join("\n"),
      templateVersion: WEBSITE_RESPONSE_TEMPLATE_VERSION,
    };
  }
  if (decision.response_type === "NO_REPLY_NEEDED") {
    return allEmpty(decision) && decision.human_review_reason === "NONE" && input.acknowledgementAllowed
      ? { ok: true, outcome: "no_reply" }
      : { ok: false, code: "website_decision_incompatible" };
  }
  if (!allEmpty(decision)) return { ok: false, code: "website_decision_incompatible" };
  if (decision.response_type === "HUMAN_REVIEW_REQUIRED") {
    return decision.human_review_reason !== "NONE"
      ? { ok: true, outcome: "human_review" }
      : { ok: false, code: "website_decision_incompatible" };
  }
  if (decision.response_type === "REALTIME_REQUIRED") {
    return decision.human_review_reason === "REALTIME_DATA_REQUIRED"
      ? { ok: true, outcome: "realtime_required" }
      : { ok: false, code: "website_decision_incompatible" };
  }
  return decision.human_review_reason === "MODEL_UNCERTAIN"
    ? { ok: true, outcome: "system_fallback" }
    : { ok: false, code: "website_decision_incompatible" };
}

export function verifyWebsiteRenderedResponse(input: Readonly<{
  intent: string;
  text: string;
}>) {
  const intent = input.intent;
  if (!isEnumValue(INTENTS, intent) || input.text !== input.text.trim()) return false;
  const lines = input.text.split("\n");
  if (lines.length === 0 || lines.length > 4 || new Set(lines).size !== lines.length) return false;
  const allowed = new Set([
    ...Object.values(FACTS).filter((fact) => fact.intent === intent).map((fact) => fact.text),
    ...Object.values(QUESTIONS).filter((question) => question.intents.includes(intent)).map((question) => question.text),
  ]);
  return lines.every((line) => allowed.has(line));
}
