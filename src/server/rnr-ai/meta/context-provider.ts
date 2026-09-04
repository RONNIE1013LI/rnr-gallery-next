import type { MetaChannel, MetaConversationSnapshot } from "./types";

export type MetaConversationLocator = Readonly<{
  channel: MetaChannel;
  externalConversationKey: string;
  pageId: string;
}>;

export interface MetaContextProvider {
  loadConversation(locator: MetaConversationLocator): Promise<MetaConversationSnapshot>;
}
