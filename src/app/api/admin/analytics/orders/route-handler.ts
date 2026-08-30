import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import { getWebsiteAnalyticsV2Dashboard } from "@/server/analytics/website-analytics-v2-dashboard";
import {
  analyticsApiErrorResponse,
  analyticsNoStoreHeaders,
  assertAnalyticsResponsePrivacy,
  assertSameOriginAnalyticsRequest,
  parseAdminAnalyticsRequest,
} from "../route-handler";

export const runtime = "nodejs";

type Dashboard = ReturnType<typeof getWebsiteAnalyticsV2Dashboard>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<unknown>;
  enabled: () => boolean;
  listOrders: Dashboard["listOrders"];
  now: () => Date;
}>;

class AnalyticsOrdersDisabledError extends Error {}

function defaults(): Dependencies {
  return {
    requirePermission: requireAdminPermission,
    enabled: () => readWebsiteAnalyticsBusinessConfig().v2Enabled,
    listOrders: (query) => getWebsiteAnalyticsV2Dashboard().listOrders(query),
    now: () => new Date(),
  };
}

function disabledResponse() {
  return Response.json({ error: "Website Analytics V2 is unavailable" }, {
    status: 404,
    headers: analyticsNoStoreHeaders,
  });
}

export function createAdminAnalyticsOrdersRoute(dependencies?: Dependencies) {
  return Object.freeze({
    async GET(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        await deps.requirePermission("view_analytics");
        assertSameOriginAnalyticsRequest(request);
        if (!deps.enabled()) throw new AnalyticsOrdersDisabledError();
        const result = await deps.listOrders(parseAdminAnalyticsRequest(request, deps.now()));
        assertAnalyticsResponsePrivacy(result);
        return Response.json(result, { headers: analyticsNoStoreHeaders });
      } catch (error) {
        if (error instanceof AnalyticsOrdersDisabledError) return disabledResponse();
        return analyticsApiErrorResponse(error, "Website analytics orders could not be loaded");
      }
    },
  });
}

const route = createAdminAnalyticsOrdersRoute();
export const GET = route.GET;
