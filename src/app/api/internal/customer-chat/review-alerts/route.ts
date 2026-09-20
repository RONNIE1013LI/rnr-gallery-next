import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { parseRnrAiMetaConfig } from "@/server/rnr-ai/meta/config";
import { createProductionWebsiteReplyRuntime } from "@/server/rnr-ai/website/website-runtime";
import { createWebsiteReviewAlertCronHandler } from "./route-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

function unavailable() {
  return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
}

async function handle(request: Request) {
  const config = parseCustomerServiceConfig();
  if (!config.websiteEnabled || !parseRnrAiMetaConfig().websiteSharedBrainEnabled) return unavailable();
  return createWebsiteReviewAlertCronHandler({
    secret: config.turnRecoverySecret,
    runShared: async (deadlineAt) =>
      createProductionWebsiteReplyRuntime().recoverReviewAlerts(5, deadlineAt),
  })(request);
}

export const GET = handle;
export const POST = handle;
