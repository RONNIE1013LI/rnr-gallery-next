import { createHmac, randomUUID } from "node:crypto";
import { createFacebookChannelAdapter } from "../adapters/facebook";
import type { NormalizedIncomingMessage } from "../types";
import type {
  CustomerServiceRepository,
  HashedConversationEvent,
} from "../repositories/customer-service-repository";
import { sanitizeHumanOutboundText } from "../conversation/human-outbound-sanitizer";
import { verifyMetaSignature } from "./signature";

type IngestResult = Awaited<ReturnType<CustomerServiceRepository["ingestConversationEvent"]>>;

const META_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

async function readWebhookBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > META_WEBHOOK_MAX_BODY_BYTES) return null;
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > META_WEBHOOK_MAX_BODY_BYTES) {
        await reader.cancel("Payload too large").catch(() => undefined);
        return null;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

type WebhookConfig = Readonly<{
  enabled: boolean;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaPageId: string;
  idHashSecret: string;
  imageAnalysisEnabled: boolean;
  attachmentSourceEncryptionKey: string;
  conversationDebounceMs?: number;
  humanReplyGroupMs?: number;
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
  waitUntil?: (deadline: Date) => Promise<void>;
  processTurn: (turnId: string) => Promise<unknown>;
  kickImageJob: (jobId: string) => Promise<unknown>;
  recoverHumanReplies?: (input: Readonly<{ now: Date; groupWindowMs: number; limit: number }>) => Promise<unknown>;
  scheduleAfter: (task: () => Promise<void>) => void;
  onAcceptedEvent?: (message: NormalizedIncomingMessage, execution: Readonly<{ invocationStartedAtMs: number }>) => Promise<unknown>;
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
      const invocationStartedAtMs = now().getTime();
      if (!dependencies.config.enabled) return new Response("Disabled", { status: 503 });
      const rawBody = await readWebhookBody(request);
      if (rawBody === null) return new Response("Payload Too Large", { status: 413 });
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
      let sawCustomerEvent = false;
      for (const message of adapter.normalize(payload)) {
        if (dependencies.onAcceptedEvent) {
          dependencies.scheduleAfter(async () => {
            try {
              await dependencies.onAcceptedEvent!(message, { invocationStartedAtMs });
            } catch {
              // The verified webhook is already acknowledged; the protected worker may retry durable work.
            }
          });
          continue;
        }
        if (message.role === "customer") sawCustomerEvent = true;
        const outbound = message.role === "staff" && message.text !== null
          ? sanitizeHumanOutboundText(message.text)
          : null;
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
          channel: "facebook",
          role: message.role,
          eventType: message.eventType,
          externalConversationKeyHash: hashExternalId(message.externalConversationKey, dependencies.config.idHashSecret),
          externalMessageKeyHash: hashExternalId(message.externalMessageKey, dependencies.config.idHashSecret),
          text: outbound?.text ?? message.text,
          bodyHash: outbound?.bodyHash ?? null,
          redactionCodes: outbound?.redactionCodes ?? [],
          replyToExternalMessageKeyHash: message.externalReplyToMessageKey
            ? hashExternalId(message.externalReplyToMessageKey, dependencies.config.idHashSecret)
            : null,
          learningEligible: outbound?.learningEligible ?? false,
          humanReplyGroupMs: dependencies.config.humanReplyGroupMs ?? 90_000,
          attachments,
          imageJob,
          debounceMs: dependencies.config.conversationDebounceMs ?? 2_000,
          receivedAt: message.receivedAt,
        });
        if (result.status === "turn_pending" && !imageJob) {
          dependencies.scheduleAfter(async () => {
            try {
              await waitUntil(result.debounceUntil);
              await dependencies.processTurn(result.turnId);
            } catch {
              // The webhook has already committed; a later retry can seal the durable turn.
            }
          });
        }
      }
      if (sawCustomerEvent && dependencies.recoverHumanReplies) {
        dependencies.scheduleAfter(async () => {
          try {
            await dependencies.recoverHumanReplies!({
              now: now(),
              groupWindowMs: dependencies.config.humanReplyGroupMs ?? 90_000,
              limit: 25,
            });
          } catch {
            // A later webhook or protected page load retries durable pending groups.
          }
        });
      }
      return new Response(null, { status: 200 });
    },
  };
}
