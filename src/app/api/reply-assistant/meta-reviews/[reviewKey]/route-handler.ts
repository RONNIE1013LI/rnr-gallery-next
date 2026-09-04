import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";
import type { createMetaReviewPayloadProtector } from "@/server/rnr-ai/meta/review-payload-protector";
import type { ReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/reply-runtime-store";

const reviewKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
const mutationSchema = z.object({ action: z.literal("release_to_ai") }).strict();
type RouteContext = Readonly<{ params: Promise<Readonly<{ reviewKey: string }>> }>;

export function createMetaReviewDetailHandler(dependencies: Readonly<{
  store: () => ReplyRuntimeStore;
  protector: () => ReturnType<typeof createMetaReviewPayloadProtector>;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  trustedOrigin?: string;
  now?: () => Date;
}>) {
  const findReview = async (store: ReplyRuntimeStore, reviewKey: string) => (
    store.listReviewMetadata(100).then((reviews) => reviews.find((review) => review.key === reviewKey) ?? null)
  );

  return {
    async GET(_request: Request, context: RouteContext) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        const reviewKey = reviewKeySchema.parse((await context.params).reviewKey);
        const store = dependencies.store();
        const metadata = await findReview(store, reviewKey);
        if (!metadata) return noStoreJson({ error: { code: "NOT_FOUND" } }, 404);
        const [ciphertext, takeover] = await Promise.all([
          store.readEncryptedReview(reviewKey),
          store.readTakeover(metadata.conversationKeyHash),
        ]);
        if (!ciphertext) return noStoreJson({ error: { code: "NOT_FOUND" } }, 404);
        const payload = dependencies.protector().open(reviewKey, ciphertext);
        return noStoreJson({
          reviewKey,
          conversationKey: metadata.conversationKeyHash,
          risk: payload.risk,
          replyText: payload.replyText,
          reasons: payload.reasons,
          createdAt: metadata.createdAt,
          expiresAt: metadata.expiresAt,
          takeover: takeover ? {
            active: takeover.active,
            source: takeover.source,
            changedAt: takeover.changedAt,
          } : { active: false, source: null, changedAt: null },
        });
      } catch (error) {
        return customerServiceApiError(error);
      }
    },

    async POST(request: Request, context: RouteContext) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        mutationSchema.parse(await parseBoundedJson(request, 1_024));
        const reviewKey = reviewKeySchema.parse((await context.params).reviewKey);
        const store = dependencies.store();
        const metadata = await findReview(store, reviewKey);
        if (!metadata) return noStoreJson({ error: { code: "NOT_FOUND" } }, 404);
        const takeover = {
          conversationKeyHash: metadata.conversationKeyHash,
          active: false,
          source: "admin" as const,
          changedAt: (dependencies.now?.() ?? new Date()).toISOString(),
          ...(metadata.reviewedTurnKeyHash ? { resolvedTurnKeyHash: metadata.reviewedTurnKeyHash } : {}),
          resolvedThroughAt: metadata.createdAt,
        };
        await store.setTakeover(takeover);
        return noStoreJson({ takeover: {
          active: takeover.active,
          source: takeover.source,
          changedAt: takeover.changedAt,
        } });
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}
