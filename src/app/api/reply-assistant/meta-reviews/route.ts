export const runtime = "nodejs";

import { requireAdminPermission } from "@/server/auth/require-admin";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createMetaReviewsHandler } from "./route-handler";

export const { GET } = createMetaReviewsHandler({
  store: () => RedisReplyRuntimeStore.fromEnvironment(),
  requirePermission: requireAdminPermission,
});
