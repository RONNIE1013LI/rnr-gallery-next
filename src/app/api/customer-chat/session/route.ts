import { parseAuthConfig } from "@/server/auth/config";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createWebsitePublicRouteRuntime } from "@/server/rnr-ai/website/public-route-runtime";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { createCustomerChatSessionHandler } from "./route-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = parseCustomerServiceConfig();
    if (!config.websiteEnabled) {
      return Response.json({ error: { code: "SERVICE_UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const customerService = await createWebsitePublicRouteRuntime();
    return createCustomerChatSessionHandler({
      enabled: config.websiteEnabled,
      trustedOrigin: parseAuthConfig().origin,
      sessionSecret: config.websiteSessionSecret,
      permitSecret: config.websiteAbuseHashSecret,
      repository: customerService.repository,
      getOptionalSession: customerService.getOptionalSession,
      analyticsConfig: readWebsiteAnalyticsBusinessConfig(),
    }).POST(request);
  } catch {
    return Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
