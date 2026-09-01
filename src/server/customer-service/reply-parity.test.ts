import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
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

describe("real Facebook and Website engine parity", () => {
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
