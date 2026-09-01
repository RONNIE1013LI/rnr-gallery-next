import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import compiledKnowledge from "@/server/customer-service/knowledge/compiled-knowledge.json";
import { createTurnRecoveryHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(request: Request) {
  const customerService = createCustomerServiceRuntime();
  if (!customerService.config.enabled && !customerService.config.websiteEnabled) {
    return new Response(null, { status: 404 });
  }
  return createTurnRecoveryHandler({
    secret: customerService.config.turnRecoverySecret,
    runOnce: () => customerService.turnRecoveryRunner.runOnce(),
    runMaintenance: async () => {
      const now = new Date();
      await customerService.repository.recoverDueHumanReplies({
        now,
        groupWindowMs: customerService.config.humanReplyGroupMs,
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
