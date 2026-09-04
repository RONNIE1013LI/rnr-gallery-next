import type { CompiledBusinessBrain } from "../business-brain/schema";
import { evaluateAiControl } from "../control/schedule";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import type { RnrAiDecision, RnrAiRequest, VerifiedImageInput } from "../types";
import { createBacklogReconciler } from "./backlog-reconciler";
import type { MetaContextProvider, MetaConversationLocator } from "./context-provider";
import { createHumanTakeoverService } from "./human-takeover";
import { createMetaReplyOrchestrator } from "./orchestrator";
import type { createMetaReviewPayloadProtector } from "./review-payload-protector";
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
  sender: Readonly<{ sendEligibleReply(candidate: unknown): Promise<unknown> }>;
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
    now,
  });

  return Object.freeze({ orchestrator, takeover, backlog, controlIsOn });
}
