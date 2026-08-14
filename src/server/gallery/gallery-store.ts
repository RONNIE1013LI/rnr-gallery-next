import { BlobGalleryStore } from "./blob-gallery-store";
import { parseGalleryConfig, parseGalleryLimits } from "./config";
import { LocalGalleryStore } from "./local-gallery-store";

export type GalleryStore = Pick<
  LocalGalleryStore,
  | "inspect"
  | "writeManaged"
  | "read"
  | "isAvailable"
  | "writeGeneration"
  | "removeGeneration"
>;

export function createGalleryStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GalleryStore {
  const blobToken = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (blobToken) {
    return new BlobGalleryStore(parseGalleryLimits(env), blobToken);
  }
  return new LocalGalleryStore(parseGalleryConfig(env));
}
