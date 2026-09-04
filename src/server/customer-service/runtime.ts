import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { getDatabase } from "@/server/db/client";
import { parseCustomerServiceConfig } from "./config";
import { CustomerServiceEngine } from "./engine";
import { MockAiProvider } from "./providers/mock-provider";
import { OpenAIResponsesProvider } from "./providers/openai-responses";
import { createDrizzleCustomerServiceRepository } from "./repositories/drizzle-customer-service-repository";
import { createPrivateAttachmentStore } from "./attachments/private-attachment-store";
import { createImageJobRunner } from "./image-job-runner";
import { createCustomerTurnRecoveryRunner } from "./turn-recovery-runner";
import { createReviewAlertService } from "./website/review-alert-service";
import { createResendEmailProvider } from "@/server/notifications/resend-email-provider";
import { getProductRegistryRuntime } from "@/server/admin/product-registry-runtime";
import { createRnrAiBrain } from "@/server/rnr-ai/brain";
import { loadBusinessBrain } from "@/server/rnr-ai/business-brain/loader";
import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { OpenAiSolProvider } from "@/server/rnr-ai/providers/openai-sol";
import { BusinessToolRegistry } from "@/server/rnr-ai/tools/tool-registry";
import { createWebsiteBrainAdapter } from "@/server/rnr-ai/website/website-brain-adapter";

export type WebsiteReplyGenerationMode = "legacy" | "shared_brain";

export function selectWebsiteReplyGenerationMode(env: NodeJS.ProcessEnv = process.env): WebsiteReplyGenerationMode {
  const config = parseRnrAiMetaConfig(env);
  return config.masterEnabled && config.websiteSharedBrainEnabled ? "shared_brain" : "legacy";
}

export function createCustomerServiceRuntime(env: NodeJS.ProcessEnv = process.env) {
  const config = parseCustomerServiceConfig(env);
  const repository = createDrizzleCustomerServiceRepository(getDatabase(), {
    ...(config.websiteEnabled ? { reviewSelectorSecret: config.websiteSessionSecret } : {}),
  });
  const provider = config.provider === "openai"
    ? new OpenAIResponsesProvider({ apiKey: config.openaiApiKey, model: config.openaiModel })
    : new MockAiProvider();
  const websiteGenerationMode = selectWebsiteReplyGenerationMode(env);
  const websiteBrain = websiteGenerationMode === "shared_brain"
    ? (() => {
      const businessBrain = loadBusinessBrain();
      const unavailable = async () => Object.freeze({
        status: "unavailable_review_required" as const,
        source: "website_live_tool_not_configured",
        facts: Object.freeze({}),
      });
      return createWebsiteBrainAdapter({
        businessBrain,
        brain: createRnrAiBrain({
          provider: new OpenAiSolProvider({ apiKey: env.OPENAI_API_KEY ?? "" }),
          tools: new BusinessToolRegistry({
            businessBrain,
            shipping: { quote: unavailable },
            orderStatus: { read: unavailable },
            paymentStatus: { read: unavailable },
          }),
        }),
      });
    })()
    : undefined;
  const engine = new CustomerServiceEngine({
    repository,
    provider,
    websiteBrain,
    knowledge: compiledKnowledge,
    pricingSource: () => getProductRegistryRuntime().current(),
    budget: {
      reservationMicrousd: 1_000,
      dailyHardStopMicrousd: config.dailyHardStopMicrousd,
      totalHardStopMicrousd: config.totalHardStopMicrousd,
      websiteDailyWarningMicrousd: config.websiteDailyWarningMicrousd,
      websiteDailyHardStopMicrousd: config.websiteDailyHardStopMicrousd,
      websiteTotalHardStopMicrousd: config.websiteTotalHardStopMicrousd,
    },
  });
  const imageJobRunner = config.imageAnalysisEnabled
    ? createImageJobRunner({
      repository,
      policyCheck: (messageId) => engine.checkImageJobPolicy(messageId),
      store: createPrivateAttachmentStore(config.blobReadWriteToken),
    })
    : undefined;
  const turnRecoveryRunner = createCustomerTurnRecoveryRunner({
    repository,
    generateDraft: (messageId) => engine.generateDraft({ messageId, trigger: "webhook_after" }),
    knowledgeVersion: compiledKnowledge.knowledgeVersion,
    allowedChannels: [
      ...(config.enabled ? ["facebook" as const] : []),
      ...(config.websiteEnabled ? ["website" as const] : []),
    ],
    ...(config.websiteEnabled ? { reviewAlertSecret: config.reviewLinkSecret } : {}),
  });
  const reviewAlertService = config.websiteEnabled
    ? createReviewAlertService({
      repository,
      provider: createResendEmailProvider({
        RESEND_API_KEY: env.RESEND_API_KEY,
        EMAIL_FROM: env.EMAIL_FROM,
      }),
      alertTo: config.replyAssistantAlertTo,
      providerFrom: env.EMAIL_FROM?.trim() ?? "",
      siteUrl: env.BETTER_AUTH_URL ?? "http://192.168.4.199:3000",
      deepLinkSecret: config.reviewLinkSecret,
      providerScopeFingerprint: config.reviewAlertProviderScopeFingerprint,
    })
    : undefined;
  const processWebsiteTurn = (
    turnId: string,
    expectedMode: WebsiteReplyGenerationMode,
  ) => {
    if (expectedMode !== websiteGenerationMode) {
      return Promise.resolve(Object.freeze({ result: "generation_mode_changed" as const }));
    }
    return turnRecoveryRunner.runOnce({ turnId });
  };
  return Object.freeze({
    config,
    repository,
    engine,
    imageJobRunner,
    turnRecoveryRunner,
    reviewAlertService,
    websiteGenerationMode,
    processWebsiteTurn,
  });
}
