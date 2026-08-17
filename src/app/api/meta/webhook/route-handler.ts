import { after } from "next/server";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createMetaWebhookHandlers } from "@/server/customer-service/meta/webhook-handler";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";

const config = parseCustomerServiceConfig();
const handlers = createMetaWebhookHandlers({
  config,
  ingest: (message) => createCustomerServiceRuntime().repository.ingestFacebookMessage(message),
  generateDraft: (messageId, attachmentSourceContext) => createCustomerServiceRuntime().engine.generateDraft(
    {
      messageId,
      trigger: "webhook_after",
    },
    attachmentSourceContext,
  ),
  scheduleAfter: (task) => after(task),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
