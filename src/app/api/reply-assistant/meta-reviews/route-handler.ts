import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import type { ReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/reply-runtime-store";

export function createMetaReviewsHandler(dependencies: Readonly<{
  store: () => ReplyRuntimeStore;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
}>) {
  return { async GET() {
    try {
      await dependencies.requirePermission("use_reply_assistant");
      const reviews = await dependencies.store().listReviewMetadata(50);
      return noStoreJson({ reviews: reviews.map((review) => ({
        reviewKey: review.key,
        conversationKey: review.conversationKeyHash,
        risk: review.risk,
        createdAt: review.createdAt,
        expiresAt: review.expiresAt,
      })) });
    } catch (error) {
      return customerServiceApiError(error);
    }
  } };
}
