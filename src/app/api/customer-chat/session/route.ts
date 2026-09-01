import { parseAuthConfig } from "@/server/auth/config";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createCustomerServiceRuntime } from "@/server/customer-service/runtime";
import { getOptionalSession } from "@/server/auth/get-optional-session";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { createCustomerChatSessionHandler } from "./route-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = parseCustomerServiceConfig();
    if (!config.websiteEnabled) {
      return Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return createCustomerChatSessionHandler({
      enabled: config.websiteEnabled,
      trustedOrigin: parseAuthConfig().origin,
      sessionSecret: config.websiteSessionSecret,
      permitSecret: config.websiteAbuseHashSecret,
      repository: createCustomerServiceRuntime().repository,
      getOptionalSession,
      analyticsConfig: readWebsiteAnalyticsBusinessConfig(),
    }).POST(request);
  } catch {
    return Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
