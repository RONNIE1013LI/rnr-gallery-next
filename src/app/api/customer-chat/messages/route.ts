import { after } from "next/server";
import { parseAuthConfig } from "@/server/auth/config";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { resolveCurrentSafeProductContext } from "@/server/customer-service/website/product-context";
import { getAllCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";
import { createCustomerChatMessagesHandler } from "./route-handler";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { getOptionalSession } from "@/server/auth/get-optional-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = parseCustomerServiceConfig();
    if (!config.websiteEnabled) {
      return Response.json(
        { error: { code: "SERVICE_UNAVAILABLE" } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const customerService = createCustomerServiceRuntime();
    return createCustomerChatMessagesHandler({
      enabled: config.websiteEnabled,
      trustedOrigin: parseAuthConfig().origin,
      sessionSecret: config.websiteSessionSecret,
      messageHashSecret: config.websiteAbuseHashSecret,
      permitSecret: config.websiteAbuseHashSecret,
      debounceMs: config.conversationDebounceMs,
      generationMode: customerService.websiteGenerationMode,
      repository: customerService.repository,
      getOptionalSession,
      resolveProductContext: resolveCurrentSafeProductContext,
      processTurn: (turnId, generationMode) => customerService.processWebsiteTurn(turnId, generationMode),
      processReviewAlert: () => customerService.reviewAlertService?.deliverNext() ?? Promise.resolve({ result: "not_configured" }),
      processCustomerNotifications: () => getAllCustomerNotificationRuntime().deliverPending(20),
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
