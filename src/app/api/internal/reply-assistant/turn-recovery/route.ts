import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { createProductionWebsiteReplyRuntime } from "@/server/rnr-ai/website/website-runtime";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";
import { createTurnRecoveryHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request) {
  const config = parseCustomerServiceConfig();
  const legacy = async () => (await import("@/server/customer-service/runtime")).createCustomerServiceRuntime();
  if (!config.enabled && !config.websiteEnabled) {
    return new Response(null, { status: 404 });
  }
  return createTurnRecoveryHandler({
    secret: config.turnRecoverySecret,
    runShared: async () => {
      if (config.websiteEnabled && parseRnrAiMetaConfig().websiteSharedBrainEnabled) {
        await createProductionWebsiteReplyRuntime().recoverDueTurns(1);
      }
    },
    runOnce: async () => (await legacy()).turnRecoveryRunner.runOnce(),
    runMaintenance: async () => {
      const customerService = await legacy();
      const now = new Date();
      await customerService.repository.recoverDueHumanReplies({
        now,
        groupWindowMs: config.humanReplyGroupMs,
        limit: 25,
        knowledgeVersion: compiledKnowledge.knowledgeVersion,
      });
      await customerService.repository.refreshLearningCandidates();
      await customerService.repository.refreshOpenWebsiteReviewSelectors({ now, limit: 100 });
    },
  })(request);
}

export const GET = handle;
export const POST = handle;
