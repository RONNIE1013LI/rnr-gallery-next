export const runtime = "nodejs";

import { requireAdminPermission } from "@/server/auth/require-admin";
import { createMetaReviewPayloadProtector } from "@/server/rnr-ai/meta/review-payload-protector";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createMetaReviewDetailHandler } from "./route-handler";

export const { GET, POST } = createMetaReviewDetailHandler({
  store: () => RedisReplyRuntimeStore.fromEnvironment(),
  protector: () => createMetaReviewPayloadProtector(process.env.RNR_AI_REVIEW_ENCRYPTION_KEY ?? ""),
  requirePermission: requireAdminPermission,
});
