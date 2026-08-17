export type AttachmentSourceRef =
  | Readonly<{ kind: "facebook_remote"; url: string }>
  | Readonly<{ kind: "website_private_upload"; storageKey: string }>;

export type NormalizedAttachment = Readonly<{
  externalAttachmentKey: string;
  ordinal: number;
  kind: "image";
  sourceRef: AttachmentSourceRef;
  mimeTypeHint: string | null;
}>;
