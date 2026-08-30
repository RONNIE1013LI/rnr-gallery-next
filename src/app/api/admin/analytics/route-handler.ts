import type { AdminPermission } from "@/server/auth/admin-permissions";
import { requireAdminPermission } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import { readWebsiteAnalyticsBusinessConfig } from "@/server/analytics/website-analytics-config";
import {
  getWebsiteAnalyticsV2Dashboard,
} from "@/server/analytics/website-analytics-v2-dashboard";
import {
  parseWebsiteAnalyticsV2Query,
  WebsiteAnalyticsV2QueryError,
  type WebsiteAnalyticsV2Query,
} from "@/server/analytics/website-analytics-v2-query";

export const runtime = "nodejs";
export const analyticsNoStoreHeaders = Object.freeze({ "Cache-Control": "no-store" });

type Dashboard = ReturnType<typeof getWebsiteAnalyticsV2Dashboard>;
type Dependencies = Readonly<{
  requirePermission: (permission: AdminPermission) => Promise<unknown>;
  enabled: () => boolean;
  load: Dashboard["load"];
  now: () => Date;
}>;

class AnalyticsReadRequestError extends Error {}
class AnalyticsDisabledError extends Error {}
class AnalyticsPrivacyError extends Error {}

const forbiddenResponseKeys = new Set([
  "customeremail",
  "customername",
  "customerphone",
  "deliveryaddress",
  "billingaddress",
  "shippingaddress",
  "messagebody",
  "messagetext",
  "artwork",
  "photo",
  "paymentproof",
  "notes",
  "internalnotes",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "consentqualifiedclickids",
  "visitorreference",
  "sessionid",
  "externalreferrerorigin",
  "term",
  "content",
  "password",
  "secret",
  "token",
  "cookie",
]);

export function assertSameOriginAnalyticsRequest(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((suppliedOrigin !== null && suppliedOrigin !== requestOrigin)
    || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new AnalyticsReadRequestError();
  }
}

export function assertAnalyticsResponsePrivacy(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAnalyticsResponsePrivacy(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenResponseKeys.has(key.toLowerCase())) throw new AnalyticsPrivacyError();
    assertAnalyticsResponsePrivacy(child);
  }
}

export function analyticsApiErrorResponse(error: unknown, genericMessage: string) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: analyticsNoStoreHeaders,
    });
  }
  if (error instanceof AnalyticsReadRequestError) {
    return Response.json({ error: "Forbidden" }, {
      status: 403,
      headers: analyticsNoStoreHeaders,
    });
  }
  if (error instanceof AnalyticsDisabledError) {
    return Response.json({ error: "Website Analytics V2 is unavailable" }, {
      status: 404,
      headers: analyticsNoStoreHeaders,
    });
  }
  if (error instanceof WebsiteAnalyticsV2QueryError) {
    return Response.json({ error: "Invalid analytics filters" }, {
      status: 422,
      headers: analyticsNoStoreHeaders,
    });
  }
  return Response.json({ error: genericMessage }, {
    status: 500,
    headers: analyticsNoStoreHeaders,
  });
}

function defaults(): Dependencies {
  return {
    requirePermission: requireAdminPermission,
    enabled: () => readWebsiteAnalyticsBusinessConfig().v2Enabled,
    load: (query, now) => getWebsiteAnalyticsV2Dashboard().load(query, now),
    now: () => new Date(),
  };
}

export function parseAdminAnalyticsRequest(request: Request, now: Date): WebsiteAnalyticsV2Query {
  return parseWebsiteAnalyticsV2Query(new URL(request.url).searchParams, { now });
}

export function createAdminAnalyticsRoute(dependencies?: Dependencies) {
  return Object.freeze({
    async GET(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        await deps.requirePermission("view_analytics");
        assertSameOriginAnalyticsRequest(request);
        if (!deps.enabled()) throw new AnalyticsDisabledError();
        const now = deps.now();
        const result = await deps.load(parseAdminAnalyticsRequest(request, now), now);
        assertAnalyticsResponsePrivacy(result);
        return Response.json(result, { headers: analyticsNoStoreHeaders });
      } catch (error) {
        return analyticsApiErrorResponse(error, "Website analytics could not be loaded");
      }
    },
  });
}

const route = createAdminAnalyticsRoute();
export const GET = route.GET;
