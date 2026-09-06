import { z } from "zod";
import { customerServiceApiError, noStoreJson } from "@/server/customer-service/api-response";
import { assertTrustedMutationRequest, parseBoundedJson } from "@/server/http/mutation-request";
import type { ReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/reply-runtime-store";

const selectorSchema = z.string().regex(/^[a-f0-9]{64}$/);
const mutationSchema = z.object({ active: z.boolean() }).strict();
type RouteContext = Readonly<{ params: Promise<Readonly<{ conversationKey: string }>> }>;

export function createConversationTakeoverHandler(dependencies: Readonly<{
  store: () => ReplyRuntimeStore;
  resolveInbox: (inboxId: string) => Promise<Readonly<{ identityKeyHash: string; channel?: string }> | null>;
  requirePermission: (permission: "use_reply_assistant") => Promise<{ user: { id: string } }>;
  readWebsiteTakeover?: (inboxId: string) => Promise<{ active: boolean } | null>;
  setWebsiteTakeover?: (inboxId: string, active: boolean, now: Date) => Promise<boolean>;
  trustedOrigin?: string;
  now?: () => Date;
}>) {
  const readSelector = async (context: RouteContext) => selectorSchema.parse((await context.params).conversationKey);
  return {
    async GET(_request: Request, context: RouteContext) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        const inboxId = await readSelector(context);
        const identity = await dependencies.resolveInbox(inboxId);
        if (!identity) return noStoreJson({ error: { code: "CONVERSATION_UNAVAILABLE" } }, 404);
        const websiteState = identity.channel === "website" ? await dependencies.readWebsiteTakeover?.(inboxId) : null;
        const state = websiteState ?? await dependencies.store().readTakeover(identity.identityKeyHash);
        return noStoreJson(state ?? { active: false, source: null, changedAt: null });
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
    async POST(request: Request, context: RouteContext) {
      try {
        await dependencies.requirePermission("use_reply_assistant");
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        const inboxId = await readSelector(context);
        const identity = await dependencies.resolveInbox(inboxId);
        if (!identity) return noStoreJson({ error: { code: "CONVERSATION_UNAVAILABLE" } }, 404);
        const input = mutationSchema.parse(await parseBoundedJson(request, 1_024));
        const state = {
          conversationKeyHash: identity.identityKeyHash,
          active: input.active,
          source: "admin" as const,
          changedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        };
        const websiteHandled = identity.channel === "website"
          ? await dependencies.setWebsiteTakeover?.(inboxId, input.active, new Date(state.changedAt))
          : false;
        if (!websiteHandled) await dependencies.store().setTakeover(state);
        return noStoreJson({ active: state.active, source: state.source, changedAt: state.changedAt });
      } catch (error) {
        return customerServiceApiError(error);
      }
    },
  };
}
