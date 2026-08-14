import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import type { GalleryConfig } from "./config";
import { validateGalleryStorageKey } from "./storage-key";

export type SupportedImage = Readonly<{
  contentHash: string;
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  byteLength: number;
}>;

export type StoredGalleryImage = SupportedImage &
  Readonly<{ storageKey: string }>;

export type GenerationImage = Readonly<{
  designId: string;
  bytes: Uint8Array;
  metadata: SupportedImage;
}>;

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

  async isAvailable(storageKey: string): Promise<boolean> {
    const safeKey = validateGalleryStorageKey(storageKey);
    try {
      const metadata = await stat(join(this.config.storageDir, safeKey));
      return metadata.isFile() && metadata.size > 0;
    } catch {
      return false;
    }
  }

  async writeGeneration(
    generationId: string,
    images: readonly GenerationImage[],
  ): Promise<Readonly<{ storageKeys: readonly string[]; created: boolean }>> {
    if (!/^[a-f0-9]{64}$/.test(generationId)) {
      throw new Error("Invalid gallery generation ID");
    }
    const generationDirectory = join(
      this.config.storageDir,
      "generations",
      generationId,
    );
    const stagingDirectory = join(
      this.config.storageDir,
      `.staging-${randomUUID()}`,
    );
    await mkdir(this.config.storageDir, { recursive: true });
    await mkdir(stagingDirectory, { recursive: false });

    const keys = images.map((image) =>
      validateGalleryStorageKey(
        `generations/${generationId}/${image.designId}-${image.metadata.contentHash.slice(0, 12)}.${image.metadata.extension}`,
      ),
    );

    let created = true;
    try {
      await Promise.all(images.map((image, index) =>
        writeFile(
          join(stagingDirectory, keys[index].split("/").at(-1)!),
          image.bytes,
          { flag: "wx", mode: 0o600 },
        ),
      ));
      await mkdir(dirname(generationDirectory), { recursive: true });
      try {
        await rename(stagingDirectory, generationDirectory);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          !["EEXIST", "ENOTEMPTY"].includes(String(error.code))
        ) {
          throw error;
        }
        created = false;
        await rm(stagingDirectory, { recursive: true, force: true });
      }

      for (const [index, key] of keys.entries()) {
        const stored = await this.read(key);
        const storedHash = createHash("sha256").update(stored).digest("hex");
        if (storedHash !== images[index].metadata.contentHash) {
          throw new Error("Gallery generation hash verification failed");
        }
      }
      return Object.freeze({
        storageKeys: Object.freeze(keys),
        created,
      });
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async removeGeneration(generationId: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(generationId)) {
      throw new Error("Invalid gallery generation ID");
    }
    await rm(
      join(this.config.storageDir, "generations", generationId),
      { recursive: true, force: true },
    );
  }
}
