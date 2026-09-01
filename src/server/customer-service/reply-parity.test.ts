import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { resolveConversationState } from "./conversation/conversation-state";
import { CustomerServiceEngine } from "./engine";
import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import type { AiProviderRequest } from "./providers/ai-provider";
import type {
  ConversationContextItem,
  CustomerServiceRepository,
  ProviderAttemptCompletion,
} from "./repositories/customer-service-repository";
import type { CustomerServiceChannel, DraftGenerationResult } from "./types";

const at = "2026-09-01T07:00:00.000Z";
const customer = (text: string): ConversationContextItem => ({ role: "customer", text, receivedAt: at });
const staff = (text: string): ConversationContextItem => ({ role: "staff", text, receivedAt: at });

const REQUIRED_REAL_ENGINE_PARITY_CASE_IDS = [
  "roll-up-follow-up-nz",
  "roll-up-direct-nz",
  "a2-canvas-follow-up",
  "wall-banner-au",
  "brisbane-shipping",
  "turnaround",
  "product-guidance",
  "design-guidance",
  "production-guidance",
] as const;

function websiteDecision(overrides: Readonly<Record<string, unknown>> = {}) {
  return JSON.stringify({
    response_type: "ASK_FOR_INFORMATION",
    intent: "quote_information_collection",
    product_type: "UNSPECIFIED",
    missing_fields: ["MARKET"],
    follow_up_fields: ["MARKET"],
    allowed_facts: [],
    human_review_reason: "NONE",
    ...overrides,
  });
}

type ExpectedConversation = Readonly<{
  intent: string;
  market?: "NZ" | "AU" | null;
  productKey?: string | null;
  productCandidates?: readonly string[];
  size?: string | null;
  peoplePets?: number | null;
  photoCount?: number | null;
  missingFields?: readonly string[];
  asksCataloguePrice?: boolean;
}>;

function expectedAllowedBusinessContext(input: Readonly<{
  conversation: ExpectedConversation;
  ruleIds: readonly string[];
  qualityGuideId: string;
  qualityRequirementIds: readonly string[];
  canonicalQuote: Readonly<Record<string, unknown>>;
  allowedFactIds: readonly string[];
  allowedFollowUpFields: readonly string[];
}>) {
  return {
    version: 1,
    conversation: {
      intent: input.conversation.intent,
      market: input.conversation.market ?? null,
      productKey: input.conversation.productKey ?? null,
      productCandidates: input.conversation.productCandidates ?? [],
      size: input.conversation.size ?? null,
      peoplePets: input.conversation.peoplePets ?? null,
      photoCount: input.conversation.photoCount ?? null,
      missingFields: input.conversation.missingFields ?? [],
      asksCataloguePrice: input.conversation.asksCataloguePrice ?? false,
    },
    knowledge: {
      version: compiledKnowledge.knowledgeVersion,
      ruleIds: input.ruleIds,
      qualityGuideId: input.qualityGuideId,
      qualityRequirementIds: input.qualityRequirementIds,
    },
    canonicalQuote: input.canonicalQuote,
    decision: {
      allowedFactIds: input.allowedFactIds,
      allowedFollowUpFields: input.allowedFollowUpFields,
      policy: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
      handoff: { required: false, reason: null },
    },
  };
}

type LockedParityRow = Readonly<{
  id: typeof REQUIRED_REAL_ENGINE_PARITY_CASE_IDS[number];
  currentText: string;
  context: readonly ConversationContextItem[];
  facebookOutput: string;
  websiteOutput: string;
  expectedContext: ReturnType<typeof expectedAllowedBusinessContext>;
}> | Readonly<{
  id: typeof REQUIRED_REAL_ENGINE_PARITY_CASE_IDS[number];
  currentText: string;
  context: readonly ConversationContextItem[];
  blocked: true;
  expectedConversation: ExpectedConversation;
}>;

const quoteRuleIds = ["AI-SCOPE-03", "VOICE-01"] as const;
const quoteQualityRequirementIds = [
  "product_and_size",
  "photos_and_people",
  "design_preferences",
  "date_and_location",
  "quote_next_step",
] as const;
const canvasProductCandidates = [
  "photo-print-canvas",
  "digital-oil-painting-canvas",
  "custom-themed-canvas",
] as const;

const lockedRealEngineParityMatrix: readonly LockedParityRow[] = [
  {
    id: "roll-up-follow-up-nz",
    currentText: "New Zealand",
    context: [
      customer("How much for roll up banner?"),
      staff("Is this for New Zealand or Australia?"),
      customer("New Zealand"),
    ],
    facebookOutput: "I can confirm the current catalogue price for that Roll-Up Banner configuration.",
    websiteOutput: websiteDecision({
      response_type: "ANSWER_SAFE",
      allowed_facts: ["APPROVED_CATALOGUE_PRICE"],
      missing_fields: [],
      follow_up_fields: [],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: {
        intent: "quote_information_collection",
        market: "NZ",
        productKey: "roll-up-banner",
        size: "standard",
        asksCataloguePrice: true,
      },
      ruleIds: quoteRuleIds,
      qualityGuideId: "quote_information_collection",
      qualityRequirementIds: quoteQualityRequirementIds,
      canonicalQuote: {
        status: "verified",
        sourceRevision: 12,
        facts: [{ productKey: "roll-up-banner", sizeKey: "standard", currency: "NZD" }],
      },
      allowedFactIds: ["APPROVED_CATALOGUE_PRICE"],
      allowedFollowUpFields: [],
    }),
  },
  {
    id: "roll-up-direct-nz",
    currentText: "How much is a roll up banner in NZ?",
    context: [customer("How much is a roll up banner in NZ?")],
    facebookOutput: "I can confirm the current catalogue price for that Roll-Up Banner configuration.",
    websiteOutput: websiteDecision({
      response_type: "ANSWER_SAFE",
      allowed_facts: ["APPROVED_CATALOGUE_PRICE"],
      missing_fields: [],
      follow_up_fields: [],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: {
        intent: "quote_information_collection",
        market: "NZ",
        productKey: "roll-up-banner",
        size: "standard",
        asksCataloguePrice: true,
      },
      ruleIds: quoteRuleIds,
      qualityGuideId: "quote_information_collection",
      qualityRequirementIds: quoteQualityRequirementIds,
      canonicalQuote: {
        status: "verified",
        sourceRevision: 12,
        facts: [{ productKey: "roll-up-banner", sizeKey: "standard", currency: "NZD" }],
      },
      allowedFactIds: ["APPROVED_CATALOGUE_PRICE"],
      allowedFollowUpFields: [],
    }),
  },
  {
    id: "a2-canvas-follow-up",
    currentText: "A2, 3 people",
    context: [
      customer("How much for A2 canvas in NZ?"),
      staff("Which Canvas type would you like?"),
      customer("A2, 3 people"),
    ],
    facebookOutput: "Which Canvas type would you like: Photo Print, Digital Oil Painting, or Custom Themed?",
    websiteOutput: websiteDecision({
      product_type: "CANVAS",
      missing_fields: ["PRODUCT_TYPE"],
      follow_up_fields: ["PRODUCT_TYPE"],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: {
        intent: "quote_information_collection",
        market: "NZ",
        productCandidates: canvasProductCandidates,
        size: "a2",
        peoplePets: 3,
        missingFields: ["PRODUCT_TYPE"],
        asksCataloguePrice: true,
      },
      ruleIds: quoteRuleIds,
      qualityGuideId: "quote_information_collection",
      qualityRequirementIds: quoteQualityRequirementIds,
      canonicalQuote: { status: "clarification_required", sourceRevision: 12, missing: ["product"] },
      allowedFactIds: [],
      allowedFollowUpFields: ["PRODUCT_TYPE"],
    }),
  },
  {
    id: "wall-banner-au",
    currentText: "Australia",
    context: [
      customer("How much for wall hanging banner?"),
      staff("Is this for New Zealand or Australia?"),
      customer("Australia"),
    ],
    facebookOutput: "What size do you need?",
    websiteOutput: websiteDecision({
      product_type: "BANNER",
      missing_fields: ["SIZE"],
      follow_up_fields: ["SIZE"],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: {
        intent: "quote_information_collection",
        market: "AU",
        productKey: "custom-themed-wall-banner",
        missingFields: ["SIZE"],
        asksCataloguePrice: true,
      },
      ruleIds: quoteRuleIds,
      qualityGuideId: "quote_information_collection",
      qualityRequirementIds: quoteQualityRequirementIds,
      canonicalQuote: { status: "clarification_required", sourceRevision: 12, missing: ["size"] },
      allowedFactIds: [],
      allowedFollowUpFields: ["SIZE"],
    }),
  },
  {
    id: "brisbane-shipping",
    currentText: "Do you ship to Brisbane?",
    context: [customer("Do you ship to Brisbane?")],
    blocked: true,
    expectedConversation: { intent: "unknown" },
  },
  {
    id: "turnaround",
    currentText: "How long does it take?",
    context: [customer("How long does it take?")],
    blocked: true,
    expectedConversation: { intent: "unknown" },
  },
  {
    id: "product-guidance",
    currentText: "What is the difference between canvas and a banner?",
    context: [customer("What is the difference between canvas and a banner?")],
    facebookOutput: "Canvas suits a wall display and keepsake-style presentation. Banners can suit event displays; tell us whether you need a wall or freestanding format.",
    websiteOutput: websiteDecision({
      response_type: "ANSWER_SAFE",
      intent: "product_differences",
      allowed_facts: ["CANVAS_WALL_KEEPSAKE", "BANNER_DISPLAY_OPTIONS"],
      missing_fields: [],
      follow_up_fields: [],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: { intent: "product_differences", productCandidates: canvasProductCandidates },
      ruleIds: ["AI-SCOPE-02", "PRODUCT-04", "PRODUCT-05", "PRODUCT-06"],
      qualityGuideId: "product_differences",
      qualityRequirementIds: ["display_method", "product_structure", "product_use_cases", "recommendation_reason"],
      canonicalQuote: { status: "not_requested" },
      allowedFactIds: [
        "CANVAS_WALL_KEEPSAKE",
        "CANVAS_PERMANENT_KEEPSAKE_RECOMMENDATION",
        "BANNER_DISPLAY_OPTIONS",
        "ROLL_UP_FREESTANDING_RECOMMENDATION",
      ],
      allowedFollowUpFields: ["PRODUCT_TYPE"],
    }),
  },
  {
    id: "design-guidance",
    currentText: "How does the design process work?",
    context: [customer("How does the design process work?")],
    facebookOutput: "We’ll collect your photos, wording, theme and colour preferences. We’ll then prepare a design draft for you to review before printing.",
    websiteOutput: websiteDecision({
      response_type: "ANSWER_SAFE",
      intent: "design_process",
      allowed_facts: ["DESIGN_INPUTS", "DESIGN_DRAFT_REVIEW_BEFORE_PRINTING"],
      missing_fields: [],
      follow_up_fields: [],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: { intent: "design_process" },
      ruleIds: ["AI-SCOPE-04", "DESIGN-01", "DESIGN-06", "PHOTO-01"],
      qualityGuideId: "design_process",
      qualityRequirementIds: [
        "design_inputs",
        "photo_arrangement",
        "draft_review",
        "adjustments_and_approval",
        "approval_to_production",
      ],
      canonicalQuote: { status: "not_requested" },
      allowedFactIds: [
        "DESIGN_INPUTS",
        "DESIGN_DRAFT_REVIEW_BEFORE_PRINTING",
        "HAPPY_50TH_BIRTHDAY_MUM_WORDING_NOTED",
        "WORDING_NOTED",
      ],
      allowedFollowUpFields: [
        "PRODUCT_TYPE",
        "SIZE",
        "ORIGINAL_PHOTOS",
        "WORDING",
        "THEME",
        "COLOUR_PREFERENCES",
      ],
    }),
  },
  {
    id: "production-guidance",
    currentText: "What is the general production process?",
    context: [customer("What is the general production process?")],
    facebookOutput: "Once your design is approved, we’ll proceed to printing and production. Once the order is confirmed, we can arrange delivery.",
    websiteOutput: websiteDecision({
      response_type: "ANSWER_SAFE",
      intent: "production_process",
      allowed_facts: ["PRODUCTION_AFTER_APPROVAL", "DELIVERY_AFTER_CONFIRMATION"],
      missing_fields: [],
      follow_up_fields: [],
    }),
    expectedContext: expectedAllowedBusinessContext({
      conversation: { intent: "production_process" },
      ruleIds: ["AI-SCOPE-06", "DESIGN-06", "VOICE-01"],
      qualityGuideId: "production_process",
      qualityRequirementIds: [
        "production_inputs",
        "artwork_preparation",
        "customer_approval",
        "printing_transition",
        "production_next_step",
      ],
      canonicalQuote: { status: "not_requested" },
      allowedFactIds: ["PRODUCTION_AFTER_APPROVAL", "DELIVERY_AFTER_CONFIRMATION"],
      allowedFollowUpFields: [],
    }),
  },
];

function repositoryFor(
  channel: CustomerServiceChannel,
  currentText: string,
  context: readonly ConversationContextItem[],
) {
  const methods = {
    loadDraftInput: vi.fn<CustomerServiceRepository["loadDraftInput"]>(async () => ({
      current: { id: `${channel}-message`, text: currentText, channel },
      context,
    })),
    selectImageContext: vi.fn<CustomerServiceRepository["selectImageContext"]>(async () => null),
    createGateBlockedAttempt: vi.fn<CustomerServiceRepository["createGateBlockedAttempt"]>(
      async () => `${channel}-blocked-attempt`,
    ),
    reserveProviderAttempt: vi.fn<CustomerServiceRepository["reserveProviderAttempt"]>(
      async () => ({ status: "reserved", attemptId: `${channel}-attempt` }),
    ),
    confirmProviderInvocation: vi.fn<CustomerServiceRepository["confirmProviderInvocation"]>(
      async () => ({ status: "allowed" }),
    ),
    retrieveApprovedCaseMemories: vi.fn<CustomerServiceRepository["retrieveApprovedCaseMemories"]>(
      async () => [],
    ),
    completeProviderAttempt: vi.fn<CustomerServiceRepository["completeProviderAttempt"]>(async () => undefined),
  };
  return methods as typeof methods & CustomerServiceRepository;
}

async function runChannel(input: Readonly<{
  channel: CustomerServiceChannel;
  currentText: string;
  context: readonly ConversationContextItem[];
  modelOutput: string;
}>) {
  const repository = repositoryFor(input.channel, input.currentText, input.context);
  const provider = {
    providerKind: "mock" as const,
    model: "parity-model",
    generate: vi.fn(async (request: AiProviderRequest) => {
      void request;
      return {
        text: input.modelOutput,
        provider: "mock" as const,
        model: "parity-model",
        usage: { inputTokens: 8, cachedInputTokens: 0, outputTokens: 4 },
        estimatedCostMicrousd: 0,
        latencyMs: 1,
      };
    }),
  };
  const engine = new CustomerServiceEngine({
    repository,
    provider,
    pricingSource: async () => ({ revision: 12, registry: defaultProductRegistry }),
    knowledge: compiledKnowledge,
    budget: {
      reservationMicrousd: 1_000,
      dailyHardStopMicrousd: 1_000_000,
      totalHardStopMicrousd: 5_000_000,
    },
  });
  const result = await engine.generateDraft({
    messageId: `${input.channel}-message`,
    trigger: "webhook_after",
  });
  return { repository, provider, result };
}

function resolvedBusinessContext(prompt: AiProviderRequest) {
  const prefix = "Server-resolved business context: ";
  const line = prompt.instructions.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, "the real channel prompt must carry server-owned business context").toBeDefined();
  return JSON.parse(line!.slice(prefix.length)) as Record<string, unknown>;
}

function completion(run: Awaited<ReturnType<typeof runChannel>>) {
  return run.repository.completeProviderAttempt.mock.calls.at(-1)?.[0] as ProviderAttemptCompletion | undefined;
}

function promptFor(run: Awaited<ReturnType<typeof runChannel>>) {
  const prompt = run.provider.generate.mock.calls.at(-1)?.[0];
  expect(prompt).toBeDefined();
  return prompt!;
}

function expectNoFalseHandoff(
  run: Awaited<ReturnType<typeof runChannel>>,
  expectedResult: DraftGenerationResult,
) {
  expect(run.result).toEqual(expectedResult);
  expect(run.repository.createGateBlockedAttempt).not.toHaveBeenCalled();
}

function blockedBusinessContext(
  run: Awaited<ReturnType<typeof runChannel>>,
  currentText: string,
  context: readonly ConversationContextItem[],
) {
  const gateAttempt = run.repository.createGateBlockedAttempt.mock.calls[0]?.[0];
  expect(gateAttempt).toBeDefined();
  const state = resolveConversationState({
    currentText,
    history: context,
    productContext: null,
    registry: defaultProductRegistry,
  });
  expect(gateAttempt!.intent).toBe(state.intent.value);
  return {
    version: 1,
    conversation: {
      intent: state.intent.value,
      market: state.market?.value ?? null,
      productKey: state.product?.productKey ?? null,
      productCandidates: [...state.productCandidates],
      size: state.size?.value ?? null,
      peoplePets: state.peoplePets?.value ?? null,
      photoCount: state.photoCount?.value ?? null,
      missingFields: [...state.missingFields],
      asksCataloguePrice: state.asksCataloguePrice,
    },
    knowledge: {
      version: gateAttempt!.knowledgeVersion,
      ruleIds: [],
      qualityGuideId: null,
      qualityRequirementIds: [],
    },
    canonicalQuote: { status: "not_requested" },
    decision: {
      allowedFactIds: [],
      allowedFollowUpFields: [],
      policy: { decision: "NEEDS_HUMAN_REVIEW", reason: gateAttempt!.gateReasons[0] },
      handoff: { required: true, reason: gateAttempt!.gateReasons[0] },
    },
  };
}

describe("real Facebook and Website engine parity", () => {
  it("contains every locked real-engine parity acceptance row", () => {
    expect(lockedRealEngineParityMatrix.map((row) => row.id))
      .toEqual(REQUIRED_REAL_ENGINE_PARITY_CASE_IDS);
  });

  it.each(lockedRealEngineParityMatrix)(
    "exercises the locked real-engine parity row: $id",
    async (row) => {
      const [facebook, website] = await Promise.all([
        runChannel({
          channel: "facebook",
          currentText: row.currentText,
          context: row.context,
          modelOutput: "blocked" in row ? "unused" : row.facebookOutput,
        }),
        runChannel({
          channel: "website",
          currentText: row.currentText,
          context: row.context,
          modelOutput: "blocked" in row ? "unused" : row.websiteOutput,
        }),
      ]);

      if ("blocked" in row) {
        expect(facebook.result).toEqual({
          status: "gate_blocked",
          attemptId: "facebook-blocked-attempt",
        });
        expect(website.result).toEqual({
          status: "gate_blocked",
          attemptId: "website-blocked-attempt",
        });
        expect(facebook.provider.generate).not.toHaveBeenCalled();
        expect(website.provider.generate).not.toHaveBeenCalled();

        const expectedContext = {
          version: 1,
          conversation: {
            intent: row.expectedConversation.intent,
            market: row.expectedConversation.market ?? null,
            productKey: row.expectedConversation.productKey ?? null,
            productCandidates: row.expectedConversation.productCandidates ?? [],
            size: row.expectedConversation.size ?? null,
            peoplePets: row.expectedConversation.peoplePets ?? null,
            photoCount: row.expectedConversation.photoCount ?? null,
            missingFields: row.expectedConversation.missingFields ?? [],
            asksCataloguePrice: row.expectedConversation.asksCataloguePrice ?? false,
          },
          knowledge: {
            version: compiledKnowledge.knowledgeVersion,
            ruleIds: [],
            qualityGuideId: null,
            qualityRequirementIds: [],
          },
          canonicalQuote: { status: "not_requested" },
          decision: {
            allowedFactIds: [],
            allowedFollowUpFields: [],
            policy: { decision: "NEEDS_HUMAN_REVIEW", reason: "unresolved_intent" },
            handoff: { required: true, reason: "unresolved_intent" },
          },
        };
        expect(blockedBusinessContext(facebook, row.currentText, row.context)).toEqual(expectedContext);
        expect(blockedBusinessContext(website, row.currentText, row.context)).toEqual(expectedContext);
        expect(facebook.repository.createGateBlockedAttempt.mock.calls[0]?.[0]).toMatchObject({
          intent: row.expectedConversation.intent,
          gateResult: "unresolved",
          gateReasons: ["unresolved_intent"],
          knowledgeVersion: compiledKnowledge.knowledgeVersion,
        });
        expect(website.repository.createGateBlockedAttempt.mock.calls[0]?.[0]).toMatchObject({
          intent: row.expectedConversation.intent,
          gateResult: "unresolved",
          gateReasons: ["unresolved_intent"],
          knowledgeVersion: compiledKnowledge.knowledgeVersion,
        });
        return;
      }

      expectNoFalseHandoff(facebook, { status: "draft_ready", attemptId: "facebook-attempt" });
      expectNoFalseHandoff(website, { status: "draft_ready", attemptId: "website-attempt" });

      const facebookPrompt = promptFor(facebook);
      const websitePrompt = promptFor(website);
      expect(resolvedBusinessContext(facebookPrompt)).toEqual(row.expectedContext);
      expect(resolvedBusinessContext(websitePrompt)).toEqual(row.expectedContext);
      expect(websitePrompt.responseFormat).toMatchObject({
        name: "website_customer_service_decision_v1",
        schema: { additionalProperties: false },
      });
      expect(websitePrompt.instructions).not.toMatch(/NZ\$\d|AU\$\d|amountInclTaxCents/);

      const websiteCompletion = completion(website);
      expect(completion(facebook)).toMatchObject({
        status: "draft_ready",
        draftText: row.facebookOutput,
      });
      expect(websiteCompletion).toMatchObject({
        status: "draft_ready",
        draftText: expect.any(String),
        websiteDecision: JSON.parse(row.websiteOutput) as Record<string, unknown>,
      });
      if (row.expectedContext.canonicalQuote.status === "verified") {
        const price = websiteCompletion?.websiteDecision?.approved_catalogue_price;
        expect(price).toBeDefined();
        const currencyPrefix = price!.currency === "NZD" ? "NZ$" : "AU$";
        const formattedPrice = `${currencyPrefix}${(price!.amountInclTaxCents / 100).toFixed(2)}`;
        expect(facebookPrompt.instructions).toContain(formattedPrice);
        expect(websitePrompt.instructions).not.toContain(formattedPrice);
      }
    },
  );

  it.each([
    "Which Canvas type would you like?",
    "Which type of Canvas would you like?",
    "Would you prefer Photo Print, Digital Oil Painting, or Custom Themed Canvas?",
  ])("keeps the complete Canvas subtype answer and exposes the same approved three-person quote: %s", async (question) => {
    const currentText = "Digital oil painting canvas";
    const context = [
      customer("How much for canvas in New Zealand?"),
      staff(question),
      customer("A2 3 people"),
      customer(currentText),
    ];
    const facebook = await runChannel({
      channel: "facebook",
      currentText,
      context,
      modelOutput: "Digital Oil Painting Canvas in A2 for 3 people is currently NZ$210.45.",
    });
    const website = await runChannel({
      channel: "website",
      currentText,
      context,
      modelOutput: websiteDecision({
        response_type: "ANSWER_SAFE",
        allowed_facts: ["APPROVED_CATALOGUE_PRICE"],
        missing_fields: [],
        follow_up_fields: [],
      }),
    });

    expectNoFalseHandoff(facebook, { status: "draft_ready", attemptId: "facebook-attempt" });
    expectNoFalseHandoff(website, { status: "draft_ready", attemptId: "website-attempt" });

    const expectedContext = {
      version: 1,
      conversation: {
        intent: "quote_information_collection",
        market: "NZ",
        productKey: "digital-oil-painting-canvas",
        productCandidates: [],
        size: "a2",
        peoplePets: 3,
        photoCount: null,
        missingFields: [],
        asksCataloguePrice: true,
      },
      knowledge: {
        version: compiledKnowledge.knowledgeVersion,
        ruleIds: ["AI-SCOPE-03", "VOICE-01"],
        qualityGuideId: "quote_information_collection",
        qualityRequirementIds: [
          "product_and_size",
          "photos_and_people",
          "design_preferences",
          "date_and_location",
          "quote_next_step",
        ],
      },
      canonicalQuote: {
        status: "verified",
        sourceRevision: 12,
        facts: [{
          productKey: "digital-oil-painting-canvas",
          sizeKey: "a2",
          peoplePets: 3,
          currency: "NZD",
        }],
      },
      decision: {
        allowedFactIds: ["APPROVED_CATALOGUE_PRICE"],
        allowedFollowUpFields: [],
        policy: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        handoff: { required: false, reason: null },
      },
    };
    const facebookPrompt = promptFor(facebook);
    const websitePrompt = promptFor(website);
    expect(resolvedBusinessContext(facebookPrompt)).toEqual(expectedContext);
    expect(resolvedBusinessContext(websitePrompt)).toEqual(expectedContext);

    expect(completion(facebook)).toMatchObject({
      status: "draft_ready",
      draftText: "Digital Oil Painting Canvas in A2 for 3 people is currently NZ$210.45.",
    });
    expect(completion(website)).toMatchObject({
      status: "draft_ready",
      draftText: "Digital Oil Painting Canvas (A2 — 59.4 × 42 cm, 3 people/pets) is currently NZ$210.45.",
      websiteDecision: {
        response_type: "ANSWER_SAFE",
        intent: "quote_information_collection",
        product_type: "UNSPECIFIED",
        missing_fields: [],
        follow_up_fields: [],
        allowed_facts: ["APPROVED_CATALOGUE_PRICE"],
        human_review_reason: "NONE",
        approved_catalogue_price: {
          sourceRevision: 12,
          productKey: "digital-oil-painting-canvas",
          productTitle: "Digital Oil Painting Canvas",
          sizeKey: "a2",
          sizeLabel: "A2 — 59.4 × 42 cm",
          peoplePets: 3,
          currency: "NZD",
          amountInclTaxCents: 21_045,
        },
      },
    });
    expect(websitePrompt.responseFormat).toMatchObject({
      name: "website_customer_service_decision_v1",
      schema: { additionalProperties: false },
    });
    expect(websitePrompt.instructions).not.toMatch(/NZ\$\d|AU\$\d|amountInclTaxCents/);
  });

  it("continues Roll-up to verified NZ pricing through both real engines", async () => {
    const currentText = "New Zealand";
    const context = [
      customer("How much for roll up banner?"),
      staff("Is this for New Zealand or Australia?"),
      customer(currentText),
    ];
    const facebook = await runChannel({
      channel: "facebook",
      currentText,
      context,
      modelOutput: "The current Roll-Up Banner price is NZ$264.50.",
    });
    const website = await runChannel({
      channel: "website",
      currentText,
      context,
      modelOutput: websiteDecision({
        response_type: "ANSWER_SAFE",
        allowed_facts: ["APPROVED_CATALOGUE_PRICE"],
        missing_fields: [],
        follow_up_fields: [],
      }),
    });

    expectNoFalseHandoff(facebook, { status: "draft_ready", attemptId: "facebook-attempt" });
    expectNoFalseHandoff(website, { status: "draft_ready", attemptId: "website-attempt" });
    expect(resolvedBusinessContext(promptFor(facebook))).toEqual(
      resolvedBusinessContext(promptFor(website)),
    );
    expect(completion(website)).toMatchObject({
      status: "draft_ready",
      websiteDecision: expect.objectContaining({
        approved_catalogue_price: expect.objectContaining({
          productKey: "roll-up-banner",
          amountInclTaxCents: 26_450,
        }),
      }),
    });
  });

  it.each([
    {
      name: "Canvas subtype",
      currentText: "A2 3 people",
      context: [
        customer("How much for canvas in New Zealand?"),
        staff("Which Canvas type would you like?"),
        customer("A2 3 people"),
      ],
      followUps: ["PRODUCT_TYPE"],
      facebookOutput: "Which Canvas type would you like: Photo Print, Digital Oil Painting, or Custom Themed?",
      websiteOutput: websiteDecision({ product_type: "CANVAS", missing_fields: ["PRODUCT_TYPE"], follow_up_fields: ["PRODUCT_TYPE"] }),
    },
    {
      name: "Roll-up market",
      currentText: "How much for a roll-up banner?",
      context: [customer("How much for a roll-up banner?")],
      followUps: ["MARKET"],
      facebookOutput: "Is this for New Zealand or Australia?",
      websiteOutput: websiteDecision(),
    },
    {
      name: "Wall Banner size",
      currentText: "How much for a Custom Themed Wall Banner in New Zealand?",
      context: [customer("How much for a Custom Themed Wall Banner in New Zealand?")],
      followUps: ["SIZE"],
      facebookOutput: "What size do you need?",
      websiteOutput: websiteDecision({ product_type: "BANNER", missing_fields: ["SIZE"], follow_up_fields: ["SIZE"] }),
    },
    {
      name: "Digital Oil Canvas people count",
      currentText: "How much for an A2 Digital Oil Painting Canvas in New Zealand?",
      context: [customer("How much for an A2 Digital Oil Painting Canvas in New Zealand?")],
      followUps: ["PEOPLE_COUNT"],
      facebookOutput: "About how many people or pets would you like included?",
      websiteOutput: websiteDecision({ product_type: "CANVAS", missing_fields: ["PEOPLE_COUNT"], follow_up_fields: ["PEOPLE_COUNT"] }),
    },
  ])("asks only for the ordinary missing $name field without false Human Review", async ({
    currentText,
    context,
    followUps,
    facebookOutput,
    websiteOutput,
  }) => {
    const facebook = await runChannel({ channel: "facebook", currentText, context, modelOutput: facebookOutput });
    const website = await runChannel({ channel: "website", currentText, context, modelOutput: websiteOutput });

    expectNoFalseHandoff(facebook, { status: "draft_ready", attemptId: "facebook-attempt" });
    expectNoFalseHandoff(website, { status: "draft_ready", attemptId: "website-attempt" });
    const facebookContext = resolvedBusinessContext(promptFor(facebook));
    const websiteContext = resolvedBusinessContext(promptFor(website));
    expect(facebookContext).toEqual(websiteContext);
    expect(facebookContext).toMatchObject({
      canonicalQuote: { status: "clarification_required", sourceRevision: 12 },
      decision: {
        allowedFactIds: [],
        allowedFollowUpFields: followUps,
        policy: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        handoff: { required: false, reason: null },
      },
    });
    expect(completion(website)).toMatchObject({
      status: "draft_ready",
      websiteDecision: expect.objectContaining({ missing_fields: followUps, follow_up_fields: followUps }),
    });
  });

  it("keeps an ordinary missing photo field in the safe ask flow on both channels", async () => {
    const currentText = "What photo quality works best?";
    const context = [customer(currentText)];
    const facebook = await runChannel({
      channel: "facebook",
      currentText,
      context,
      modelOutput: "Please send the original photo file so we can assess its quality.",
    });
    const website = await runChannel({
      channel: "website",
      currentText,
      context,
      modelOutput: websiteDecision({
        response_type: "ASK_FOR_INFORMATION",
        intent: "photo_guidance",
        missing_fields: ["ORIGINAL_PHOTOS"],
        follow_up_fields: ["ORIGINAL_PHOTOS"],
      }),
    });

    expectNoFalseHandoff(facebook, { status: "draft_ready", attemptId: "facebook-attempt" });
    expectNoFalseHandoff(website, { status: "draft_ready", attemptId: "website-attempt" });
    const facebookContext = resolvedBusinessContext(promptFor(facebook));
    expect(facebookContext).toEqual(resolvedBusinessContext(promptFor(website)));
    expect(facebookContext).toMatchObject({
      canonicalQuote: { status: "not_requested" },
      decision: {
        allowedFactIds: ["PHOTO_ORIGINAL_FILES", "PHOTO_QUALITY_ASSESSMENT", "PHOTO_COMBINE_SUBJECTS"],
        allowedFollowUpFields: ["PHOTO_COUNT", "ORIGINAL_PHOTOS"],
        policy: { decision: "DRAFT_ALLOWED", reason: "confirmed_draft_scope" },
        handoff: { required: false, reason: null },
      },
    });
    expect(completion(website)).toMatchObject({
      status: "draft_ready",
      websiteDecision: expect.objectContaining({
        intent: "photo_guidance",
        missing_fields: ["ORIGINAL_PHOTOS"],
        follow_up_fields: ["ORIGINAL_PHOTOS"],
      }),
    });
  });

  it("produces the same policy handoff for an actually unresolved request", async () => {
    const currentText = "Do you ship to Brisbane?";
    const context = [customer(currentText)];
    const [facebook, website] = await Promise.all([
      runChannel({ channel: "facebook", currentText, context, modelOutput: "unused" }),
      runChannel({ channel: "website", currentText, context, modelOutput: "unused" }),
    ]);

    expect(facebook.result).toEqual({ status: "gate_blocked", attemptId: "facebook-blocked-attempt" });
    expect(website.result).toEqual({ status: "gate_blocked", attemptId: "website-blocked-attempt" });
    expect(facebook.provider.generate).not.toHaveBeenCalled();
    expect(website.provider.generate).not.toHaveBeenCalled();
    expect(facebook.repository.createGateBlockedAttempt.mock.calls[0]?.[0]).toMatchObject({
      intent: "unknown",
      gateResult: "unresolved",
      gateReasons: ["unresolved_intent"],
    });
    expect(website.repository.createGateBlockedAttempt.mock.calls[0]?.[0]).toMatchObject({
      intent: "unknown",
      gateResult: "unresolved",
      gateReasons: ["unresolved_intent"],
    });
  });

  it("rejects Website prose and model-supplied amount fields before public rendering", async () => {
    const currentText = "How much for a roll-up banner in New Zealand?";
    const context = [customer(currentText)];
    for (const modelOutput of [
      "The price is NZ$1.00.",
      websiteDecision({
        response_type: "ANSWER_SAFE",
        missing_fields: [],
        follow_up_fields: [],
        allowed_facts: ["APPROVED_CATALOGUE_PRICE"],
        amountInclTaxCents: 100,
      }),
    ]) {
      const website = await runChannel({ channel: "website", currentText, context, modelOutput });
      expect(website.result).toEqual({ status: "output_blocked", attemptId: "website-attempt" });
      expect(completion(website)).toMatchObject({
        status: "output_blocked",
        validatorCodes: ["website_decision_schema_invalid"],
      });
      expect(completion(website)).not.toHaveProperty("draftText");
    }
  });
});
