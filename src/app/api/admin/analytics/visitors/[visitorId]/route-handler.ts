import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { getWebsiteAnalyticsExplorer } from "@/server/analytics/website-analytics-explorer";
import { WebsiteAnalyticsV2QueryError } from "@/server/analytics/website-analytics-v2-query";
import { analyticsApiErrorResponse, analyticsNoStoreHeaders, assertInternalTrafficQueryAccess, assertSameOriginAnalyticsRequest, parseAdminAnalyticsRequest } from "../../route-handler";
import { assertExplorerResponsePrivacy } from "../../sessions/route-handler";

type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<unknown>; enabled: () => boolean;
  visitorDetail: ReturnType<typeof getWebsiteAnalyticsExplorer>["visitorDetail"]; now: () => Date;
}>;
function defaults(): Dependencies {
  return { requirePermission: requireAdminPermission, enabled: () => readWebsiteAnalyticsBusinessConfig().v2Enabled,
    visitorDetail: (id, query, now) => getWebsiteAnalyticsExplorer().visitorDetail(id, query, now), now: () => new Date() };
}
export function createAdminAnalyticsVisitorRoute(dependencies?: Dependencies) {
  return { async GET(request: Request, context: { params: Promise<{ visitorId: string }> }) {
    const deps = dependencies ?? defaults();
    try {
      const access = await deps.requirePermission("view_analytics");
      assertSameOriginAnalyticsRequest(request);
      if (!deps.enabled()) return Response.json({ error: "Website Analytics V2 is unavailable" }, { status: 404, headers: analyticsNoStoreHeaders });
      const { visitorId } = await context.params;
      if (!/^[a-f0-9]{64}$/.test(visitorId)) throw new WebsiteAnalyticsV2QueryError();
      const now = deps.now(); const query = parseAdminAnalyticsRequest(request, now);
      assertInternalTrafficQueryAccess(access, query);
      const result = await deps.visitorDetail(visitorId, query, now);
      assertExplorerResponsePrivacy(result, true);
      return Response.json(result, { headers: analyticsNoStoreHeaders });
    } catch (error) { return analyticsApiErrorResponse(error, "Website analytics visitor could not be loaded"); }
  } };
}
export const GET = createAdminAnalyticsVisitorRoute().GET;
