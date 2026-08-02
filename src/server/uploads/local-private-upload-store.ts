import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { basename, join } from "node:path";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type UploadFile = Readonly<{
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function validatePrivateUpload(file: Pick<UploadFile, "type" | "size">) {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new InvalidUploadError("Choose a JPG, PNG, WebP, HEIC or HEIF image.");
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    throw new InvalidUploadError("Each image must be between 1 byte and 25 MB.");
  }
}

export type PrivateUploadReference = Readonly<{
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  sha256: string;
}>;

export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

export class LocalPrivateUploadStore {
  constructor(
    private readonly rootDirectory: string,
    private readonly createId: () => string = randomUUID,
  ) {}

  async save(file: UploadFile): Promise<PrivateUploadReference> {
    validatePrivateUpload(file);

    const id = this.createId();
    const originalName = basename(file.name).replace(/[\u0000-\u001f\u007f]/g, "");
    const bytes = Buffer.from(await file.arrayBuffer());
    const storageKey = `${id}.bin`;
    const reference: PrivateUploadReference = Object.freeze({
      id,
      originalName,
      mimeType: file.type,
      size: file.size,
      storageKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const bytesPath = join(this.rootDirectory, storageKey);
    const metadataPath = join(this.rootDirectory, `${id}.json`);
    let wroteBytes = false;
    let wroteMetadata = false;
    try {
      const bytesFile = await open(bytesPath, "wx", 0o600);
      wroteBytes = true;
      try {
        await bytesFile.writeFile(bytes);
      } finally {
        await bytesFile.close();
      }

      const metadataFile = await open(metadataPath, "wx", 0o600);
      wroteMetadata = true;
      try {
        await metadataFile.writeFile(JSON.stringify(reference));
      } finally {
        await metadataFile.close();
      }
    } catch (error) {
      await Promise.all([
        wroteBytes ? rm(bytesPath, { force: true }) : Promise.resolve(),
        wroteMetadata ? rm(metadataPath, { force: true }) : Promise.resolve(),
      ]);
      throw error;
    }

    return reference;
  }

  async remove(reference: Pick<PrivateUploadReference, "id" | "storageKey">) {
    await Promise.all([
      rm(join(this.rootDirectory, reference.storageKey), { force: true }),
      rm(join(this.rootDirectory, `${reference.id}.json`), { force: true }),
    ]);
  }
}
