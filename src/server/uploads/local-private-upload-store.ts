import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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

export type PrivateUploadReference = Readonly<{
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
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
    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      throw new InvalidUploadError("Choose a JPG, PNG, WebP, HEIC or HEIF image.");
    }
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      throw new InvalidUploadError("Each image must be between 1 byte and 25 MB.");
    }

    const id = this.createId();
    const originalName = basename(file.name).replace(/[\u0000-\u001f\u007f]/g, "");
    const reference: PrivateUploadReference = Object.freeze({
      id,
      originalName,
      mimeType: file.type,
      size: file.size,
    });

    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(join(this.rootDirectory, `${id}.bin`), Buffer.from(await file.arrayBuffer()), {
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(join(this.rootDirectory, `${id}.json`), JSON.stringify(reference), {
        flag: "wx",
        mode: 0o600,
      }),
    ]);

    return reference;
  }
}
