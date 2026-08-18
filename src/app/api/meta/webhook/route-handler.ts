import { after } from "next/server";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createMetaWebhookHandlers } from "@/server/customer-service/meta/webhook-handler";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";

const config = parseCustomerServiceConfig();
const handlers = createMetaWebhookHandlers({
  config,
  ingest: (message) => createCustomerServiceRuntime().repository.ingestConversationEvent(message),
  sealTurn: (input) => createCustomerServiceRuntime().repository.sealDueCustomerTurn(input),
  generateDraft: (messageId) => createCustomerServiceRuntime().engine.generateDraft(
    {
      messageId,
      trigger: "webhook_after",
    },
  ),
  kickImageJob: async (jobId) => {
    const runner = createCustomerServiceRuntime().imageJobRunner;
    if (!runner) throw new Error("customer_service_image_jobs_unavailable");
    return runner.runOnce({ jobId });
  },
  recoverHumanReplies: (input) => createCustomerServiceRuntime().repository.recoverDueHumanReplies({
    ...input,
    knowledgeVersion: compiledKnowledge.knowledgeVersion,
  }),
  scheduleAfter: (task) => after(task),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
