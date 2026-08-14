import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type UploadFile = Readonly<{
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

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function hasImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
    const accepted = new Set(mimeType === "image/heic"
      ? ["heic", "heix", "hevc", "hevx"]
      : ["mif1", "msf1", "heic", "heix", "hevc", "hevx"]);
    for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
      if (accepted.has(ascii(bytes, offset, 4))) return true;
    }
  }
  return false;
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
    if (!hasImageSignature(bytes, file.type)) {
      throw new InvalidUploadError("The image contents do not match the selected file type.");
    }
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

  async read(storageKey: string): Promise<Buffer> {
    if (!/^[0-9a-f-]{36}\.bin$/i.test(storageKey) || basename(storageKey) !== storageKey) {
      throw new InvalidUploadError("Invalid private upload reference");
    }
    return readFile(join(this.rootDirectory, storageKey));
  }
}

export function privateUploadDirectory(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configured = env.RNR_PRIVATE_UPLOAD_DIR?.trim();
  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new Error("RNR_PRIVATE_UPLOAD_DIR is required in production");
    }
    return join(process.cwd(), ".data", "private-uploads");
  }
  if (!isAbsolute(configured)) {
    throw new Error("RNR_PRIVATE_UPLOAD_DIR must be absolute");
  }
  return resolve(configured);
}
