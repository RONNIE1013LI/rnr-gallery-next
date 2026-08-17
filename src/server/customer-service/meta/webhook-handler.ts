import { createHmac } from "node:crypto";
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
  scheduleAfter: (task: () => Promise<void>) => void;
}>) {
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
        if (message.text === null) continue;
        const result = await dependencies.ingest({
          channel: message.channel,
          externalConversationKeyHash: hashExternalId(message.externalConversationKey, dependencies.config.idHashSecret),
          externalMessageKeyHash: hashExternalId(message.externalMessageKey, dependencies.config.idHashSecret),
          text: message.text,
          receivedAt: message.receivedAt,
        });
        if (result.status === "created") {
          dependencies.scheduleAfter(async () => {
            try {
              await dependencies.generateDraft(result.messageId);
            } catch {
              // The webhook has already committed; operators can retry from the review UI.
            }
          });
        }
      }
      return new Response(null, { status: 200 });
    },
  };
}
