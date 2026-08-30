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
  "visitor",
  "visitorreference",
  "visitordigest",
  "visitorid",
  "session",
  "sessionid",
  "sessionreference",
  "externalreferrerorigin",
  "clickids",
  "term",
  "content",
  "password",
  "secret",
  "token",
  "cookie",
]);
const forbiddenClickIdKeys = new Set(["gclid", "gbraid", "wbraid", "fbclid", "fbp", "fbc"]);
const allowedAggregateIdentityKeys = new Set([
  "visitors",
  "sessions",
  "visitortrend",
  "sessionconversionrate",
]);

function canonicalResponseKey(key: string) {
  return key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function responseKeyIsForbidden(key: string, path: readonly string[]) {
  const canonical = canonicalResponseKey(key);
  if (canonical === "message" && path.at(-1) === "notices") return false;
  if (forbiddenResponseKeys.has(canonical)) return true;
  if (!allowedAggregateIdentityKeys.has(canonical)
    && (canonical.includes("visitor") || canonical.includes("session"))) {
    return true;
  }
  if (canonical.includes("email") || canonical.includes("phone")
    || canonical.includes("address") || canonical.startsWith("customer")
    || canonical.startsWith("message") || canonical.includes("clickid")) {
    return true;
  }
  return forbiddenClickIdKeys.has(canonical);
}

export function assertSameOriginAnalyticsRequest(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((suppliedOrigin !== null && suppliedOrigin !== requestOrigin)
    || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new AnalyticsReadRequestError();
  }
}

export function assertAnalyticsResponsePrivacy(value: unknown, path: readonly string[] = []): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAnalyticsResponsePrivacy(item, path);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (responseKeyIsForbidden(key, path)) throw new AnalyticsPrivacyError();
    assertAnalyticsResponsePrivacy(child, [...path, canonicalResponseKey(key)]);
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

export function assertInternalTrafficQueryAccess(
  access: unknown,
  query: WebsiteAnalyticsV2Query,
) {
  if (!query.includeInternal) return;
  const role = access && typeof access === "object"
    ? (access as Record<string, unknown>).adminRole
    : null;
  if (role !== "admin") throw new HttpError("Forbidden", 403);
}

export function createAdminAnalyticsRoute(dependencies?: Dependencies) {
  return Object.freeze({
    async GET(request: Request) {
      const deps = dependencies ?? defaults();
      try {
        const access = await deps.requirePermission("view_analytics");
        assertSameOriginAnalyticsRequest(request);
        if (!deps.enabled()) throw new AnalyticsDisabledError();
        const now = deps.now();
        const query = parseAdminAnalyticsRequest(request, now);
        assertInternalTrafficQueryAccess(access, query);
        const result = await deps.load(query, now);
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
