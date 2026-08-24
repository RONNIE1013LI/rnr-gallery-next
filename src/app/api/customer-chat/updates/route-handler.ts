import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import {
  createWebsitePublicUpdatesReader,
  type WebsitePublicUpdateCursor,
  type WebsitePublicUpdateRecord,
} from "@/server/customer-service/website/public-updates";
import {
  hashWebsiteSessionToken,
  readWebsiteSessionToken,
} from "@/server/customer-service/website/session";

type CookieEnvironment = "production" | "preview" | "development" | "test" | undefined;

type UpdatesRepository = Pick<CustomerServiceRepository, "resolveWebsiteSession" | "listWebsitePublicUpdates">;

type Dependencies = Readonly<{
  enabled: boolean;
  sessionSecret: string;
  cursorSecret: string;
  repository: UpdatesRepository;
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
        const sessionKeyHash = hashWebsiteSessionToken(token, dependencies.sessionSecret);
        const session = await dependencies.repository.resolveWebsiteSession({
          sessionTokenHash: sessionKeyHash,
          now: (dependencies.now ?? (() => new Date()))(),
        });
        if (!session) return json({ cursor: null, hasMore: false, events: [], state: "pending" });
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
