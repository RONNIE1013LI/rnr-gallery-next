import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { getDatabase } from "@/server/db/client";
import { parseCustomerServiceConfig } from "./config";
import { CustomerServiceEngine } from "./engine";
import { MockAiProvider } from "./providers/mock-provider";
import { OpenAIResponsesProvider } from "./providers/openai-responses";
import { createDrizzleCustomerServiceRepository } from "./repositories/drizzle-customer-service-repository";
import { createFacebookSourceReader } from "./attachments/facebook-source-reader";
import { createPrivateAttachmentStore } from "./attachments/private-attachment-store";
import { createAttachmentSourceProtector } from "./attachments/attachment-source-protector";
import { createImageJobRunner } from "./image-job-runner";
import { MockImageAnalysisProvider } from "./providers/mock-image-analysis";
import { OpenAIImageAnalysisProvider } from "./providers/openai-image-analysis";

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
    },
  });
  const imageJobRunner = config.imageAnalysisEnabled
    ? createImageJobRunner({
      repository,
      policyCheck: (messageId) => engine.checkImageJobPolicy(messageId),
      sourceProtector: createAttachmentSourceProtector(config.attachmentSourceEncryptionKey),
      sourceReader: createFacebookSourceReader({ allowedHosts: config.metaAttachmentAllowedHosts }),
      store: createPrivateAttachmentStore(config.blobReadWriteToken),
      imageProvider: config.provider === "openai"
        ? new OpenAIImageAnalysisProvider({ apiKey: config.openaiApiKey, model: config.imageAnalysisModel })
        : new MockImageAnalysisProvider(),
      generateDraft: (request) => engine.generateImageAwareDraft(request),
      budget: {
        imageReservationMicrousd: 1_000,
        textReservationMicrousd: 1_000,
        dailyHardStopMicrousd: config.dailyHardStopMicrousd,
        totalHardStopMicrousd: config.totalHardStopMicrousd,
      },
    })
    : undefined;
  return Object.freeze({ config, repository, engine, imageJobRunner });
}
