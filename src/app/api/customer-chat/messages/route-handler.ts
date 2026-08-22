import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { websiteChannelAdapter } from "@/server/customer-service/adapters/website";
import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import type { SafeProductContext } from "@/server/customer-service/types";
import {
  createWebsiteSessionToken,
  hashWebsiteConversationKey,
  hashWebsiteSessionToken,
  readWebsiteSessionToken,
  WEBSITE_SESSION_MAX_AGE_SECONDS,
  websiteSessionCookie,
} from "@/server/customer-service/website/session";
import {
  hashWebsiteClientMessageKey,
  parseWebsiteMessageRequest,
  serializeWebsiteSessionCookie,
} from "@/server/customer-service/website/public-api";
import {
  hashTrustedNetworkBucket,
  resolveTrustedClientIp,
} from "@/server/customer-service/website/rate-limit";

type WebsiteMessageRepository = Pick<
  CustomerServiceRepository,
  "resolveWebsiteSession" | "ingestConversationEvent"
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
  processReviewAlert?: () => Promise<unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  waitUntil?: (deadline: Date) => Promise<void>;
  now?: () => Date;
  cookieEnvironment?: CookieEnvironment;
  createSessionToken?: () => string;
  resolveTrustedIp?: (request: Request) => string;
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
        const cookieToken = readWebsiteSessionToken(request, dependencies.cookieEnvironment);
        const existingSession = cookieToken
          ? await dependencies.repository.resolveWebsiteSession({
            sessionTokenHash: hashWebsiteSessionToken(cookieToken, dependencies.sessionSecret),
            now: receivedAt,
          })
          : null;
        const sessionToken = existingSession && cookieToken
          ? cookieToken
          : (dependencies.createSessionToken ?? createWebsiteSessionToken)();
        const sessionExpiresAt = existingSession?.expiresAt
          ?? new Date(receivedAt.getTime() + WEBSITE_SESSION_MAX_AGE_SECONDS * 1_000);
        const sessionCookie = existingSession
          ? null
          : websiteSessionCookie(sessionToken, dependencies.cookieEnvironment);
        const conversationHash = hashWebsiteConversationKey(sessionToken, dependencies.sessionSecret);
        const messageHash = hashWebsiteClientMessageKey({
          conversationHash,
          clientKey: input.clientMessageKey,
          secret: dependencies.messageHashSecret,
        });
        const sessionKeyHash = hashWebsiteSessionToken(sessionToken, dependencies.sessionSecret);
        const networkKeyHash = hashTrustedNetworkBucket({
          ip: (dependencies.resolveTrustedIp ?? resolveTrustedClientIp)(request),
          secret: dependencies.messageHashSecret,
          now: receivedAt,
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
          websiteRateLimit: {
            sessionKeyHash,
            networkKeyHash,
            sessionExpiresAt,
            isNewSession: !existingSession,
          },
        });
        if (result.status === "rate_limited") return json({ error: { code: "RATE_LIMITED" } }, 429);
        if (result.status === "turn_pending") {
          dependencies.scheduleAfter(async () => {
            try {
              await (dependencies.waitUntil ?? waitUntil)(result.debounceUntil);
              await dependencies.processTurn(result.turnId);
              await dependencies.processReviewAlert?.();
            } catch {
              // The committed turn remains recoverable by the durable worker.
            }
          });
        }

        const response = json({ status: "accepted" }, 202);
        if (sessionCookie) {
          response.headers.append("Set-Cookie", serializeWebsiteSessionCookie(sessionCookie));
        }
        return response;
      } catch (error) {
        if (error instanceof MutationRequestError) return rejected(error.status);
        return json({ error: { code: "INTERNAL_ERROR" } }, 500);
      }
    },
  });
}
