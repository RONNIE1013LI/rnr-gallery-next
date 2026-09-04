import type { RnrAiEngineMode } from "./config";
import type { MetaContextProvider } from "./context-provider";
import type { MetaConversationEvent, MetaConversationSnapshot } from "./types";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type MetaReplyCandidate = Readonly<{
  channel: "facebook";
  externalConversationKey: string;
  latestCustomerMessageKey: string;
  brainVersion: string;
  risk: "GREEN" | "YELLOW" | "RED";
  replyText: string;
}>;

export type MetaReplySenderResult = Readonly<{
  status: "disabled" | "blocked" | "duplicate_or_terminal" | "sent" | "delivery_uncertain";
}>;

export type MetaReplySender = Readonly<{
  sendEligibleReply(candidate: MetaReplyCandidate): Promise<MetaReplySenderResult>;
}>;

type SenderConfig = Readonly<{
  masterEnabled: boolean;
  engineMode: RnrAiEngineMode;
  metaAutoSendEnabled: boolean;
}>;

type TakeoverReader = Readonly<{
  read(externalConversationKey: string): Promise<{ active: boolean } | null>;
}>;

const DELIVERY_LEASE_MS = 60_000;
const SENDER_ECHO_TTL_SECONDS = 30 * 24 * 60 * 60;

function latestEvent(snapshot: MetaConversationSnapshot) {
  return [...snapshot.events].sort((left, right) => (
    left.receivedAt.getTime() - right.receivedAt.getTime()
    || left.externalMessageKey.localeCompare(right.externalMessageKey)
  )).at(-1);
}

function maskedProviderMessageId(hashExternalKey: (value: string) => string, providerMessageId: string) {
  return hashExternalKey(`meta-provider-message:${providerMessageId}`).slice(0, 12);
}

function senderEchoHash(hashExternalKey: (value: string) => string, providerMessageId: string) {
  return hashExternalKey(`meta-sender-echo:${providerMessageId}`);
}

function deliveryHash(hashExternalKey: (value: string) => string, candidate: MetaReplyCandidate) {
  const conversationHash = hashExternalKey(candidate.externalConversationKey);
  const latestMessageHash = hashExternalKey(candidate.latestCustomerMessageKey);
  return hashExternalKey(
    `meta-turn-send:${conversationHash}:${latestMessageHash}`,
  );
}

async function stillEligible(input: Readonly<{
  candidate: MetaReplyCandidate;
  controlIsOn(): Promise<boolean>;
  takeover: TakeoverReader;
  context: MetaContextProvider;
  pageId: string;
}>) {
  if (!await input.controlIsOn()) return false;
  if ((await input.takeover.read(input.candidate.externalConversationKey))?.active) return false;
  const snapshot = await input.context.loadConversation({
    channel: input.candidate.channel,
    externalConversationKey: input.candidate.externalConversationKey,
    pageId: input.pageId,
  });
  const latest = latestEvent(snapshot);
  return Boolean(
    snapshot.complete
    && latest?.role === "customer"
    && latest.externalMessageKey === input.candidate.latestCustomerMessageKey,
  );
}

export class DisabledMetaReplySender implements MetaReplySender {
  async sendEligibleReply(candidate: MetaReplyCandidate): Promise<MetaReplySenderResult> {
    void candidate;
    return Object.freeze({ status: "disabled" });
  }
}

export function createMetaSenderEchoMatcher(input: Readonly<{
  store: Pick<ReplyRuntimeStore, "hasSenderEcho">;
  hashExternalKey(value: string): string;
}>) {
  return async (event: MetaConversationEvent) => {
    if (event.role !== "staff" || event.eventType !== "human_outbound") return false;
    return input.store.hasSenderEcho(senderEchoHash(input.hashExternalKey, event.externalMessageKey));
  };
}

export function createMetaReplySender(input: Readonly<{
  config: SenderConfig;
  accessToken: string;
  pageId: string;
  store: ReplyRuntimeStore;
  context: MetaContextProvider;
  takeover: TakeoverReader;
  controlIsOn(): Promise<boolean>;
  hashExternalKey(value: string): string;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
}>): MetaReplySender {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async sendEligibleReply(candidate) {
      const config = input.config;
      if (!config.metaAutoSendEnabled) {
        return Object.freeze({ status: "blocked" });
      }
      if (
        !config.masterEnabled
        || config.engineMode !== "shared_active"
        || !input.accessToken.trim()
        || !input.pageId.trim()
        || candidate.channel !== "facebook"
        || candidate.risk !== "GREEN"
        || !candidate.replyText.trim()
      ) return Object.freeze({ status: "blocked" });
      if (!await stillEligible({ ...input, candidate })) return Object.freeze({ status: "blocked" });

      const deliveryKey = deliveryHash(input.hashExternalKey, candidate);
      const lease = await input.store.claimDelivery(deliveryKey, DELIVERY_LEASE_MS);
      if (!lease) return Object.freeze({ status: "duplicate_or_terminal" });

      const settle = (status: "sent" | "delivery_uncertain" | "blocked", providerMessageIdMasked: string | null) => (
        input.store.settleDelivery(lease, {
          status,
          providerMessageIdMasked,
          settledAt: now().toISOString(),
        })
      );

      let providerSendStarted = false;
      try {
        if (!await stillEligible({ ...input, candidate })) {
          await input.store.releaseDelivery(lease);
          return Object.freeze({ status: "blocked" });
        }
        await input.store.beginDeliverySend(lease, now().toISOString());
        providerSendStarted = true;
        const response = await fetchImpl(
          `https://graph.facebook.com/v23.0/${encodeURIComponent(input.pageId)}/messages`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${input.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              recipient: { id: candidate.externalConversationKey },
              messaging_type: "RESPONSE",
              message: { text: candidate.replyText },
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) {
          if (response.status < 500) {
            await input.store.releaseDelivery(lease);
            return Object.freeze({ status: "blocked" });
          }
          await settle("delivery_uncertain", null);
          return Object.freeze({ status: "delivery_uncertain" });
        }
        const body = await response.json() as Record<string, unknown>;
        const providerMessageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
        if (!providerMessageId) {
          await settle("delivery_uncertain", null);
          return Object.freeze({ status: "delivery_uncertain" });
        }
        await input.store.rememberSenderEcho(
          senderEchoHash(input.hashExternalKey, providerMessageId),
          SENDER_ECHO_TTL_SECONDS,
        );
        await settle("sent", maskedProviderMessageId(input.hashExternalKey, providerMessageId));
        return Object.freeze({ status: "sent" });
      } catch {
        if (providerSendStarted) {
          await settle("delivery_uncertain", null).catch(() => undefined);
          return Object.freeze({ status: "delivery_uncertain" });
        }
        await input.store.releaseDelivery(lease).catch(() => undefined);
        return Object.freeze({ status: "blocked" });
      }
    },
  });
}
