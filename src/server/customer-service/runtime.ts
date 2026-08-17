import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { getDatabase } from "@/server/db/client";
import { parseCustomerServiceConfig } from "./config";
import { CustomerServiceEngine } from "./engine";
import { MockAiProvider } from "./providers/mock-provider";
import { OpenAIResponsesProvider } from "./providers/openai-responses";
import { createDrizzleCustomerServiceRepository } from "./repositories/drizzle-customer-service-repository";
import { createAttachmentProcessor } from "./attachments/attachment-processor";
import { createFacebookSourceReader } from "./attachments/facebook-source-reader";
import { createPrivateAttachmentStore } from "./attachments/private-attachment-store";
import { MockImageAnalysisProvider } from "./providers/mock-image-analysis";
import { OpenAIImageAnalysisProvider } from "./providers/openai-image-analysis";

export function createCustomerServiceRuntime(env: NodeJS.ProcessEnv = process.env) {
  const config = parseCustomerServiceConfig(env);
  const repository = createDrizzleCustomerServiceRepository(getDatabase());
  const provider = config.provider === "openai"
    ? new OpenAIResponsesProvider({ apiKey: config.openaiApiKey, model: config.openaiModel })
    : new MockAiProvider();
  const imageProvider = config.provider === "openai"
    ? new OpenAIImageAnalysisProvider({ apiKey: config.openaiApiKey, model: config.imageAnalysisModel })
    : new MockImageAnalysisProvider();
  const attachmentProcessor = config.imageAnalysisEnabled
    ? createAttachmentProcessor({
      repository,
      sourceReader: createFacebookSourceReader({ allowedHosts: config.metaAttachmentAllowedHosts }),
      attachmentStore: createPrivateAttachmentStore(config.blobReadWriteToken),
      imageProvider,
      budget: {
        reservationMicrousd: 1_000,
        dailyHardStopMicrousd: config.dailyHardStopMicrousd,
        totalHardStopMicrousd: config.totalHardStopMicrousd,
      },
    })
    : undefined;
  const engine = new CustomerServiceEngine({
    repository,
    provider,
    attachmentProcessor,
    knowledge: compiledKnowledge,
    budget: {
      reservationMicrousd: 1_000,
      dailyHardStopMicrousd: config.dailyHardStopMicrousd,
      totalHardStopMicrousd: config.totalHardStopMicrousd,
    },
  });
  return Object.freeze({ config, repository, engine });
}
