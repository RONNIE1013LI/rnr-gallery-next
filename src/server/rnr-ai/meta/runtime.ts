import { createHmac } from "node:crypto";
import { createAttachmentSourceProtector } from "@/server/customer-service/attachments/attachment-source-protector";
import { createFacebookSourceReader } from "@/server/customer-service/attachments/facebook-source-reader";
import { parseCustomerServiceConfig } from "@/server/customer-service/config";
import { createRnrAiBrain } from "../brain";
import { loadBusinessBrain } from "../business-brain/loader";
import type { CompiledBusinessBrain } from "../business-brain/schema";
import { evaluateAiControl } from "../control/schedule";
import { OpenAiSolProvider } from "../providers/openai-sol";
import { RedisReplyRuntimeStore } from "../runtime-store/redis-reply-runtime-store";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import { BusinessToolRegistry } from "../tools/tool-registry";
import type { RnrAiDecision, RnrAiRequest, VerifiedImageInput } from "../types";
import { createBacklogReconciler } from "./backlog-reconciler";
import type { MetaContextProvider, MetaConversationLocator } from "./context-provider";
import { GraphMetaContextProvider } from "./graph-context-provider";
import { createHumanTakeoverService } from "./human-takeover";
import { createMetaImageResolver } from "./image-resolver";
import { createMetaReplyOrchestrator } from "./orchestrator";
import {
  DisabledMetaReplySender,
  createMetaReplySender,
  createMetaSenderEchoMatcher,
  type MetaReplySender,
} from "./reply-sender";
import { createMetaReviewPayloadProtector } from "./review-payload-protector";
import { parseRnrAiMetaConfig, type RnrAiMetaConfig } from "./config";
import type { MetaConversationEvent, MetaConversationSnapshot } from "./types";

type RuntimeDependencies = Readonly<{
  store: ReplyRuntimeStore;
  context: MetaContextProvider;
  images: Readonly<{ resolveMetaImages(event: MetaConversationEvent): Promise<readonly VerifiedImageInput[]> }>;
  brain: Readonly<{ generate(request: RnrAiRequest): Promise<RnrAiDecision> }>;
  reviewProtector: ReturnType<typeof createMetaReviewPayloadProtector>;
  businessBrain: CompiledBusinessBrain;
  hashExternalKey(value: string): string;
  resolveMarket(snapshot: MetaConversationSnapshot): "NZ" | "AU" | "UNKNOWN";
  pageId: string;
  masterEnabled: boolean;
  stageAAllowedRecipientHash: string | null;
  stageAActivatedAt: Date | null;
  sender: MetaReplySender;
  isSenderEcho(event: MetaConversationEvent): Promise<boolean>;
  listConversations(window: Readonly<{ from: string; to: string; maxConversations: 100 }>): Promise<readonly MetaConversationLocator[]>;
  now?: () => Date;
}>;

export function createMetaReplyRuntime(dependencies: RuntimeDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const takeover = createHumanTakeoverService({
    store: dependencies.store,
    hashExternalKey: dependencies.hashExternalKey,
    isSenderEcho: dependencies.isSenderEcho,
  });
  const orchestrator = createMetaReplyOrchestrator({
    ...dependencies,
    takeover,
    now,
  });
  const controlIsOn = async () => {
    try {
      const snapshot = await dependencies.store.readControl();
      return evaluateAiControl(snapshot, now(), dependencies.masterEnabled).effectiveState === "ON";
    } catch {
      return false;
    }
  };
  const backlog = createBacklogReconciler({
    store: dependencies.store,
    controlIsOn,
    listConversations: dependencies.listConversations,
    loadConversation: (locator) => dependencies.context.loadConversation(locator),
    processEvent: (event) => orchestrator.handle(event),
    hashExternalKey: dependencies.hashExternalKey,
    stageAAllowedRecipientHash: dependencies.stageAAllowedRecipientHash,
    stageAActivatedAt: dependencies.stageAActivatedAt,
    now,
  });

  return Object.freeze({ orchestrator, takeover, backlog, controlIsOn, store: dependencies.store });
}

export function selectMetaReplySender(input: Readonly<{
  config: RnrAiMetaConfig;
  createActive(): MetaReplySender;
}>): MetaReplySender {
  if (
    !input.config.masterEnabled
    || input.config.engineMode !== "shared_active"
    || !input.config.metaAutoSendEnabled
    || !input.config.stageAAllowedRecipientHash
    || !input.config.stageAActivatedAt
  ) return new DisabledMetaReplySender();
  return input.createActive();
}

export function resolveMetaConversationMarket(snapshot: MetaConversationSnapshot): "NZ" | "AU" | "UNKNOWN" {
  const text = snapshot.events.map((event) => event.text ?? "").join("\n");
  const hasNz = /\b(?:new zealand|nz|nzd)\b|NZ\$/i.test(text);
  const hasAu = /\b(?:australia|australian|au|aud)\b|A\$/i.test(text);
  if (hasNz === hasAu) return "UNKNOWN";
  return hasNz ? "NZ" : "AU";
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is unavailable`);
  return normalized;
}

export function createProductionMetaReplyRuntime(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
  const rnrConfig = parseRnrAiMetaConfig(env);
  const customerConfig = parseCustomerServiceConfig(env);
  if (!rnrConfig.masterEnabled || rnrConfig.engineMode === "legacy") {
    throw new Error("R&R AI shared runtime is disabled");
  }
  const accessToken = required(env.META_PAGE_ACCESS_TOKEN, "META_PAGE_ACCESS_TOKEN");
  const reviewEncryptionKey = required(env.RNR_AI_REVIEW_ENCRYPTION_KEY, "RNR_AI_REVIEW_ENCRYPTION_KEY");
  const attachmentEncryptionKey = required(
    env.CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY,
    "CUSTOMER_SERVICE_ATTACHMENT_SOURCE_ENCRYPTION_KEY",
  );
  const openaiApiKey = required(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  if (!customerConfig.metaPageId || !customerConfig.idHashSecret) {
    throw new Error("Meta Page identity configuration is unavailable");
  }
  if (customerConfig.metaAttachmentAllowedHosts.length === 0) {
    throw new Error("META_ATTACHMENT_ALLOWED_HOSTS is unavailable");
  }

  const store = RedisReplyRuntimeStore.fromEnvironment(env);
  const context = new GraphMetaContextProvider({ accessToken });
  const businessBrain = loadBusinessBrain();
  const hashExternalKey = (value: string) => createHmac("sha256", customerConfig.idHashSecret)
    .update(value)
    .digest("hex");
  const unavailable = async () => Object.freeze({
    status: "unavailable_review_required" as const,
    source: "live_business_tool_not_configured",
    facts: Object.freeze({}),
  });
  const brain = createRnrAiBrain({
    provider: new OpenAiSolProvider({ apiKey: openaiApiKey }),
    tools: new BusinessToolRegistry({
      businessBrain,
      shipping: { quote: unavailable },
      orderStatus: { read: unavailable },
      paymentStatus: { read: unavailable },
    }),
  });
  const images = createMetaImageResolver({
    store,
    sourceProtector: createAttachmentSourceProtector(attachmentEncryptionKey),
    sourceReader: createFacebookSourceReader({ allowedHosts: customerConfig.metaAttachmentAllowedHosts }),
    hashExternalKey,
  });
  const isSenderEcho = createMetaSenderEchoMatcher({ store, hashExternalKey });
  const senderTakeover = createHumanTakeoverService({ store, hashExternalKey, isSenderEcho });
  const controlIsOn = async () => {
    try {
      return evaluateAiControl(await store.readControl(), new Date(), rnrConfig.masterEnabled).effectiveState === "ON";
    } catch {
      return false;
    }
  };
  const sender = selectMetaReplySender({
    config: rnrConfig,
    createActive: () => createMetaReplySender({
      config: rnrConfig,
      accessToken,
      pageId: customerConfig.metaPageId,
      store,
      context,
      takeover: senderTakeover,
      controlIsOn,
      hashExternalKey,
    }),
  });

  return createMetaReplyRuntime({
    store,
    context,
    images,
    brain,
    reviewProtector: createMetaReviewPayloadProtector(reviewEncryptionKey),
    businessBrain,
    hashExternalKey,
    resolveMarket: resolveMetaConversationMarket,
    pageId: customerConfig.metaPageId,
    masterEnabled: rnrConfig.masterEnabled,
    stageAAllowedRecipientHash: rnrConfig.stageAAllowedRecipientHash,
    stageAActivatedAt: rnrConfig.stageAActivatedAt,
    sender,
    isSenderEcho,
    listConversations: (window) => context.listConversations({
      pageId: customerConfig.metaPageId,
      window,
    }),
  });
}
