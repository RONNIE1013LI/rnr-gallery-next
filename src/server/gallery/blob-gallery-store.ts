import { createHash } from "node:crypto";
import {
  del as deleteBlob,
  get as getBlob,
  head as headBlob,
  list as listBlobs,
  put as putBlob,
} from "@vercel/blob";
import type { GalleryLimits } from "./config";
import {
  LocalGalleryStore,
  type GenerationImage,
  type StoredGalleryImage,
} from "./local-gallery-store";
import { validateGalleryStorageKey } from "./storage-key";

type BlobClient = Readonly<{
  put: typeof putBlob;
  get: typeof getBlob;
  head: typeof headBlob;
  list: typeof listBlobs;
  del: typeof deleteBlob;
}>;

const defaultClient: BlobClient = {
  put: putBlob,
  get: getBlob,
  head: headBlob,
  list: listBlobs,
  del: deleteBlob,
};

export class BlobGalleryStore {
  private readonly inspector: LocalGalleryStore;

  constructor(
    limits: GalleryLimits,
    private readonly token: string,
    private readonly client: BlobClient = defaultClient,
  ) {
    this.inspector = new LocalGalleryStore({ storageDir: "/", ...limits });
  }

  inspect(bytes: Uint8Array) {
    return this.inspector.inspect(bytes);
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
    await this.client.put(this.pathname(storageKey), Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      contentType: metadata.mimeType,
      token: this.token,
    });
    return Object.freeze({ ...metadata, storageKey });
  }

  async read(storageKey: string): Promise<Buffer> {
    const result = await this.client.get(this.pathname(storageKey), {
      access: "private",
      token: this.token,
    });
    if (!result || result.statusCode !== 200) {
      throw new Error("Gallery image was not found");
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async isAvailable(storageKey: string): Promise<boolean> {
    try {
      const metadata = await this.client.head(this.pathname(storageKey), {
        token: this.token,
      });
      return metadata.size > 0;
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
    const keys = images.map((image) => validateGalleryStorageKey(
      `generations/${generationId}/${image.designId}-${image.metadata.contentHash.slice(0, 12)}.${image.metadata.extension}`,
    ));
    const existing = await Promise.all(keys.map((key) => this.isAvailable(key)));
    if (existing.every(Boolean)) {
      await this.verifyGeneration(images, keys);
      return Object.freeze({ storageKeys: Object.freeze(keys), created: false });
    }

    const created: string[] = [];
    try {
      for (const [index, key] of keys.entries()) {
        if (existing[index]) continue;
        await this.client.put(this.pathname(key), Buffer.from(images[index].bytes), {
          access: "private",
          addRandomSuffix: false,
          contentType: images[index].metadata.mimeType,
          token: this.token,
        });
        created.push(key);
      }
      await this.verifyGeneration(images, keys);
      return Object.freeze({ storageKeys: Object.freeze(keys), created: true });
    } catch (error) {
      if (created.length > 0) {
        await this.client.del(created.map((key) => this.pathname(key)), {
          token: this.token,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  async removeGeneration(generationId: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(generationId)) {
      throw new Error("Invalid gallery generation ID");
    }
    const prefix = `gallery/generations/${generationId}/`;
    let cursor: string | undefined;
    do {
      const page = await this.client.list({ prefix, cursor, token: this.token });
      if (page.blobs.length > 0) {
        await this.client.del(page.blobs.map((blob) => blob.pathname), {
          token: this.token,
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  private async verifyGeneration(
    images: readonly GenerationImage[],
    keys: readonly string[],
  ) {
    for (const [index, key] of keys.entries()) {
      const stored = await this.read(key);
      if (createHash("sha256").update(stored).digest("hex") !== images[index].metadata.contentHash) {
        throw new Error("Gallery generation hash verification failed");
      }
    }
  }

  private pathname(storageKey: string) {
    return `gallery/${validateGalleryStorageKey(storageKey)}`;
  }
}
