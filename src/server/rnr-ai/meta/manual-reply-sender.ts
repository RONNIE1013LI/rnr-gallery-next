import type { SafeInboxItem } from "@/server/customer-service/repositories/customer-service-repository";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import type { MetaConversationLocator, MetaContextProvider } from "./context-provider";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ManualFacebookReplyInput = Readonly<{
  inboxId: string;
  attemptId: string;
  text: string;
  idempotencyKey: string;
  actorUserId: string;
}>;

export type ManualFacebookReplyTarget = Readonly<{
  identityKeyHash: string;
  latestCustomerMessageKeyHash: string;
}>;

export type ManualFacebookReplyResult =
  | Readonly<{ status: "sent"; duplicate: boolean; item: SafeInboxItem }>
  | Readonly<{ status: "failed" | "delivery_uncertain" | "unavailable" }>;

const DELIVERY_LEASE_MS = 300_000;
const SENDER_ECHO_TTL_SECONDS = 30 * 24 * 60 * 60;

function latestEvent(snapshot: Awaited<ReturnType<MetaContextProvider["loadConversation"]>>) {
  return [...snapshot.events].sort((left, right) => (
    left.receivedAt.getTime() - right.receivedAt.getTime()
    || left.externalMessageKey.localeCompare(right.externalMessageKey)
  )).at(-1);
}

function senderEchoHash(hashExternalKey: (value: string) => string, providerMessageId: string) {
  return hashExternalKey(`meta-sender-echo:${providerMessageId}`);
}

function deliveryHash(
  hashExternalKey: (value: string) => string,
  target: ManualFacebookReplyTarget,
) {
  return hashExternalKey([
    "meta-turn-send",
    target.identityKeyHash,
    target.latestCustomerMessageKeyHash,
  ].join(":"));
}

export function createManualFacebookReplySender(dependencies: Readonly<{
  accessToken: string;
  pageId: string;
  store: ReplyRuntimeStore;
  resolveTarget(input: Readonly<{ inboxId: string; attemptId: string }>): Promise<ManualFacebookReplyTarget | null>;
  listConversations(window: Readonly<{ from: string; to: string; maxConversations: 100 }>): Promise<readonly MetaConversationLocator[]>;
  loadConversation: MetaContextProvider["loadConversation"];
  recordSent(input: Readonly<{
    inboxId: string;
    target: ManualFacebookReplyTarget;
    providerMessageId: string;
    text: string;
    attemptId: string;
    actorUserId: string;
    idempotencyKey: string;
    now: Date;
  }>): Promise<SafeInboxItem>;
  loadItem(inboxId: string): Promise<SafeInboxItem | null>;
  hashExternalKey(value: string): string;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
}>) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    async send(input: ManualFacebookReplyInput): Promise<ManualFacebookReplyResult> {
      const text = input.text.trim();
      if (!dependencies.accessToken.trim() || !dependencies.pageId.trim()) return { status: "unavailable" };
      if (!text || Array.from(text).length > 2_000) return { status: "unavailable" };
      const target = await dependencies.resolveTarget({ inboxId: input.inboxId, attemptId: input.attemptId });
      if (!target) return { status: "unavailable" };

      const deliveryKey = deliveryHash(dependencies.hashExternalKey, target);
      const existing = await dependencies.store.readDelivery(deliveryKey);
      if (existing?.result?.status === "sent") {
        const existingItem = await dependencies.loadItem(input.inboxId);
        return existingItem ? { status: "sent", duplicate: true, item: existingItem } : { status: "unavailable" };
      }
      if (existing?.result?.status === "delivery_uncertain" || existing?.providerSendStartedAt) return { status: "delivery_uncertain" };
      if (existing?.result?.status === "blocked") return { status: "failed" };

      const at = now();
      const locators = await dependencies.listConversations({
        from: new Date(at.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
        to: at.toISOString(),
        maxConversations: 100,
      });
      const matches = locators.filter((locator) => (
        locator.channel === "facebook"
        && locator.pageId === dependencies.pageId
        && dependencies.hashExternalKey(locator.externalConversationKey) === target.identityKeyHash
      ));
      if (matches.length !== 1) return { status: "unavailable" };
      const locator = matches[0]!;
      const snapshot = await dependencies.loadConversation(locator);
      const latest = latestEvent(snapshot);
      if (
        !snapshot.complete
        || latest?.role !== "customer"
        || dependencies.hashExternalKey(latest.externalMessageKey) !== target.latestCustomerMessageKeyHash
      ) return { status: "unavailable" };

      const lease = await dependencies.store.claimDelivery(deliveryKey, DELIVERY_LEASE_MS);
      if (!lease) {
        const result = await dependencies.store.readDelivery(deliveryKey);
        if (result?.result?.status === "sent") {
          const existingItem = await dependencies.loadItem(input.inboxId);
          return existingItem ? { status: "sent", duplicate: true, item: existingItem } : { status: "unavailable" };
        }
        return result?.result?.status === "blocked" ? { status: "failed" } : { status: "delivery_uncertain" };
      }
      const settle = (status: "sent" | "delivery_uncertain" | "blocked", providerMessageIdMasked: string | null) => (
        dependencies.store.settleDelivery(lease, { status, providerMessageIdMasked, settledAt: now().toISOString() })
      );

      let providerSendStarted = false;
      try {
        await dependencies.store.setTakeover({
          conversationKeyHash: target.identityKeyHash,
          active: true,
          source: "admin",
          changedAt: at.toISOString(),
        });
        const finalSnapshot = await dependencies.loadConversation(locator);
        const finalLatest = latestEvent(finalSnapshot);
        if (
          !finalSnapshot.complete
          || finalLatest?.role !== "customer"
          || dependencies.hashExternalKey(finalLatest.externalMessageKey) !== target.latestCustomerMessageKeyHash
        ) {
          await dependencies.store.releaseDelivery(lease);
          return { status: "unavailable" };
        }

        await dependencies.store.beginDeliverySend(lease, now().toISOString());
        providerSendStarted = true;
        const response = await fetchImpl(
          `https://graph.facebook.com/v23.0/${encodeURIComponent(dependencies.pageId)}/messages`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${dependencies.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              recipient: { id: locator.externalConversationKey },
              messaging_type: "RESPONSE",
              message: { text },
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) {
          if (response.status < 500) {
            await dependencies.store.releaseDelivery(lease);
            return { status: "failed" };
          }
          await settle("delivery_uncertain", null);
          return { status: "delivery_uncertain" };
        }
        const body = await response.json() as Record<string, unknown>;
        const providerMessageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
        if (!providerMessageId) {
          await settle("delivery_uncertain", null);
          return { status: "delivery_uncertain" };
        }
        await dependencies.store.rememberSenderEcho(
          senderEchoHash(dependencies.hashExternalKey, providerMessageId),
          SENDER_ECHO_TTL_SECONDS,
        );
        const sentItem = await dependencies.recordSent({
          inboxId: input.inboxId,
          target,
          providerMessageId,
          text,
          attemptId: input.attemptId,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          now: at,
        });
        await settle("sent", dependencies.hashExternalKey(`meta-provider-message:${providerMessageId}`).slice(0, 12));
        return { status: "sent", duplicate: false, item: sentItem };
      } catch {
        if (providerSendStarted) {
          await settle("delivery_uncertain", null).catch(() => undefined);
          return { status: "delivery_uncertain" };
        }
        await dependencies.store.releaseDelivery(lease).catch(() => undefined);
        return { status: "unavailable" };
      }
    },
  });
}
