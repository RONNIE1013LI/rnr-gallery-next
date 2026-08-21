import { after } from "next/server";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createMetaWebhookHandlers } from "@/server/customer-service/meta/webhook-handler";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { createFacebookProfileResolver } from "@/server/customer-service/facebook-profile/profile-resolver";
import { createFacebookProfileResolutionService } from "@/server/customer-service/facebook-profile/profile-resolution-service";
import { createDrizzleCustomerServiceRepository } from "@/server/customer-service/repositories/drizzle-customer-service-repository";
import { getDatabase } from "@/server/db/client";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";

const config = parseCustomerServiceConfig();
const profileLookupToken = process.env.FACEBOOK_PROFILE_LOOKUP_TOKEN?.trim();
const profileResolutionService = profileLookupToken
  ? createFacebookProfileResolutionService({
    repository: createDrizzleCustomerServiceRepository(getDatabase()),
    resolver: createFacebookProfileResolver({ token: profileLookupToken }),
  })
  : null;
const handlers = createMetaWebhookHandlers({
  config,
  ingest: (message) => createCustomerServiceRuntime().repository.ingestConversationEvent(message),
  processTurn: (turnId) => createCustomerServiceRuntime().turnRecoveryRunner.runOnce({ turnId }),
  kickImageJob: async (jobId) => {
    const runner = createCustomerServiceRuntime().imageJobRunner;
    if (!runner) throw new Error("customer_service_image_jobs_unavailable");
    return runner.runOnce({ jobId });
  },
  recoverHumanReplies: (input) => createCustomerServiceRuntime().repository.recoverDueHumanReplies({
    ...input,
    knowledgeVersion: compiledKnowledge.knowledgeVersion,
  }),
  ...(profileResolutionService ? {
    resolveCustomerProfile: (input: Readonly<{
      rawExternalConversationKey: string;
      externalConversationKeyHash: string;
    }>) => profileResolutionService.resolveForConversation(input),
  } : {}),
  scheduleAfter: (task) => after(task),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
