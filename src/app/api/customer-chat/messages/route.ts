import { after } from "next/server";
import { parseAuthConfig } from "@/server/auth/config";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createWebsitePublicRouteRuntime } from "@/server/rnr-ai/website/public-route-runtime";
import { createCustomerChatMessagesHandler } from "./route-handler";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const config = parseCustomerServiceConfig();
    if (!config.websiteEnabled) {
      return Response.json(
        { error: { code: "SERVICE_UNAVAILABLE" } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const customerService = await createWebsitePublicRouteRuntime();
    return createCustomerChatMessagesHandler({
      enabled: config.websiteEnabled,
      trustedOrigin: parseAuthConfig().origin,
      sessionSecret: config.websiteSessionSecret,
      messageHashSecret: config.websiteAbuseHashSecret,
      permitSecret: config.websiteAbuseHashSecret,
      debounceMs: config.conversationDebounceMs,
      generationMode: customerService.websiteGenerationMode,
      repository: customerService.repository,
      getOptionalSession: customerService.getOptionalSession,
      resolveProductContext: customerService.resolveProductContext,
      processTurn: (turnId, generationMode) => customerService.processWebsiteTurn(turnId, generationMode),
      processReviewAlert: customerService.processReviewAlert,
      processCustomerNotifications: customerService.processCustomerNotifications,
      scheduleAfter: (task) => after(task),
      analyticsConfig: readWebsiteAnalyticsBusinessConfig(),
    }).POST(request);
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
