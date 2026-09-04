import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import type { createMetaReviewPayloadProtector } from "@/server/rnr-ai/meta/review-payload-protector";
import type { ReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/reply-runtime-store";

const reviewKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
type RouteContext = Readonly<{ params: Promise<Readonly<{ reviewKey: string }>> }>;

export function createMetaReviewDetailHandler(dependencies: Readonly<{
  store: () => ReplyRuntimeStore;
  protector: () => ReturnType<typeof createMetaReviewPayloadProtector>;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
}>) {
  return { async GET(_request: Request, context: RouteContext) {
    try {
      await dependencies.requirePermission("use_reply_assistant");
      const reviewKey = reviewKeySchema.parse((await context.params).reviewKey);
      const store = dependencies.store();
      const [ciphertext, metadata] = await Promise.all([
        store.readEncryptedReview(reviewKey),
        store.listReviewMetadata(100).then((reviews) => reviews.find((review) => review.key === reviewKey) ?? null),
      ]);
      if (!ciphertext || !metadata) return noStoreJson({ error: { code: "NOT_FOUND" } }, 404);
      const payload = dependencies.protector().open(reviewKey, ciphertext);
      return noStoreJson({
        reviewKey,
        conversationKey: metadata.conversationKeyHash,
        risk: payload.risk,
        replyText: payload.replyText,
        reasons: payload.reasons,
        createdAt: metadata.createdAt,
        expiresAt: metadata.expiresAt,
      });
    } catch (error) {
      return customerServiceApiError(error);
    }
  } };
}
