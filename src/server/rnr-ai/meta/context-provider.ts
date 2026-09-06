import type { MetaChannel, MetaConversationSnapshot } from "./types";

export type MetaConversationLocator = Readonly<{
  channel: MetaChannel;
  externalConversationKey: string;
  pageId: string;
  updatedAt?: string;
}>;

export interface MetaContextProvider {
  loadConversation(locator: MetaConversationLocator, options?: { maxTurns: number }): Promise<MetaConversationSnapshot>;
}
