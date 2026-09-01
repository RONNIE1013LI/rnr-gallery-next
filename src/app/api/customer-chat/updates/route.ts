import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { createCustomerChatUpdatesHandler } from "./route-handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const config = parseCustomerServiceConfig();
    if (!config.websiteEnabled) {
      return Response.json(
        { error: { code: "SERVICE_UNAVAILABLE" } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const customerService = createCustomerServiceRuntime();
    return createCustomerChatUpdatesHandler({
      enabled: config.websiteEnabled,
      sessionSecret: config.websiteSessionSecret,
      cursorSecret: config.websiteAbuseHashSecret,
      repository: customerService.repository,
      getOptionalSession,
      analyticsConfig: readWebsiteAnalyticsBusinessConfig(),
    }).GET(request);
  } catch {
    return Response.json(
      { error: { code: "REQUEST_REJECTED" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
