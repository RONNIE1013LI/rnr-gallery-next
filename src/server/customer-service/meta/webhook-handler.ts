import { createHmac, randomUUID } from "node:crypto";
import { createFacebookChannelAdapter } from "../adapters/facebook";
import type { HashedIncomingMessage } from "../repositories/customer-service-repository";
import { verifyMetaSignature } from "./signature";

type IngestResult =
  | Readonly<{ status: "created"; messageId: string; pilotSequence: number }>
  | Readonly<{ status: "duplicate"; messageId: string }>
  | Readonly<{ status: "pilot_complete"; messageId: string }>;

type WebhookConfig = Readonly<{
  enabled: boolean;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaPageId: string;
  idHashSecret: string;
  imageAnalysisEnabled: boolean;
  attachmentSourceEncryptionKey: string;
}>;

function pageIds(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => (
    entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
      ? (entry as { id: string }).id
      : ""
  ));
}

function hashExternalId(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createMetaWebhookHandlers(dependencies: Readonly<{
  config: WebhookConfig;
  ingest: (message: HashedIncomingMessage) => Promise<IngestResult>;
  generateDraft: (messageId: string) => Promise<unknown>;
  kickImageJob: (jobId: string) => Promise<unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  createJobId?: () => string;
  now?: () => Date;
}>) {
  const createJobId = dependencies.createJobId ?? randomUUID;
  return {
    async GET(request: Request) {
      if (!dependencies.config.enabled) return new Response("Disabled", { status: 503 });
      const url = new URL(request.url);
      if (
        url.searchParams.get("hub.mode") !== "subscribe"
        || url.searchParams.get("hub.verify_token") !== dependencies.config.metaVerifyToken
      ) return new Response("Forbidden", { status: 403 });
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    },

    async POST(request: Request) {
      if (!dependencies.config.enabled) return new Response("Disabled", { status: 503 });
      const rawBody = new Uint8Array(await request.arrayBuffer());
      if (!verifyMetaSignature({
        rawBody,
        signatureHeader: request.headers.get("x-hub-signature-256"),
        appSecret: dependencies.config.metaAppSecret,
      })) return new Response("Unauthorized", { status: 401 });

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const ids = pageIds(payload);
      if (ids.some((id) => id !== dependencies.config.metaPageId)) {
        return new Response("Wrong Page", { status: 403 });
      }

      const adapter = createFacebookChannelAdapter();
      for (const message of adapter.normalize(payload)) {
        const attachments = message.attachments.map((attachment) => ({
          externalAttachmentKeyHash: hashExternalId(attachment.externalAttachmentKey, dependencies.config.idHashSecret),
          ordinal: attachment.ordinal,
          kind: attachment.kind,
          mimeTypeHint: attachment.mimeTypeHint,
          failureCode: attachment.failureCode ?? null,
        }));
        const jobId = message.attachments.length ? createJobId() : null;
        let imageJob: HashedIncomingMessage["imageJob"] = null;
        if (jobId) {
          const unsupported = message.attachments.some((attachment) => (
            attachment.kind === "unsupported" || attachment.sourceRef.kind !== "facebook_remote"
          ));
          const failureCode = message.text === null
            ? "image_only_without_text"
            : unsupported
              ? "unsupported_attachment"
              : "image_manual_review_required";
          imageJob = {
            id: jobId,
            status: "human_review_required",
            sourceCiphertext: null,
            sourceExpiresAt: null,
            failureCode,
          };
        }
        const result = await dependencies.ingest({
          channel: message.channel,
          externalConversationKeyHash: hashExternalId(message.externalConversationKey, dependencies.config.idHashSecret),
          externalMessageKeyHash: hashExternalId(message.externalMessageKey, dependencies.config.idHashSecret),
          text: message.text,
          attachments,
          imageJob,
          receivedAt: message.receivedAt,
        });
        if (result.status === "created") {
          if (imageJob?.status === "pending") {
            dependencies.scheduleAfter(async () => {
              try {
                await dependencies.kickImageJob(imageJob.id);
              } catch {
                // The durable runner will recover the committed job.
              }
            });
          } else if (!imageJob) {
            dependencies.scheduleAfter(async () => {
              try {
                await dependencies.generateDraft(result.messageId);
              } catch {
                // The webhook has already committed; operators can retry from the review UI.
              }
            });
          }
        }
      }
      return new Response(null, { status: 200 });
    },
  };
}
