export const runtime = "nodejs";

import { requireAdminPermission } from "@/server/auth/require-admin";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createConversationTakeoverHandler } from "./route-handler";

export const { GET, POST } = createConversationTakeoverHandler({
  store: () => RedisReplyRuntimeStore.fromEnvironment(),
  requirePermission: requireAdminPermission,
});
