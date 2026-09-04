import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createAiControlHandler } from "./route-handler";

const config = parseRnrAiMetaConfig();
const handler = createAiControlHandler({
  store: () => RedisReplyRuntimeStore.fromEnvironment(),
  requirePermission: requireAdminPermission,
  masterEnabled: config.masterEnabled,
});

export const { GET, POST } = handler;
