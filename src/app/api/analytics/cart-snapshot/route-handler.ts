import { getAnalyticsUserId } from "@/server/analytics/website-analytics-user";
import { cartSnapshotSchema } from "@/domain/analytics/cart-snapshot";
import { ADVERTISING_CONSENT_COOKIE, parseAdvertisingConsent } from "@/domain/consent/advertising-consent";
import { readWebsiteAnalyticsConfig, type WebsiteAnalyticsConfig } from "@/server/analytics/website-analytics-config";
import {
  parseWebsiteAnalyticsVisitor, parseWebsiteAnalyticsSession,
  WEBSITE_ANALYTICS_VISITOR_COOKIE, WEBSITE_ANALYTICS_SESSION_COOKIE,
  websiteAnalyticsVisitorDigest,
} from "@/server/analytics/website-analytics-cookies";
import { recordWebsiteCartSnapshot, type CartSnapshotInput } from "@/server/analytics/website-cart-snapshots";
import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";

const noStore = { "Cache-Control": "no-store" };
const BOT_USER_AGENT = /(?:bot|crawler|spider|slurp|headless|lighthouse|monitoring|uptime|pingdom)/i;
function cookie(header: string | null, name: string): string | undefined {
  const value = header?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(name + "="));
  return value?.slice(name.length + 1);
}

type Dependencies = Readonly<{
  config?: WebsiteAnalyticsConfig;
  now?: () => Date;
  trustedOrigin?: string;
  getUserId?: (headers: Headers) => Promise<string | null>;
  record?: (input: CartSnapshotInput) => Promise<"saved" | "duplicate" | "unlinked" | "unavailable">;
}>;

export function createCartSnapshotRoute(dependencies: Dependencies = {}) {
  return async function POST(request: Request) {
    const config = dependencies.config ?? readWebsiteAnalyticsConfig();
    if (!config.enabled || !config.cookieSecret) return new Response(null, { status: 204, headers: noStore });
    try {
      assertTrustedMutationRequest(request, dependencies.trustedOrigin);
      const cookies = request.headers.get("Cookie");
      const consent = parseAdvertisingConsent(cookie(cookies, ADVERTISING_CONSENT_COOKIE));
      if (!consent?.analytics || BOT_USER_AGENT.test(request.headers.get("User-Agent") ?? "")) {
        return new Response(null, { status: 204, headers: noStore });
      }
      const now = dependencies.now?.() ?? new Date();
      const visitor = parseWebsiteAnalyticsVisitor(cookie(cookies, WEBSITE_ANALYTICS_VISITOR_COOKIE), config.cookieSecret, now);
      const session = parseWebsiteAnalyticsSession(cookie(cookies, WEBSITE_ANALYTICS_SESSION_COOKIE), config.cookieSecret, now);
      if (!visitor || !session) return new Response(null, { status: 409, headers: noStore });
      let body: unknown;
      try { body = await parseBoundedJson(request, 16_384); }
      catch (error) {
        if (error instanceof MutationRequestError) throw error;
        return Response.json({ error: "Invalid cart snapshot" }, { status: 400, headers: noStore });
      }
      const data = cartSnapshotSchema.safeParse(body);
      if (!data.success) return Response.json({ error: "Invalid cart snapshot" }, { status: 422, headers: noStore });
      const userId = await (dependencies.getUserId ?? getAnalyticsUserId)(request.headers);
      const result = await (dependencies.record ?? recordWebsiteCartSnapshot)({
        ...(userId ? { userId } : {}),
        sessionId: session.sessionId,
        visitorDigest: websiteAnalyticsVisitorDigest(visitor.visitorId, config.cookieSecret),
        snapshot: data.data,
      });
      return new Response(null, { status: result === "unlinked" ? 409 : result === "unavailable" ? 503 : 204, headers: noStore });
    } catch (error) {
      if (error instanceof MutationRequestError) {
        return Response.json({ error: error.code }, { status: error.status, headers: noStore });
      }
      // First-party analytics must not affect the shopping or checkout experience.
      return Response.json({ error: "Cart analytics unavailable" }, { status: 503, headers: noStore });
    }
  };
}
export const POST = createCartSnapshotRoute();
