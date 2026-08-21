import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { websiteChannelAdapter } from "@/server/customer-service/adapters/website";
import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import type { SafeProductContext } from "@/server/customer-service/types";
import {
  ensureWebsiteSessionForPost,
  hashWebsiteConversationKey,
  readWebsiteSessionToken,
} from "@/server/customer-service/website/session";
import {
  hashWebsiteClientMessageKey,
  parseWebsiteMessageRequest,
  serializeWebsiteSessionCookie,
} from "@/server/customer-service/website/public-api";

type WebsiteMessageRepository = Pick<
  CustomerServiceRepository,
  "resolveWebsiteSession" | "ensureWebsiteSession" | "ingestConversationEvent"
>;

type CookieEnvironment = "production" | "preview" | "development" | "test" | undefined;

type Dependencies = Readonly<{
  enabled: boolean;
  trustedOrigin: string;
  sessionSecret: string;
  messageHashSecret: string;
  debounceMs: number;
  repository: WebsiteMessageRepository;
  resolveProductContext: (pathname: string) => Promise<SafeProductContext | null>;
  processTurn: (turnId: string) => Promise<unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  waitUntil?: (deadline: Date) => Promise<void>;
  now?: () => Date;
  cookieEnvironment?: CookieEnvironment;
  createSessionToken?: () => string;
}>;

const noStoreHeaders = { "Cache-Control": "no-store" };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function rejected(status: number) {
  return json({ error: { code: "REQUEST_REJECTED" } }, status);
}

function waitUntil(deadline: Date) {
  const delayMs = Math.max(0, deadline.getTime() - Date.now());
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export function createCustomerChatMessagesHandler(dependencies: Dependencies) {
  return Object.freeze({
    async POST(request: Request) {
      if (!dependencies.enabled) {
        return json({ error: { code: "SERVICE_UNAVAILABLE" } }, 503);
      }

      try {
        assertTrustedMutationRequest(request, dependencies.trustedOrigin);
        let input: ReturnType<typeof parseWebsiteMessageRequest>;
        try {
          input = parseWebsiteMessageRequest(await parseBoundedJson(request, 4 * 1024));
        } catch (error) {
          if (error instanceof MutationRequestError) throw error;
          return rejected(422);
        }
        const productContext = input.pathname
          ? await dependencies.resolveProductContext(input.pathname)
          : null;
        const receivedAt = (dependencies.now ?? (() => new Date()))();
        const existingToken = readWebsiteSessionToken(request, dependencies.cookieEnvironment);
        const ensured = await ensureWebsiteSessionForPost({
          request,
          repository: dependencies.repository,
          secret: dependencies.sessionSecret,
          now: receivedAt,
          environment: dependencies.cookieEnvironment,
          createToken: dependencies.createSessionToken,
        });
        const sessionToken = ensured.cookie?.value ?? existingToken;
        if (!sessionToken) throw new Error("website_session_token_missing");
        const conversationHash = hashWebsiteConversationKey(sessionToken, dependencies.sessionSecret);
        const messageHash = hashWebsiteClientMessageKey({
          conversationHash,
          clientKey: input.clientMessageKey,
          secret: dependencies.messageHashSecret,
        });
        const [message] = websiteChannelAdapter.normalize({
          sessionKeyHash: conversationHash,
          clientMessageKeyHash: messageHash,
          text: input.message,
          productContext,
          receivedAt,
        });
        const result = await dependencies.repository.ingestConversationEvent({
          channel: message.channel,
          role: message.role,
          eventType: message.eventType,
          externalConversationKeyHash: message.externalConversationKey,
          externalMessageKeyHash: message.externalMessageKey,
          text: message.text,
          attachments: [],
          imageJob: null,
          productContext: message.productContext ?? null,
          debounceMs: dependencies.debounceMs,
          receivedAt: message.receivedAt,
        });
        if (result.status === "turn_pending") {
          dependencies.scheduleAfter(async () => {
            try {
              await (dependencies.waitUntil ?? waitUntil)(result.debounceUntil);
              await dependencies.processTurn(result.turnId);
            } catch {
              // The committed turn remains recoverable by the durable worker.
            }
          });
        }

        const response = json({ status: "accepted" }, 202);
        if (ensured.cookie) {
          response.headers.append("Set-Cookie", serializeWebsiteSessionCookie(ensured.cookie));
        }
        return response;
      } catch (error) {
        if (error instanceof MutationRequestError) return rejected(error.status);
        return json({ error: { code: "INTERNAL_ERROR" } }, 500);
      }
    },
  });
}
