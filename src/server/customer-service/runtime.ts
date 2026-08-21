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

export function createCustomerServiceRuntime(env: NodeJS.ProcessEnv = process.env) {
  const config = parseCustomerServiceConfig(env);
  const repository = createDrizzleCustomerServiceRepository(getDatabase());
  const provider = config.provider === "openai"
    ? new OpenAIResponsesProvider({ apiKey: config.openaiApiKey, model: config.openaiModel })
    : new MockAiProvider();
  const engine = new CustomerServiceEngine({
    repository,
    provider,
    knowledge: compiledKnowledge,
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
  });
  return Object.freeze({ config, repository, engine, imageJobRunner, turnRecoveryRunner });
}
