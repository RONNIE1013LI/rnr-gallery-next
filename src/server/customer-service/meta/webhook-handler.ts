import { createHmac, randomUUID } from "node:crypto";
import { createFacebookChannelAdapter } from "../adapters/facebook";
import type {
  CustomerServiceRepository,
  HashedConversationEvent,
} from "../repositories/customer-service-repository";
import { verifyMetaSignature } from "./signature";

type IngestResult = Awaited<ReturnType<CustomerServiceRepository["ingestConversationEvent"]>>;
type SealResult = Awaited<ReturnType<CustomerServiceRepository["sealDueCustomerTurn"]>>;

type WebhookConfig = Readonly<{
  enabled: boolean;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaPageId: string;
  idHashSecret: string;
  imageAnalysisEnabled: boolean;
  attachmentSourceEncryptionKey: string;
  conversationDebounceMs?: number;
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
  ingest: (message: HashedConversationEvent) => Promise<IngestResult>;
  sealTurn: (input: Readonly<{ turnId: string; now: Date }>) => Promise<SealResult>;
  waitUntil?: (deadline: Date) => Promise<void>;
  generateDraft: (messageId: string) => Promise<unknown>;
  kickImageJob: (jobId: string) => Promise<unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  createJobId?: () => string;
  now?: () => Date;
}>) {
  const createJobId = dependencies.createJobId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  const waitUntil = dependencies.waitUntil ?? (async (deadline: Date) => {
    const delayMs = Math.max(0, deadline.getTime() - Date.now());
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  });
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
        let imageJob: HashedConversationEvent["imageJob"] = null;
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
          role: message.role,
          externalConversationKeyHash: hashExternalId(message.externalConversationKey, dependencies.config.idHashSecret),
          externalMessageKeyHash: hashExternalId(message.externalMessageKey, dependencies.config.idHashSecret),
          text: message.text,
          attachments,
          imageJob,
          debounceMs: dependencies.config.conversationDebounceMs ?? 2_000,
          receivedAt: message.receivedAt,
        });
        if (result.status === "turn_pending" && !imageJob) {
          dependencies.scheduleAfter(async () => {
            try {
              await waitUntil(result.debounceUntil);
              const sealed = await dependencies.sealTurn({ turnId: result.turnId, now: now() });
              if (sealed.status === "sealed") {
                await dependencies.generateDraft(sealed.messageId);
              }
            } catch {
              // The webhook has already committed; a later retry can seal the durable turn.
            }
          });
        }
      }
      return new Response(null, { status: 200 });
    },
  };
}
