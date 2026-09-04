import type { ReplyRuntimeStore, TakeoverState } from "../runtime-store/reply-runtime-store";
import type { MetaConversationEvent } from "./types";

type HumanTakeoverDependencies = Readonly<{
  store: ReplyRuntimeStore;
  hashExternalKey(value: string): string;
  isSenderEcho(event: MetaConversationEvent): Promise<boolean>;
}>;

export function createHumanTakeoverService({ store, hashExternalKey, isSenderEcho }: HumanTakeoverDependencies) {
  const conversationHash = (externalConversationKey: string) => hashExternalKey(externalConversationKey);
  return Object.freeze({
    async observeStaffEvent(event: MetaConversationEvent) {
      if (event.role !== "staff" || event.eventType !== "human_outbound") return;
      if (await isSenderEcho(event)) return;
      await store.setTakeover({
        conversationKeyHash: conversationHash(event.externalConversationKey),
        active: true,
        source: "staff_echo",
        changedAt: event.receivedAt.toISOString(),
      });
    },

    read(externalConversationKey: string) {
      return store.readTakeover(conversationHash(externalConversationKey));
    },

    set(
      externalConversationKey: string,
      active: boolean,
      source: TakeoverState["source"],
      changedAt = new Date(),
    ) {
      return store.setTakeover({
        conversationKeyHash: conversationHash(externalConversationKey),
        active,
        source,
        changedAt: changedAt.toISOString(),
      });
    },
  });
}
