export type MetaChannel = "facebook" | "instagram";

export type MetaEventAttachment = Readonly<{
  externalAttachmentKey: string;
  ordinal: number;
  kind: "image" | "unsupported";
  sourceRef: Readonly<{ kind: "facebook_remote" | "instagram_remote"; url: string }> | null;
  mimeTypeHint: string | null;
  failureCode: string | null;
}>;

export type MetaConversationEvent = Readonly<{
  channel: MetaChannel;
  role: "customer" | "staff";
  eventType: "customer_message" | "human_outbound";
  externalConversationKey: string;
  externalMessageKey: string;
  externalReplyToMessageKey: string | null;
  text: string | null;
  attachments: readonly MetaEventAttachment[];
  receivedAt: Date;
}>;

export type MetaHistoryEvent = Omit<MetaConversationEvent, "attachments"> & Readonly<{
  attachments: readonly Readonly<{ ordinal: number; kind: "image" | "unsupported" }>[];
}>;

export type MetaConversationSnapshot = Readonly<{
  channel: MetaChannel;
  events: readonly MetaHistoryEvent[];
  complete: boolean;
  incompleteReason: "provider_permission" | "provider_unavailable" | "pagination_gap" | "safety_ceiling" | null;
  characters: number;
  turnsConsidered: number;
}>;
