import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { parseRnrAiMetaConfig } from "../meta/config";
import { RedisWebsiteRepository } from "../website/redis-website-repository";
import { createProductionMetaInbox } from "./production-meta-inbox";
import { createUnifiedInbox } from "./unified-inbox";

export function createProductionInbox() {
  const config = parseCustomerServiceConfig();
  return createUnifiedInbox({
    legacy: () => createCustomerServiceRuntime().repository,
    website: () => RedisWebsiteRepository.fromEnvironment(),
    meta: () => createProductionMetaInbox(),
    websiteEnabled: config.websiteEnabled,
    metaEnabled: parseRnrAiMetaConfig().engineMode !== "legacy",
  });
}
