import { IMAGE_LIMITS } from "@/server/customer-service/attachments/limits";
import type { AttachmentSourceReader } from "@/server/customer-service/attachments/image-validation";
import type { createAttachmentSourceProtector } from "@/server/customer-service/attachments/attachment-source-protector";
import type { VerifiedImageInput } from "../types";
import type { ReplyRuntimeStore } from "../runtime-store/reply-runtime-store";
import type { MetaConversationEvent } from "./types";

const SOURCE_TTL_SECONDS = IMAGE_LIMITS.sourceRefRetentionMs / 1_000;

type AttachmentSourceProtector = ReturnType<typeof createAttachmentSourceProtector>;

type MetaImageResolverDependencies = Readonly<{
  store: ReplyRuntimeStore;
  sourceProtector: AttachmentSourceProtector;
  sourceReader: AttachmentSourceReader;
  hashExternalKey(value: string): string;
  now?: () => Date;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
}>;

export class MetaImageResolutionError extends Error {
  readonly code = "image_review_required" as const;

  constructor() {
    super("image_review_required");
    this.name = "MetaImageResolutionError";
  }
}

function reviewRequired(): never {
  throw new MetaImageResolutionError();
}

export function createMetaImageResolver({
  store,
  sourceProtector,
  sourceReader,
  hashExternalKey,
  now = () => new Date(),
  timeoutSignal = (milliseconds) => AbortSignal.timeout(milliseconds),
}: MetaImageResolverDependencies) {
  return Object.freeze({
    async resolveMetaImages(event: MetaConversationEvent): Promise<readonly VerifiedImageInput[]> {
      if (event.attachments.length === 0) return Object.freeze([]);
      if (
        event.channel !== "facebook"
        || sourceReader.channel !== "facebook"
        || event.attachments.length > IMAGE_LIMITS.maxCount
        || event.attachments.some((attachment) => (
          attachment.kind !== "image"
          || attachment.failureCode !== null
          || attachment.sourceRef?.kind !== "facebook_remote"
        ))
      ) reviewRequired();

      const keyHash = hashExternalKey(`${event.channel}:${event.externalMessageKey}:image-sources`);
      const jobId = keyHash;
      const expiresAt = new Date(now().getTime() + IMAGE_LIMITS.sourceRefRetentionMs);

      try {
        const ciphertext = sourceProtector.seal({
          jobId,
          expiresAt,
          sources: event.attachments.map((attachment) => ({
            ordinal: attachment.ordinal,
            externalAttachmentKeyHash: hashExternalKey(attachment.externalAttachmentKey),
            sourceRef: {
              kind: "facebook_remote" as const,
              url: attachment.sourceRef!.url,
            },
          })),
        });
        await store.putEphemeralSecret(keyHash, ciphertext, SOURCE_TTL_SECONDS);

        const storedCiphertext = await store.readEphemeralSecret(keyHash);
        if (!storedCiphertext) reviewRequired();
        const sources = sourceProtector.open({ jobId, ciphertext: storedCiphertext, expiresAt });
        const batchSignal = timeoutSignal(IMAGE_LIMITS.batchTimeoutMs);
        const images: VerifiedImageInput[] = [];
        let batchBytes = 0;

        for (const source of sources) {
          const perImageSignal = timeoutSignal(IMAGE_LIMITS.perImageTimeoutMs);
          const signal = typeof AbortSignal.any === "function"
            ? AbortSignal.any([batchSignal, perImageSignal])
            : batchSignal;
          const image = await sourceReader.read(source.sourceRef, signal);
          batchBytes += image.bytes.byteLength;
          if (batchBytes > IMAGE_LIMITS.maxBatchBytes) reviewRequired();
          images.push(Object.freeze({
            ordinal: source.ordinal,
            mediaType: image.mimeType,
            bytes: image.bytes,
            sha256: image.sha256,
            width: image.width,
            height: image.height,
          }));
        }

        return Object.freeze(images);
      } catch (error) {
        if (error instanceof MetaImageResolutionError) throw error;
        reviewRequired();
      } finally {
        await store.deleteEphemeralSecret(keyHash).catch(() => undefined);
      }
    },
  });
}
