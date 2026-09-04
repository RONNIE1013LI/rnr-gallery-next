export const runtime = "nodejs";

import { requireAdminPermission } from "@/server/auth/require-admin";
import { createDrizzleCustomerServiceRepository } from "@/server/customer-service/repositories/drizzle-customer-service-repository";
import { getDatabase } from "@/server/db/client";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createConversationTakeoverHandler } from "./route-handler";

export const { GET, POST } = createConversationTakeoverHandler({
  store: () => RedisReplyRuntimeStore.fromEnvironment(),
  resolveInbox: (inboxId) => createDrizzleCustomerServiceRepository(getDatabase()).resolveReplyAssistantInbox(inboxId),
  requirePermission: requireAdminPermission,
});
