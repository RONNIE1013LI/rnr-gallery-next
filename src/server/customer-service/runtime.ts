import compiledKnowledge from "./knowledge/compiled-knowledge.json";
import { getDatabase } from "@/server/db/client";
import { parseCustomerServiceConfig } from "./config";
import { CustomerServiceEngine } from "./engine";
import { MockAiProvider } from "./providers/mock-provider";
import { OpenAIResponsesProvider } from "./providers/openai-responses";
import { createDrizzleCustomerServiceRepository } from "./repositories/drizzle-customer-service-repository";

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
  return Object.freeze({ config, repository, engine });
}
