import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import {
  createWebsitePublicUpdatesReader,
  type WebsitePublicUpdateCursor,
  type WebsitePublicUpdateRecord,
} from "@/server/customer-service/website/public-updates";
import {
  hashWebsiteConversationKey,
  hashWebsiteSessionToken,
  readWebsiteSessionToken,
} from "@/server/customer-service/website/session";
import { resolveWebsiteAnalyticsBehavioralContext } from "@/server/analytics/website-analytics-v2-business-recorder";
import type { WebsiteAnalyticsRuntimeConfig } from "@/server/analytics/website-analytics-config";
import { resolveWebsiteInboxIdentity } from "@/server/customer-service/identity/customer-identity";

type CookieEnvironment = "production" | "preview" | "development" | "test" | undefined;

type UpdatesRepository = Pick<CustomerServiceRepository, "resolveWebsiteSession" | "listWebsitePublicUpdates">;

type Dependencies = Readonly<{
  enabled: boolean;
  sessionSecret: string;
  cursorSecret: string;
  repository: UpdatesRepository;
  getOptionalSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  analyticsConfig: WebsiteAnalyticsRuntimeConfig;
  now?: () => Date;
  cookieEnvironment?: CookieEnvironment;
}>;

const noStoreHeaders = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export function createCustomerChatUpdatesHandler(dependencies: Dependencies) {
  const reader = createWebsitePublicUpdatesReader({
    cursorSecret: dependencies.cursorSecret,
    repository: dependencies.repository as Pick<CustomerServiceRepository, "listWebsitePublicUpdates">,
  });
  return Object.freeze({
    async GET(request: Request) {
      if (!dependencies.enabled) return json({ error: { code: "SERVICE_UNAVAILABLE" } }, 503);
      const token = readWebsiteSessionToken(request, dependencies.cookieEnvironment);
      if (!token) return json({ cursor: null, hasMore: false, events: [], state: "pending" });

      try {
        const currentTime = (dependencies.now ?? (() => new Date()))();
        const conversationHash = hashWebsiteConversationKey(token, dependencies.sessionSecret);
        const analyticsContext = resolveWebsiteAnalyticsBehavioralContext(
          request.headers.get("cookie"),
          dependencies.analyticsConfig,
          currentTime,
        );
        const authenticated = await dependencies.getOptionalSession(request.headers);
        const identity = resolveWebsiteInboxIdentity({
          authenticatedCustomerId: authenticated?.user.id ?? null,
          stableVisitorDigest: analyticsContext.consentLinked
            ? analyticsContext.visitorDigest ?? null
            : null,
          technicalConversationHash: conversationHash,
          secret: dependencies.sessionSecret,
        });
        const sessionKeyHash = hashWebsiteSessionToken(token, dependencies.sessionSecret);
        const session = await dependencies.repository.resolveWebsiteSession({
          sessionTokenHash: sessionKeyHash,
          now: currentTime,
        });
        if (!session) return json({ cursor: null, hasMore: false, events: [], state: "pending" });
        if (
          session.identity.kind !== identity.kind
          || session.identity.keyHash !== identity.keyHash
        ) return json({ cursor: null, hasMore: false, events: [], state: "pending" });
        const cursor = new URL(request.url).searchParams.get("cursor");
        return json(await reader.read({
          conversationId: session.conversationId,
          sessionKeyHash,
          cursor,
          limit: 50,
        }));
      } catch (error) {
        if (error instanceof Error && error.message === "website_public_updates_cursor_invalid") {
          return json({ error: { code: "REQUEST_REJECTED" } }, 400);
        }
        return json({ error: { code: "INTERNAL_ERROR" } }, 500);
      }
    },
  });
}

export type { WebsitePublicUpdateCursor, WebsitePublicUpdateRecord };
