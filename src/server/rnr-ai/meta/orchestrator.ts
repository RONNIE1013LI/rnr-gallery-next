import type { CompiledBusinessBrain } from "../business-brain/schema";
import { evaluateAiControl } from "../control/schedule";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import type { RnrAiDecision, RnrAiRequest, VerifiedImageInput } from "../types";
import type { MetaContextProvider } from "./context-provider";
import { MetaImageResolutionError } from "./image-resolver";
import type { MetaReviewPayload, createMetaReviewPayloadProtector } from "./review-payload-protector";
import type { MetaConversationEvent, MetaConversationSnapshot } from "./types";
import type { MetaReplySender } from "./reply-sender";

type MetaImageResolver = Readonly<{
  resolveMetaImages(event: MetaConversationEvent): Promise<readonly VerifiedImageInput[]>;
}>;

type MetaBrain = Readonly<{
  generate(request: RnrAiRequest): Promise<RnrAiDecision>;
}>;

type HumanTakeover = Readonly<{
  observeStaffEvent(event: MetaConversationEvent): Promise<void>;
  read(externalConversationKey: string): Promise<{ active: boolean } | null>;
  set(externalConversationKey: string, active: boolean, source: "staff_echo" | "admin" | "risk", changedAt?: Date): Promise<void>;
}>;

type ReviewProtector = ReturnType<typeof createMetaReviewPayloadProtector>;

export type MetaOrchestratorResult = Readonly<{
  acknowledged: true;
  status:
    | "off"
    | "stage_a_not_allowed"
    | "duplicate"
    | "human_takeover"
    | "already_answered"
    | "stale"
    | "off_before_candidate"
    | "review"
    | "delivery_candidate_disabled"
    | "delivery_sent"
    | "delivery_blocked"
    | "delivery_uncertain"
    | "failed";
  risk?: "YELLOW" | "RED";
  reviewKey?: string;
}>;

type Dependencies = Readonly<{
  store: ReplyRuntimeStore;
  context: MetaContextProvider;
  images: MetaImageResolver;
  brain: MetaBrain;
  takeover: HumanTakeover;
  reviewProtector: ReviewProtector;
  businessBrain: CompiledBusinessBrain;
  hashExternalKey(value: string): string;
  resolveMarket(snapshot: MetaConversationSnapshot): "NZ" | "AU" | "UNKNOWN";
  pageId: string;
  masterEnabled: boolean;
  stageAAllowedRecipientHash: string | null;
  sender: MetaReplySender;
  now?: () => Date;
}>;

const EVENT_LEASE_MS = 60_000;
const REVIEW_TTL_SECONDS = 172_800;

function latestEvent(snapshot: MetaConversationSnapshot) {
  return [...snapshot.events].sort((left, right) => (
    left.receivedAt.getTime() - right.receivedAt.getTime()
    || left.externalMessageKey.localeCompare(right.externalMessageKey)
  )).at(-1);
}

function requestFromSnapshot(
  dependencies: Dependencies,
  snapshot: MetaConversationSnapshot,
  images: readonly VerifiedImageInput[],
): RnrAiRequest {
  return Object.freeze({
    channel: "meta",
    market: dependencies.resolveMarket(snapshot),
    conversation: Object.freeze(snapshot.events.map((item) => Object.freeze({
      providerMessageKey: dependencies.hashExternalKey(item.externalMessageKey),
      role: item.role,
      sentAt: item.receivedAt.toISOString(),
      text: item.text ?? "",
      channel: "meta" as const,
      attachmentOrdinals: Object.freeze(item.attachments.map((attachment) => attachment.ordinal)),
    }))),
    attachments: Object.freeze([...images]),
    businessBrain: dependencies.businessBrain,
    toolContext: Object.freeze({
      conversationKeyHash: dependencies.hashExternalKey(snapshot.events[0]?.externalConversationKey ?? "missing"),
    }),
  });
}

async function controlIsOn(dependencies: Dependencies, now: Date) {
  try {
    const snapshot = await dependencies.store.readControl();
    return evaluateAiControl(snapshot, now, dependencies.masterEnabled).effectiveState === "ON";
  } catch {
    return false;
  }
}

export function createMetaReplyOrchestrator(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => new Date());

  return Object.freeze({
    async handle(event: MetaConversationEvent): Promise<MetaOrchestratorResult> {
      if (
        !dependencies.stageAAllowedRecipientHash
        || dependencies.hashExternalKey(event.externalConversationKey) !== dependencies.stageAAllowedRecipientHash
      ) return { acknowledged: true, status: "stage_a_not_allowed" };
      if (event.role === "staff") {
        try {
          await dependencies.takeover.observeStaffEvent(event);
          return { acknowledged: true, status: "human_takeover" };
        } catch {
          return { acknowledged: true, status: "failed" };
        }
      }
      if (!await controlIsOn(dependencies, now())) return { acknowledged: true, status: "off" };

      try {
        if ((await dependencies.takeover.read(event.externalConversationKey))?.active) {
          return { acknowledged: true, status: "human_takeover" };
        }
      } catch {
        return { acknowledged: true, status: "off" };
      }

      const eventKeyHash = dependencies.hashExternalKey(`${event.channel}:event:${event.externalMessageKey}`);
      let lease;
      try {
        lease = await dependencies.store.claimEvent(eventKeyHash, EVENT_LEASE_MS);
      } catch {
        return { acknowledged: true, status: "off" };
      }
      if (!lease) return { acknowledged: true, status: "duplicate" };

      const settle = async (status: "processed" | "review" | "delivery_candidate" | "failed") => {
        await dependencies.store.settleEvent(lease!, { status, settledAt: now().toISOString() });
      };
      const persistReview = async (payload: MetaReviewPayload): Promise<MetaOrchestratorResult> => {
        const reviewKey = dependencies.hashExternalKey(`review:${event.channel}:${event.externalMessageKey}`);
        try {
          const ciphertext = dependencies.reviewProtector.seal(reviewKey, payload);
          await dependencies.store.putEncryptedReview(reviewKey, ciphertext, REVIEW_TTL_SECONDS, {
            conversationKeyHash: dependencies.hashExternalKey(event.externalConversationKey),
            risk: payload.risk,
            createdAt: now().toISOString(),
          });
          await dependencies.takeover.set(event.externalConversationKey, true, "risk", now());
          await settle("review");
          return { acknowledged: true, status: "review", risk: payload.risk, reviewKey };
        } catch {
          await dependencies.takeover.set(event.externalConversationKey, true, "risk", now()).catch(() => undefined);
          await settle("failed").catch(() => undefined);
          return { acknowledged: true, status: "failed" };
        }
      };

      try {
        const locator = {
          channel: event.channel,
          externalConversationKey: event.externalConversationKey,
          pageId: dependencies.pageId,
        } as const;
        const before = await dependencies.context.loadConversation(locator);
        const latestBefore = latestEvent(before);
        if (!latestBefore || latestBefore.role === "staff") {
          await settle("processed");
          return { acknowledged: true, status: "already_answered" };
        }
        if (latestBefore.externalMessageKey !== event.externalMessageKey) {
          await settle("processed");
          return { acknowledged: true, status: "stale" };
        }

        let images: readonly VerifiedImageInput[];
        try {
          images = await dependencies.images.resolveMetaImages(event);
        } catch (error) {
          if (error instanceof MetaImageResolutionError) {
            return persistReview({ risk: "YELLOW", replyText: null, reasons: [error.code] });
          }
          throw error;
        }
        let decision = await dependencies.brain.generate(requestFromSnapshot(dependencies, before, images));
        if (!before.complete && decision.risk === "GREEN") {
          decision = Object.freeze({
            ...decision,
            risk: "YELLOW",
            reasons: Object.freeze([...decision.reasons, `meta_context_incomplete:${before.incompleteReason ?? "unknown"}`]),
            nextAction: "HUMAN_REVIEW",
          });
        }

        if (!await controlIsOn(dependencies, now())) {
          await settle("processed");
          return { acknowledged: true, status: "off_before_candidate" };
        }
        if ((await dependencies.takeover.read(event.externalConversationKey))?.active) {
          await settle("processed");
          return { acknowledged: true, status: "human_takeover" };
        }
        const after = await dependencies.context.loadConversation(locator);
        const latestAfter = latestEvent(after);
        if (!latestAfter || latestAfter.role !== "customer" || latestAfter.externalMessageKey !== event.externalMessageKey) {
          await settle("processed");
          return { acknowledged: true, status: "stale" };
        }

        if (decision.risk !== "GREEN") {
          const payload: MetaReviewPayload = {
            risk: decision.risk,
            replyText: decision.replyText,
            reasons: [...decision.reasons],
          };
          return persistReview(payload);
        }

        if (decision.nextAction !== "AUTO_REPLY_ELIGIBLE" || !decision.replyText?.trim()) {
          return persistReview({
            risk: "YELLOW",
            replyText: decision.replyText,
            reasons: [...decision.reasons, "green_decision_without_sendable_reply"],
          });
        }
        const delivery = await dependencies.sender.sendEligibleReply({
          channel: "facebook",
          externalConversationKey: event.externalConversationKey,
          latestCustomerMessageKey: event.externalMessageKey,
          brainVersion: dependencies.businessBrain.version,
          risk: decision.risk,
          replyText: decision.replyText,
        });
        await settle("delivery_candidate");
        if (delivery.status === "sent") return { acknowledged: true, status: "delivery_sent" };
        if (delivery.status === "delivery_uncertain") return { acknowledged: true, status: "delivery_uncertain" };
        if (delivery.status === "blocked") return { acknowledged: true, status: "delivery_blocked" };
        return { acknowledged: true, status: "delivery_candidate_disabled" };
      } catch {
        await settle("failed").catch(() => undefined);
        return { acknowledged: true, status: "failed" };
      }
    },
  });
}
