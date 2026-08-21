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
const MAX_DECISION_ARRAY_ITEMS = 6;
const FOLLOW_UP_FIELDS = [
  "PRODUCT_TYPE",
  "SIZE",
  "PEOPLE_COUNT",
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
    maxItems: MAX_DECISION_ARRAY_ITEMS,
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
    && value.length <= MAX_DECISION_ARRAY_ITEMS
    && value.every((item) => isEnumValue(values, item))
    && new Set(value).size === value.length;
}

class DuplicateKeyJsonScanner {
  private index = 0;
  private duplicateFound = false;

  constructor(private readonly source: string) {}

  scan() {
    this.skipWhitespace();
    this.scanValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error("invalid_json");
    return this.duplicateFound;
  }

  private scanValue() {
    const char = this.source[this.index];
    if (char === "{") return this.scanObject();
    if (char === "[") return this.scanArray();
    if (char === '"') {
      this.scanString();
      return;
    }
    if (char === "t") return this.scanLiteral("true");
    if (char === "f") return this.scanLiteral("false");
    if (char === "n") return this.scanLiteral("null");
    this.scanNumber();
  }

  private scanObject() {
    this.index += 1;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.consume("}")) return;
    while (true) {
      if (this.source[this.index] !== '"') throw new Error("invalid_json");
      const key = this.scanString();
      if (keys.has(key)) this.duplicateFound = true;
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(":")) throw new Error("invalid_json");
      this.skipWhitespace();
      this.scanValue();
      this.skipWhitespace();
      if (this.consume("}")) return;
      if (!this.consume(",")) throw new Error("invalid_json");
      this.skipWhitespace();
    }
  }

  private scanArray() {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume("]")) return;
    while (true) {
      this.scanValue();
      this.skipWhitespace();
      if (this.consume("]")) return;
      if (!this.consume(",")) throw new Error("invalid_json");
      this.skipWhitespace();
    }
  }

  private scanString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === '"') {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (char === "\\") {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === "u") {
          for (let offset = 1; offset <= 4; offset += 1) {
            const digit = this.source.charCodeAt(this.index + offset);
            const hexadecimal = (digit >= 48 && digit <= 57)
              || (digit >= 65 && digit <= 70)
              || (digit >= 97 && digit <= 102);
            if (!hexadecimal) throw new Error("invalid_json");
          }
          this.index += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) throw new Error("invalid_json");
        this.index += 1;
        continue;
      }
      if ((char?.charCodeAt(0) ?? 0) < 0x20) throw new Error("invalid_json");
      this.index += 1;
    }
    throw new Error("invalid_json");
  }

  private scanNumber() {
    const start = this.index;
    this.consume("-");
    if (this.consume("0")) {
      if (this.isDigit(this.source[this.index])) throw new Error("invalid_json");
    } else {
      if (!this.isDigit(this.source[this.index]) || this.source[this.index] === "0") throw new Error("invalid_json");
      while (this.isDigit(this.source[this.index])) this.index += 1;
    }
    if (this.consume(".")) {
      if (!this.isDigit(this.source[this.index])) throw new Error("invalid_json");
      while (this.isDigit(this.source[this.index])) this.index += 1;
    }
    if (this.source[this.index] === "e" || this.source[this.index] === "E") {
      this.index += 1;
      if (this.source[this.index] === "+" || this.source[this.index] === "-") this.index += 1;
      if (!this.isDigit(this.source[this.index])) throw new Error("invalid_json");
      while (this.isDigit(this.source[this.index])) this.index += 1;
    }
    if (this.index === start) throw new Error("invalid_json");
  }

  private scanLiteral(literal: string) {
    if (!this.source.startsWith(literal, this.index)) throw new Error("invalid_json");
    this.index += literal.length;
  }

  private skipWhitespace() {
    while ([" ", "\t", "\n", "\r"].includes(this.source[this.index] ?? "")) this.index += 1;
  }

  private consume(expected: string) {
    if (this.source[this.index] !== expected) return false;
    this.index += 1;
    return true;
  }

  private isDigit(value: string | undefined) {
    return value !== undefined && value >= "0" && value <= "9";
  }
}

function parseWebsiteDecisionValue(value: unknown):
  | Readonly<{ ok: true; decision: WebsiteDecision }>
  | Readonly<{ ok: false; code: "website_decision_schema_invalid" }> {
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
  return {
    ok: true,
    decision: Object.freeze({
      response_type: value.response_type,
      intent: value.intent,
      product_type: value.product_type,
      missing_fields: Object.freeze([...value.missing_fields]),
      follow_up_fields: Object.freeze([...value.follow_up_fields]),
      allowed_facts: Object.freeze([...value.allowed_facts]),
      human_review_reason: value.human_review_reason,
    }),
  };
}

export function parseWebsiteDecision(raw: string):
  | Readonly<{ ok: true; decision: WebsiteDecision }>
  | Readonly<{ ok: false; code: "website_decision_schema_invalid" }> {
  try {
    if (new DuplicateKeyJsonScanner(raw).scan()) {
      return { ok: false, code: "website_decision_schema_invalid" };
    }
    return parseWebsiteDecisionValue(JSON.parse(raw));
  } catch {
    return { ok: false, code: "website_decision_schema_invalid" };
  }
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
  PEOPLE_COUNT: {
    intents: ["quote_information_collection"],
    text: "About how many people would you like included?",
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

function renderQuestions(fields: readonly FollowUpField[]) {
  const peopleIndex = fields.indexOf("PEOPLE_COUNT");
  const photoIndex = fields.indexOf("PHOTO_COUNT");
  if (peopleIndex >= 0 && photoIndex === peopleIndex + 1) {
    return fields.flatMap((field, index) => {
      if (index === peopleIndex) return ["About how many people and photos would you like to include?"];
      if (index === photoIndex) return [];
      return [QUESTIONS[field].text];
    }).join("\n");
  }
  return fields.map((field) => QUESTIONS[field].text).join("\n");
}

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

export function getWebsiteDecisionPromptContract(intent: CustomerServiceIntent) {
  return Object.freeze({
    allowedFacts: Object.freeze(
      (Object.entries(FACTS) as [AllowedFact, (typeof FACTS)[AllowedFact]][])
        .filter(([, fact]) => fact.intent === intent)
        .map(([name]) => name),
    ),
    followUpFields: Object.freeze(
      (Object.entries(QUESTIONS) as [FollowUpField, (typeof QUESTIONS)[FollowUpField]][])
        .filter(([, question]) => question.intents.includes(intent))
        .map(([name]) => name),
    ),
  });
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
      text: renderQuestions(decision.follow_up_fields),
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

export function verifyWebsiteRendererProof(input: Readonly<{
  intent: string;
  text: string;
  decision: unknown;
  templateVersion: unknown;
  productCategory: "canvas" | "banners" | null;
}>) {
  if (
    !isEnumValue(INTENTS, input.intent)
    || input.templateVersion !== WEBSITE_RESPONSE_TEMPLATE_VERSION
  ) return false;
  const parsed = parseWebsiteDecisionValue(input.decision);
  if (!parsed.ok) return false;
  const rendered = renderWebsiteDecision({
    decision: parsed.decision,
    expectedIntent: input.intent,
    productCategory: input.productCategory,
    acknowledgementAllowed: false,
    policyDecision: "DRAFT_ALLOWED",
  });
  return rendered.ok
    && rendered.outcome === "rendered"
    && rendered.templateVersion === input.templateVersion
    && rendered.text === input.text;
}
