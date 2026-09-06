export const runtime = "nodejs";

import { requireAdminPermission } from "@/server/auth/require-admin";
import { createProductionInbox } from "@/server/rnr-ai/inbox/production-inbox";
import { RedisWebsiteRepository } from "@/server/rnr-ai/website/redis-website-repository";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createConversationTakeoverHandler } from "./route-handler";

export const { GET, POST } = createConversationTakeoverHandler({
  store: () => RedisReplyRuntimeStore.fromEnvironment(),
  resolveInbox: (inboxId) => createProductionInbox().resolveReplyAssistantInbox(inboxId),
  readWebsiteTakeover: (id) => RedisWebsiteRepository.fromEnvironment().readWebsiteTakeover(id),
  setWebsiteTakeover: (id, active, now) => RedisWebsiteRepository.fromEnvironment().setWebsiteTakeover(id, active, now),
  requirePermission: requireAdminPermission,
});
