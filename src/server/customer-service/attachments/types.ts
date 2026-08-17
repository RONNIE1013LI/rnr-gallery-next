export type AttachmentSourceRef =
  | Readonly<{ kind: "facebook_remote"; url: string }>
  | Readonly<{ kind: "website_private_upload"; storageKey: string }>;

type NormalizedImageAttachment = Readonly<{
  externalAttachmentKey: string;
  ordinal: number;
  kind: "image";
  sourceRef: AttachmentSourceRef;
  mimeTypeHint: string | null;
  failureCode?: null;
}>;

type NormalizedUnsupportedAttachment = Readonly<{
  externalAttachmentKey: string;
  ordinal: number;
  kind: "unsupported";
  sourceRef: null;
  mimeTypeHint: null;
  failureCode: "unsupported_attachment" | "invalid_image_source" | "malformed_attachment" | "too_many_attachments";
}>;

export type NormalizedAttachment = NormalizedImageAttachment | NormalizedUnsupportedAttachment;
