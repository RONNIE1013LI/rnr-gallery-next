import sharp, { type Metadata } from "sharp";

import type { CustomerReviewMediaKind } from "@/domain/customer-reviews/types";
import type { ReviewActor } from "./customer-review-repository";
import {
  hasImageSignature,
  type PrivateUploadReference,
  type UploadFile,
} from "@/server/uploads/local-private-upload-store";

const MAX_REVIEW_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REVIEW_IMAGE_DIMENSION = 12_000;
const MAX_REVIEW_IMAGE_PIXELS = 50_000_000;
const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class InvalidReviewImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReviewImageError";
  }
}

export type CustomerReviewMediaRecord = Readonly<{
  id: string;
  reviewId: string;
  kind: CustomerReviewMediaKind;
  storageId: string;
  storageKey: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
}>;

export type CustomerReviewMediaRepository = Readonly<{
  replace(
    input: Omit<CustomerReviewMediaRecord, "id"> & { actor: ReviewActor },
  ): Promise<Pick<PrivateUploadReference, "id" | "storageKey"> | null>;
  findPublic(
    reviewId: string,
    kind: "AVATAR" | "FEATURED_IMAGE",
  ): Promise<Pick<CustomerReviewMediaRecord, "storageKey" | "mimeType" | "sha256"> | null>;
  findAdmin(
    reviewId: string,
    kind: CustomerReviewMediaKind,
  ): Promise<Pick<CustomerReviewMediaRecord, "storageKey" | "mimeType"> | null>;
}>;

export async function inspectReviewImage(file: UploadFile) {
  if (!acceptedMimeTypes.has(file.type)) {
    throw new InvalidReviewImageError("Choose a JPG, PNG or WebP image.");
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_REVIEW_IMAGE_BYTES) {
    throw new InvalidReviewImageError("Each review image must be between 1 byte and 25 MB.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasImageSignature(bytes, file.type)) {
    throw new InvalidReviewImageError(
      "The file contents do not match the selected file type.",
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_REVIEW_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new InvalidReviewImageError("The review image could not be read safely.");
  }
  const expectedFormat = file.type === "image/jpeg" ? "jpeg" : file.type.split("/")[1];
  if (
    metadata.format !== expectedFormat ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_REVIEW_IMAGE_DIMENSION ||
    metadata.height > MAX_REVIEW_IMAGE_DIMENSION ||
    metadata.width * metadata.height > MAX_REVIEW_IMAGE_PIXELS
  ) {
    throw new InvalidReviewImageError("The review image dimensions are invalid.");
  }
  return Object.freeze({
    mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
    width: metadata.width,
    height: metadata.height,
  });
}

type ReplaceMediaDependencies = Readonly<{
  store: Readonly<{
    save(file: UploadFile): Promise<PrivateUploadReference>;
    remove(reference: Pick<PrivateUploadReference, "id" | "storageKey">): Promise<void>;
  }>;
  repository: Pick<CustomerReviewMediaRepository, "replace">;
  onCleanupFailure?: (error: unknown) => void;
}>;

export type ReviewMediaStore = ReplaceMediaDependencies["store"];

export type PreparedCustomerReviewMedia = Readonly<{
  kind: CustomerReviewMediaKind;
  storageId: string;
  storageKey: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
}>;

type PreparedMediaPersistenceResult<T> = Readonly<{
  value: T;
  replaced: readonly Pick<PrivateUploadReference, "id" | "storageKey">[];
}>;

export async function persistReviewWithMedia<T>(input: Readonly<{
  media: readonly Readonly<{ kind: CustomerReviewMediaKind; file: UploadFile }>[];
  store: ReplaceMediaDependencies["store"];
  persist(
    prepared: readonly PreparedCustomerReviewMedia[],
  ): Promise<PreparedMediaPersistenceResult<T>>;
  onCleanupFailure?: (error: unknown) => void;
}>): Promise<T> {
  const prepared: PreparedCustomerReviewMedia[] = [];
  const savedReferences: Pick<PrivateUploadReference, "id" | "storageKey">[] = [];
  const onCleanupFailure = input.onCleanupFailure ?? (() => undefined);

  try {
    for (const media of input.media) {
      const inspected = await inspectReviewImage(media.file);
      const saved = await input.store.save(media.file);
      savedReferences.push(saved);
      prepared.push(Object.freeze({
        kind: media.kind,
        storageId: saved.id,
        storageKey: saved.storageKey,
        mimeType: inspected.mimeType,
        sizeBytes: saved.size,
        sha256: saved.sha256,
        width: inspected.width,
        height: inspected.height,
      }));
    }
    const result = await input.persist(Object.freeze(prepared));
    await Promise.all(result.replaced.map((reference) =>
      input.store.remove(reference).catch(onCleanupFailure)));
    return result.value;
  } catch (error) {
    await Promise.all(savedReferences.map((reference) =>
      input.store.remove(reference).catch(onCleanupFailure)));
    throw error;
  }
}

export async function replaceReviewMedia(
  input: Readonly<{
    reviewId: string;
    kind: CustomerReviewMediaKind;
    file: UploadFile;
    actor: ReviewActor;
  }>,
  dependencies: ReplaceMediaDependencies,
) {
  const inspected = await inspectReviewImage(input.file);
  const saved = await dependencies.store.save(input.file);
  let old: Pick<PrivateUploadReference, "id" | "storageKey"> | null;
  try {
    old = await dependencies.repository.replace({
      reviewId: input.reviewId,
      kind: input.kind,
      storageId: saved.id,
      storageKey: saved.storageKey,
      mimeType: inspected.mimeType,
      sizeBytes: saved.size,
      sha256: saved.sha256,
      width: inspected.width,
      height: inspected.height,
      actor: input.actor,
    });
  } catch (error) {
    await dependencies.store.remove(saved).catch(dependencies.onCleanupFailure ?? (() => undefined));
    throw error;
  }
  if (old) {
    await dependencies.store.remove(old).catch(dependencies.onCleanupFailure ?? (() => undefined));
  }
  return Object.freeze({
    storageId: saved.id,
    storageKey: saved.storageKey,
    ...inspected,
  });
}
