import { createHmac } from "node:crypto";
import { after } from "next/server";
import { parseCustomerServiceConfig, type CustomerServiceConfig } from "@/server/customer-service/config";
import { createMetaWebhookHandlers } from "@/server/customer-service/meta/webhook-handler";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";
import { parseRnrAiMetaConfig, type RnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import type { MetaConversationEvent } from "@/server/rnr-ai/meta/types";
import { createProductionMetaReplyRuntime } from "@/server/rnr-ai/meta/runtime";

type FullLegacyRuntime = ReturnType<typeof createCustomerServiceRuntime>;
type LegacyRuntime = Readonly<{
  repository: Pick<FullLegacyRuntime["repository"], "ingestConversationEvent" | "recoverDueHumanReplies">;
  turnRecoveryRunner: Pick<FullLegacyRuntime["turnRecoveryRunner"], "runOnce">;
  imageJobRunner: Pick<NonNullable<FullLegacyRuntime["imageJobRunner"]>, "runOnce"> | undefined;
}>;
type SharedRuntime = Readonly<{
  orchestrator: Readonly<{ handle(event: MetaConversationEvent, execution?: Readonly<{ deadlineAt: number }>): Promise<unknown> }>;
}>;
export const META_WEBHOOK_INVOCATION_MS = 60_000;
export const META_REPLY_TAIL_RESERVE_MS = 15_000;

type AcceptedEvent = Parameters<NonNullable<Parameters<typeof createMetaWebhookHandlers>[0]["onAcceptedEvent"]>>[0];

function asMetaEvent(message: AcceptedEvent): MetaConversationEvent {
  const event = { ...message };
  delete event.providerTimestampValid;
  return Object.freeze({
    ...event,
    channel: "facebook" as const,
    attachments: Object.freeze(message.attachments.map((attachment) => Object.freeze({
      externalAttachmentKey: attachment.externalAttachmentKey,
      ordinal: attachment.ordinal,
      kind: attachment.kind,
      sourceRef: attachment.sourceRef?.kind === "facebook_remote"
        ? Object.freeze({ kind: "facebook_remote" as const, url: attachment.sourceRef.url })
        : null,
      mimeTypeHint: attachment.mimeTypeHint,
      failureCode: attachment.failureCode ?? null,
    }))),
  });
}

function isStageAAllowedRecipient(
  message: AcceptedEvent,
  customerConfig: CustomerServiceConfig,
  rnrConfig: RnrAiMetaConfig,
) {
  return Boolean(
    rnrConfig.stageAAllowedRecipientHash
    && rnrConfig.stageAActivatedAt
    && customerConfig.idHashSecret
    && message.receivedAt.getTime() >= rnrConfig.stageAActivatedAt.getTime()
    && createHmac("sha256", customerConfig.idHashSecret)
      .update(message.externalConversationKey)
      .digest("hex") === rnrConfig.stageAAllowedRecipientHash,
  );
}

export function createMetaWebhookRouteHandlers(dependencies: Readonly<{
  customerConfig: CustomerServiceConfig;
  rnrConfig: RnrAiMetaConfig;
  createLegacyRuntime(): LegacyRuntime;
  createSharedRuntime(): SharedRuntime;
  scheduleAfter(task: () => Promise<void>): void;
}>) {
  const common = {
    config: dependencies.customerConfig,
    scheduleAfter: dependencies.scheduleAfter,
    ingest: (message: Parameters<LegacyRuntime["repository"]["ingestConversationEvent"]>[0]) => (
      dependencies.createLegacyRuntime().repository.ingestConversationEvent(message)
    ),
    processTurn: (turnId: string) => dependencies.createLegacyRuntime().turnRecoveryRunner.runOnce({ turnId }),
    kickImageJob: async (jobId: string) => {
      const runner = dependencies.createLegacyRuntime().imageJobRunner;
      if (!runner) throw new Error("customer_service_image_jobs_unavailable");
      return runner.runOnce({ jobId });
    },
    recoverHumanReplies: (input: Readonly<{ now: Date; groupWindowMs: number; limit: number }>) => (
      dependencies.createLegacyRuntime().repository.recoverDueHumanReplies({
        ...input,
        knowledgeVersion: compiledKnowledge.knowledgeVersion,
      })
    ),
  };

  if (dependencies.rnrConfig.engineMode === "legacy") {
    return createMetaWebhookHandlers(common);
  }
  return createMetaWebhookHandlers({
    ...common,
    onAcceptedEvent: async (message, execution) => {
      if (!dependencies.rnrConfig.masterEnabled) return;
      if (message.providerTimestampValid !== true) return;
      if (!isStageAAllowedRecipient(message, dependencies.customerConfig, dependencies.rnrConfig)) return;
      await dependencies.createSharedRuntime().orchestrator.handle(asMetaEvent(message), {
        deadlineAt: execution.invocationStartedAtMs + META_WEBHOOK_INVOCATION_MS - META_REPLY_TAIL_RESERVE_MS,
      });
    },
  });
}

const config = parseCustomerServiceConfig();
const handlers = createMetaWebhookRouteHandlers({
  customerConfig: config,
  rnrConfig: parseRnrAiMetaConfig(),
  createLegacyRuntime: () => createCustomerServiceRuntime(),
  createSharedRuntime: () => createProductionMetaReplyRuntime(),
  scheduleAfter: (task) => after(task),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
