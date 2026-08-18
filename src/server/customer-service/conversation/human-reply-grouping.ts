export const HUMAN_REPLY_GROUP_LIMITS = Object.freeze({
  maxMessages: 5,
  maxCharacters: 2_400,
});

export function canAppendHumanReply(input: Readonly<{
  group: Readonly<{
    conversationId: string;
    lastOutboundAt: Date;
    messageCount: number;
    characterCount: number;
    replyToExternalMessageKeyHash: string | null;
  }>;
  conversationId: string;
  receivedAt: Date;
  textLength: number;
  interveningCustomer: boolean;
  replyToExternalMessageKeyHash: string | null;
  windowMs: number;
}>) {
  const elapsed = input.receivedAt.getTime() - input.group.lastOutboundAt.getTime();
  return input.group.conversationId === input.conversationId
    && elapsed >= 0
    && elapsed <= input.windowMs
    && !input.interveningCustomer
    && input.group.replyToExternalMessageKeyHash === input.replyToExternalMessageKeyHash
    && input.group.messageCount < HUMAN_REPLY_GROUP_LIMITS.maxMessages
    && input.group.characterCount + 1 + input.textLength <= HUMAN_REPLY_GROUP_LIMITS.maxCharacters;
}
