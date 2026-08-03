import { isAbsolute, resolve } from "node:path";

export type GalleryConfig = Readonly<{
  storageDir: string;
  maxUploadBytes: number;
  maxImagePixels: number;
}>;

type GalleryEnvironment = Readonly<Record<string, string | undefined>>;

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseGalleryConfig(
  env: GalleryEnvironment = process.env,
): GalleryConfig {
  const rawStorageDir = env.GALLERY_STORAGE_DIR?.trim();
  if (!rawStorageDir) throw new Error("Gallery storage directory is required");
  if (!isAbsolute(rawStorageDir)) {
    throw new Error("Gallery storage directory must be absolute");
  }

  return Object.freeze({
    storageDir: resolve(rawStorageDir),
    maxUploadBytes: positiveInteger(
      env.GALLERY_MAX_UPLOAD_BYTES,
      "GALLERY_MAX_UPLOAD_BYTES",
    ),
    maxImagePixels: positiveInteger(
      env.GALLERY_MAX_IMAGE_PIXELS,
      "GALLERY_MAX_IMAGE_PIXELS",
    ),
  });
}
