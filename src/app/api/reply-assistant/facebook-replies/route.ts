export const runtime = "nodejs";

import { createHmac } from "node:crypto";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { sanitizeHumanOutboundText } from "@/server/customer-service/conversation/human-outbound-sanitizer";
import { createDrizzleCustomerServiceRepository } from "@/server/customer-service/repositories/drizzle-customer-service-repository";
import { getDatabase } from "@/server/db/client";
import { GraphMetaContextProvider } from "@/server/rnr-ai/meta/graph-context-provider";
import { createManualFacebookReplySender } from "@/server/rnr-ai/meta/manual-reply-sender";
import { RedisReplyRuntimeStore } from "@/server/rnr-ai/runtime-store/redis-reply-runtime-store";
import { createFacebookReplyHandler } from "./route-handler";

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is unavailable`);
  return normalized;
}

function createSender() {
  const config = parseCustomerServiceConfig();
  const accessToken = required(process.env.META_PAGE_ACCESS_TOKEN, "META_PAGE_ACCESS_TOKEN");
  if (!config.metaPageId || !config.idHashSecret) throw new Error("Meta Page identity configuration is unavailable");
  const repository = createDrizzleCustomerServiceRepository(getDatabase());
  const store = RedisReplyRuntimeStore.fromEnvironment();
  const context = new GraphMetaContextProvider({ accessToken });
  const hashExternalKey = (value: string) => createHmac("sha256", config.idHashSecret).update(value).digest("hex");
  return createManualFacebookReplySender({
    accessToken,
    pageId: config.metaPageId,
    store,
    resolveTarget: (input) => repository.resolveFacebookManualSendTarget(input),
    listConversations: (window) => context.listConversations({ pageId: config.metaPageId, window }),
    loadConversation: (locator) => context.loadConversation(locator),
    hashExternalKey,
    loadItem: async (inboxId) => (await repository.listQueue(100)).items.find((item) => item.inboxId === inboxId) ?? null,
    recordSent: async (input) => {
      const sanitized = sanitizeHumanOutboundText(input.text);
      await repository.ingestConversationEvent({
        channel: "facebook",
        role: "staff",
        eventType: "human_outbound",
        externalConversationKeyHash: input.target.identityKeyHash,
        externalMessageKeyHash: hashExternalKey(input.providerMessageId),
        text: sanitized.text,
        bodyHash: sanitized.bodyHash,
        redactionCodes: sanitized.redactionCodes,
        replyToExternalMessageKeyHash: input.target.latestCustomerMessageKeyHash,
        learningEligible: sanitized.learningEligible,
        humanReplyGroupMs: config.humanReplyGroupMs,
        attachments: [],
        imageJob: null,
        receivedAt: input.now,
      });
      await repository.appendFeedback({
        attemptId: input.attemptId,
        actorUserId: input.actorUserId,
        action: "sent_confirmed",
        humanFinalText: null,
        reasonCode: null,
        idempotencyKey: `facebook-send:${input.idempotencyKey}`,
      });
      const sent = (await repository.listQueue(100)).items.find((item) => item.inboxId === input.inboxId);
      if (!sent) throw new Error("manual_facebook_reply_reconciliation_failed");
      return sent;
    },
  });
}

const config = parseCustomerServiceConfig();
export const { POST } = createFacebookReplyHandler({
  enabled: config.enabled,
  requirePermission: requireAdminPermission,
  send: (input) => createSender().send(input),
});
