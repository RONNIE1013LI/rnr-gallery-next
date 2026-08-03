import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import type { GalleryConfig } from "./config";
import { validateGalleryStorageKey } from "./storage-key";

type SupportedImage = Readonly<{
  contentHash: string;
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  byteLength: number;
}>;

export type StoredGalleryImage = SupportedImage &
  Readonly<{ storageKey: string }>;

const imageFormats = {
  jpeg: { extension: "jpg", mimeType: "image/jpeg" },
  png: { extension: "png", mimeType: "image/png" },
  webp: { extension: "webp", mimeType: "image/webp" },
} as const;

export class LocalGalleryStore {
  constructor(private readonly config: GalleryConfig) {}

  async inspect(bytes: Uint8Array): Promise<SupportedImage> {
    if (bytes.byteLength < 1) throw new Error("Invalid image");
    if (bytes.byteLength > this.config.maxUploadBytes) {
      throw new Error("Gallery image is too large");
    }

    try {
      const image = sharp(bytes, {
        failOn: "error",
        limitInputPixels: this.config.maxImagePixels,
        animated: false,
      });
      const metadata = await image.metadata();
      await image.clone().raw().toBuffer();
      const format = metadata.format && imageFormats[metadata.format as keyof typeof imageFormats];
      if (!format || !metadata.width || !metadata.height) {
        throw new Error("unsupported");
      }

      return Object.freeze({
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        extension: format.extension,
        mimeType: format.mimeType,
        width: metadata.width,
        height: metadata.height,
        byteLength: bytes.byteLength,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("too large")) {
        throw error;
      }
      throw new Error("Invalid image", { cause: error });
    }
  }

  async writeManaged(
    designId: string,
    bytes: Uint8Array,
  ): Promise<StoredGalleryImage> {
    if (!/^[a-f0-9]{64}$/.test(designId)) {
      throw new Error("Invalid gallery design ID");
    }
    const metadata = await this.inspect(bytes);
    const storageKey = validateGalleryStorageKey(
      `managed/${designId}-${metadata.contentHash.slice(0, 12)}.${metadata.extension}`,
    );
    const destination = join(this.config.storageDir, storageKey);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${randomUUID()}`;
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
    return Object.freeze({ ...metadata, storageKey });
  }

  async read(storageKey: string): Promise<Buffer> {
    const safeKey = validateGalleryStorageKey(storageKey);
    return readFile(join(this.config.storageDir, safeKey));
  }
}
