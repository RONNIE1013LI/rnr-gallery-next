import { Redis } from "@upstash/redis";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { GraphMetaContextProvider } from "../meta/graph-context-provider";
import { MetaInbox } from "./meta-inbox";

export function createProductionMetaInbox(env: NodeJS.ProcessEnv = process.env) {
  const config = parseCustomerServiceConfig(env);
  const url = env.RNR_AI_REDIS_REST_URL?.trim();
  const token = env.RNR_AI_REDIS_REST_TOKEN?.trim();
  const namespace = env.RNR_AI_REDIS_NAMESPACE?.trim();
  const encryptionKey = env.RNR_AI_REVIEW_ENCRYPTION_KEY?.trim();
  const accessToken = env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!url || !token || !namespace || !encryptionKey || encryptionKey.length < 32 || !accessToken || !config.idHashSecret || !config.metaPageId) {
    throw new Error("meta_inbox_configuration_unavailable");
  }
  const context = new GraphMetaContextProvider({ accessToken, timeoutSignal: () => AbortSignal.timeout(3_000) });
  return new MetaInbox({
    redis: new Redis({ url, token }), namespace, encryptionKey, idHashSecret: config.idHashSecret,
    pageId: config.metaPageId, context,
    discover: () => context.listConversations({ pageId: config.metaPageId, window: {
      from: new Date(Date.now() - 86400_000).toISOString(), to: new Date().toISOString(), maxConversations: 100,
    } }),
  });
}
