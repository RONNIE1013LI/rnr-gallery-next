import { after } from "next/server";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createMetaWebhookHandlers } from "@/server/customer-service/meta/webhook-handler";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";

const config = parseCustomerServiceConfig();
const handlers = createMetaWebhookHandlers({
  config,
  ingest: (message) => createCustomerServiceRuntime().repository.ingestFacebookMessage(message),
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
  scheduleAfter: (task) => after(task),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
