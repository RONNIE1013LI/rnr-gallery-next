import { requireAdmin } from "@/server/auth/require-admin";
import { HttpError } from "@/server/auth/require-session";
import {
  readWebsiteAnalyticsConfig,
  type WebsiteAnalyticsConfig,
} from "@/server/analytics/website-analytics-config";
import {
  createWebsiteAnalyticsInternalDevice,
  websiteAnalyticsInternalDeviceCookieHeaders,
} from "@/server/analytics/website-analytics-cookies";
import {
  assertTrustedMutationRequest,
  MutationRequestError,
} from "@/server/http/mutation-request";

export const runtime = "nodejs";
const noStore = Object.freeze({ "Cache-Control": "no-store" });

type Dependencies = Readonly<{
  requireAdmin: () => Promise<unknown>;
  config: WebsiteAnalyticsConfig;
  environment?: string;
  trustedOrigin?: string;
  now: () => Date;
}>;

class AnalyticsInternalDeviceUnavailableError extends Error {}

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof MutationRequestError) {
    return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof AnalyticsInternalDeviceUnavailableError) {
    return Response.json({ error: "Internal-device marking is unavailable" }, {
      status: 503,
      headers: noStore,
    });
  }
  return Response.json({ error: "Internal-device setting could not be changed" }, {
    status: 500,
    headers: noStore,
  });
}

function defaults(): Dependencies {
  return {
    requireAdmin,
    config: readWebsiteAnalyticsConfig(),
    environment: process.env.VERCEL_ENV,
    now: () => new Date(),
  };
}

function response(internal: boolean, cookieValue: string, dependencies: Dependencies) {
  const headers = new Headers(noStore);
  for (const cookie of websiteAnalyticsInternalDeviceCookieHeaders(
    cookieValue,
    internal,
    dependencies.environment,
  )) headers.append("Set-Cookie", cookie);
  return Response.json({ internal }, { headers });
}

export function createAdminAnalyticsInternalDeviceRoute(dependencies?: Dependencies) {
  async function change(request: Request, internal: boolean) {
    try {
      const deps = dependencies ?? defaults();
      await deps.requireAdmin();
      assertTrustedMutationRequest(request, deps.trustedOrigin);
      if (!deps.config.enabled || !deps.config.cookieSecret) {
        throw new AnalyticsInternalDeviceUnavailableError();
      }
      const cookieValue = internal
        ? createWebsiteAnalyticsInternalDevice(deps.config.cookieSecret, deps.now())
        : "";
      return response(internal, cookieValue, deps);
    } catch (error) {
      return errorResponse(error);
    }
  }

  return Object.freeze({
    POST: (request: Request) => change(request, true),
    DELETE: (request: Request) => change(request, false),
  });
}

const route = createAdminAnalyticsInternalDeviceRoute();
export const POST = route.POST;
export const DELETE = route.DELETE;
