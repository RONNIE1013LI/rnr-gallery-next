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
  stageAAllowedRecipientHash: string | null;
  stageAActivatedAt: Date | null;
}>;

type TakeoverReader = Readonly<{
  read(externalConversationKey: string): Promise<{ active: boolean } | null>;
}>;

type StillEligibleReason =
  | "eligible"
  | "missing_activation"
  | "control_off"
  | "takeover_active"
  | "snapshot_incomplete"
  | "latest_not_customer"
  | "latest_message_mismatch"
  | "pre_activation";

type StillEligibleEvaluation = Readonly<{
  eligible: boolean;
  reason: StillEligibleReason;
  stageAActivatedAt: string | null;
  controlOn: boolean | null;
  takeoverActive: boolean | null;
  snapshotComplete: boolean | null;
  snapshotIncompleteReason: MetaConversationSnapshot["incompleteReason"];
  latestRole: MetaConversationEvent["role"] | null;
  latestExternalMessageKeyHash: string | null;
  candidateLatestCustomerMessageKeyHash: string;
  latestMessageMatches: boolean | null;
  latestReceivedAt: string | null;
  activationComparison: boolean | null;
}>;

type StillEligibleLogEntry = StillEligibleEvaluation & Readonly<{
  phase: "pre_claim" | "pre_send";
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
  stageAActivatedAt: Date | null;
  hashExternalKey(value: string): string;
}>): Promise<StillEligibleEvaluation> {
  const candidateLatestCustomerMessageKeyHash = input.hashExternalKey(
    input.candidate.latestCustomerMessageKey,
  );
  const base = {
    stageAActivatedAt: input.stageAActivatedAt?.toISOString() ?? null,
    candidateLatestCustomerMessageKeyHash,
  };
  if (!input.stageAActivatedAt) {
    return {
      ...base,
      eligible: false,
      reason: "missing_activation",
      controlOn: null,
      takeoverActive: null,
      snapshotComplete: null,
      snapshotIncompleteReason: null,
      latestRole: null,
      latestExternalMessageKeyHash: null,
      latestMessageMatches: null,
      latestReceivedAt: null,
      activationComparison: null,
    };
  }
  const controlOn = await input.controlIsOn();
  if (!controlOn) {
    return {
      ...base,
      eligible: false,
      reason: "control_off",
      controlOn,
      takeoverActive: null,
      snapshotComplete: null,
      snapshotIncompleteReason: null,
      latestRole: null,
      latestExternalMessageKeyHash: null,
      latestMessageMatches: null,
      latestReceivedAt: null,
      activationComparison: null,
    };
  }
  const takeoverActive = Boolean(
    (await input.takeover.read(input.candidate.externalConversationKey))?.active,
  );
  if (takeoverActive) {
    return {
      ...base,
      eligible: false,
      reason: "takeover_active",
      controlOn,
      takeoverActive,
      snapshotComplete: null,
      snapshotIncompleteReason: null,
      latestRole: null,
      latestExternalMessageKeyHash: null,
      latestMessageMatches: null,
      latestReceivedAt: null,
      activationComparison: null,
    };
  }
  const snapshot = await input.context.loadConversation({
    channel: input.candidate.channel,
    externalConversationKey: input.candidate.externalConversationKey,
    pageId: input.pageId,
  });
  const latest = latestEvent(snapshot);
  const details = {
    ...base,
    controlOn,
    takeoverActive,
    snapshotComplete: snapshot.complete,
    snapshotIncompleteReason: snapshot.incompleteReason,
    latestRole: latest?.role ?? null,
    latestExternalMessageKeyHash: latest
      ? input.hashExternalKey(latest.externalMessageKey)
      : null,
    latestMessageMatches: latest
      ? latest.externalMessageKey === input.candidate.latestCustomerMessageKey
      : null,
    latestReceivedAt: latest?.receivedAt.toISOString() ?? null,
  };
  if (!snapshot.complete) {
    return { ...details, eligible: false, reason: "snapshot_incomplete", activationComparison: null };
  }
  if (latest?.role !== "customer") {
    return { ...details, eligible: false, reason: "latest_not_customer", activationComparison: null };
  }
  if (latest.externalMessageKey !== input.candidate.latestCustomerMessageKey) {
    return { ...details, eligible: false, reason: "latest_message_mismatch", activationComparison: null };
  }
  const activationComparison = latest.receivedAt.getTime() >= input.stageAActivatedAt.getTime();
  if (!activationComparison) {
    return { ...details, eligible: false, reason: "pre_activation", activationComparison };
  }
  return { ...details, eligible: true, reason: "eligible", activationComparison };
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
  logEligibilityEvaluation?(entry: StillEligibleLogEntry): void;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
}>): MetaReplySender {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const logEligibilityEvaluation = input.logEligibilityEvaluation ?? ((entry: StillEligibleLogEntry) => {
    console.info("rnr_ai_meta_still_eligible", entry);
  });
  const safelyLogEligibilityEvaluation = (entry: StillEligibleLogEntry) => {
    try {
      logEligibilityEvaluation(entry);
    } catch {
      // Diagnostics must never alter sender eligibility or delivery behavior.
    }
  };

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
        || !config.stageAAllowedRecipientHash
        || input.hashExternalKey(candidate.externalConversationKey) !== config.stageAAllowedRecipientHash
        || candidate.channel !== "facebook"
        || candidate.risk !== "GREEN"
        || !candidate.replyText.trim()
      ) return Object.freeze({ status: "blocked" });
      const preClaimEligibility = await stillEligible({
        ...input,
        candidate,
        stageAActivatedAt: config.stageAActivatedAt,
      });
      safelyLogEligibilityEvaluation({ phase: "pre_claim", ...preClaimEligibility });
      if (!preClaimEligibility.eligible) {
        return Object.freeze({ status: "blocked" });
      }

      if (input.hashExternalKey(candidate.externalConversationKey) !== config.stageAAllowedRecipientHash) {
        return Object.freeze({ status: "blocked" });
      }

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
        const preSendEligibility = await stillEligible({
          ...input,
          candidate,
          stageAActivatedAt: config.stageAActivatedAt,
        });
        safelyLogEligibilityEvaluation({ phase: "pre_send", ...preSendEligibility });
        if (!preSendEligibility.eligible) {
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
