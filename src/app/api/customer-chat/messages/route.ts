import { after } from "next/server";
import { parseAuthConfig } from "@/server/auth/config";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { resolveCurrentSafeProductContext } from "@/server/customer-service/website/product-context";
import { getAllCustomerNotificationRuntime } from "@/server/notifications/customer-notification-runtime";
import { createCustomerChatMessagesHandler } from "./route-handler";
import { readWebsiteAnalyticsConfig } from "@/server/analytics/website-analytics-config";

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
      debounceMs: config.conversationDebounceMs,
      repository: customerService.repository,
      resolveProductContext: resolveCurrentSafeProductContext,
      processTurn: (turnId) => customerService.turnRecoveryRunner.runOnce({ turnId }),
      processReviewAlert: () => customerService.reviewAlertService?.deliverNext() ?? Promise.resolve({ result: "not_configured" }),
      processCustomerNotifications: () => getAllCustomerNotificationRuntime().deliverPending(20),
      scheduleAfter: (task) => after(task),
      analyticsConfig: readWebsiteAnalyticsConfig(),
    }).POST(request);
  } catch {
    return Response.json(
      { error: { code: "INTERNAL_ERROR" } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
