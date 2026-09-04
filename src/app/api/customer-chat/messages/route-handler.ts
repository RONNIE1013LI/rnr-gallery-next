import { assertTrustedMutationRequest, MutationRequestError, parseBoundedJson } from "@/server/http/mutation-request";
import { websiteChannelAdapter } from "@/server/customer-service/adapters/website";
import type { CustomerServiceRepository } from "@/server/customer-service/repositories/customer-service-repository";
import type { SafeProductContext } from "@/server/customer-service/types";
import {
  hashWebsiteConversationKey,
  hashWebsiteSessionToken,
  readWebsiteSessionToken,
  validateWebsiteSessionPermit,
} from "@/server/customer-service/website/session";
import {
  hashWebsiteClientMessageKey,
  parseWebsiteMessageRequest,
} from "@/server/customer-service/website/public-api";
import { websitePublicMessageKey } from "@/server/customer-service/website/public-updates";
import {
  hashTrustedNetworkBucket,
  resolveTrustedClientIp,
} from "@/server/customer-service/website/rate-limit";
import {
  resolveWebsiteAnalyticsBehavioralContext,
} from "@/server/analytics/website-analytics-v2-business-recorder";
import type { WebsiteAnalyticsRuntimeConfig } from "@/server/analytics/website-analytics-config";
import { resolveWebsiteInboxIdentity } from "@/server/customer-service/identity/customer-identity";

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
  permitSecret?: string;
  debounceMs: number;
  generationMode?: "legacy" | "shared_brain";
  repository: WebsiteMessageRepository;
  getOptionalSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  resolveProductContext: (pathname: string) => Promise<SafeProductContext | null>;
  processTurn: (turnId: string, generationMode: "legacy" | "shared_brain") => Promise<unknown>;
  processReviewAlert?: () => Promise<unknown>;
  processCustomerNotifications?: () => Promise<unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  waitUntil?: (deadline: Date) => Promise<void>;
  now?: () => Date;
  cookieEnvironment?: CookieEnvironment;
  resolveTrustedIp?: (request: Request) => string;
  analyticsConfig?: WebsiteAnalyticsRuntimeConfig;
}>;

const noStoreHeaders = { "Cache-Control": "no-store" };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function rejected(status: number) {
  return json({ error: { code: "REQUEST_REJECTED" } }, status);
}

function sessionRequired() {
  return json({ error: { code: "SESSION_REQUIRED" } }, 409);
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
        const pageMarket = productContext?.market ?? input.pageMarket;
        const receivedAt = (dependencies.now ?? (() => new Date()))();
        const cookieToken = readWebsiteSessionToken(request, dependencies.cookieEnvironment);
        if (!cookieToken) return sessionRequired();
        const conversationHash = hashWebsiteConversationKey(cookieToken, dependencies.sessionSecret);
        const analyticsContext = resolveWebsiteAnalyticsBehavioralContext(
          request.headers.get("cookie"),
          dependencies.analyticsConfig ?? {
            enabled: false,
            v2Enabled: false,
            cookieSecret: null,
            attributionLookbackDays: 90,
          },
          receivedAt,
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
        const existingSession = cookieToken
          ? await dependencies.repository.resolveWebsiteSession({
            sessionTokenHash: hashWebsiteSessionToken(cookieToken, dependencies.sessionSecret),
            now: receivedAt,
          })
          : null;
        if (existingSession && (
          existingSession.identity.kind !== identity.kind
          || existingSession.identity.keyHash !== identity.keyHash
        )) return sessionRequired();
        const permit = existingSession ? null : validateWebsiteSessionPermit({
          permit: request.headers.get("X-RNR-Customer-Chat-Permit"),
          token: cookieToken,
          clientMessageKey: input.clientMessageKey,
          now: receivedAt,
          sessionSecret: dependencies.sessionSecret,
          permitSecret: dependencies.permitSecret ?? dependencies.messageHashSecret,
          identity,
        });
        if (!existingSession && !permit) return sessionRequired();
        const sessionToken = cookieToken;
        const sessionExpiresAt = existingSession?.expiresAt ?? permit?.sessionExpiresAt;
        if (!sessionExpiresAt) return sessionRequired();
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
          channel: "website",
          role: "customer",
          eventType: "customer_message",
          externalConversationKeyHash: message.externalConversationKey,
          externalMessageKeyHash: message.externalMessageKey,
          text: message.text,
          attachments: [],
          imageJob: null,
          productContext: message.productContext ?? null,
          websitePageMarket: pageMarket,
          debounceMs: dependencies.debounceMs,
          receivedAt: message.receivedAt,
          identity,
          websiteRateLimit: {
            sessionKeyHash,
            networkKeyHash,
            sessionExpiresAt,
            isNewSession: !existingSession,
          },
          websiteAnalyticsContext: analyticsContext,
        });
        if (result.status === "rate_limited") return json({ error: { code: "RATE_LIMITED" } }, 429);
        if (result.status === "turn_pending") {
          dependencies.scheduleAfter(async () => {
            try {
              await (dependencies.waitUntil ?? waitUntil)(result.debounceUntil);
              await dependencies.processTurn(result.turnId, dependencies.generationMode ?? "legacy");
            } catch {
              // The committed turn remains recoverable by the durable worker.
              return;
            }
            try {
              await dependencies.processReviewAlert?.();
            } catch {
              // The durable review alert remains available to recovery.
            }
            try {
              await dependencies.processCustomerNotifications?.();
            } catch {
              // The durable notification outbox remains available to recovery.
            }
          });
        }

        const response = json({
          status: "accepted",
          messageKey: websitePublicMessageKey({
            secret: dependencies.messageHashSecret,
            sessionKeyHash,
            messageKeyHash: messageHash,
          }),
        }, 202);
        return response;
      } catch (error) {
        if (error instanceof MutationRequestError) return rejected(error.status);
        return json({ error: { code: "INTERNAL_ERROR" } }, 500);
      }
    },
  });
}
