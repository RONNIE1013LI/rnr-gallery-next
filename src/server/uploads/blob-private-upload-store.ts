import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { del as deleteBlob, get as getBlob, put as putBlob } from "@vercel/blob";
import {
  hasImageSignature,
  InvalidUploadError,
  type PrivateUploadValidationOptions,
  type PrivateUploadReference,
  type UploadFile,
  validatePrivateUpload,
} from "./local-private-upload-store";

type BlobClient = Readonly<{
  put: typeof putBlob;
  get: typeof getBlob;
  del: typeof deleteBlob;
}>;

const defaultClient: BlobClient = {
  put: putBlob,
  get: getBlob,
  del: deleteBlob,
};

export class BlobPrivateUploadStore {
  constructor(
    private readonly token: string,
    private readonly client: BlobClient = defaultClient,
    private readonly createId: () => string = randomUUID,
  ) {}

  async save(
    file: UploadFile,
    options: PrivateUploadValidationOptions = {},
  ): Promise<PrivateUploadReference> {
    validatePrivateUpload(file, options);

    const id = this.createId();
    const originalName = basename(file.name).replace(/[\u0000-\u001f\u007f]/g, "");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasImageSignature(bytes, file.type, options)) {
      throw new InvalidUploadError("The file contents do not match the selected file type.");
    }

    const storageKey = `private-uploads/${id}.bin`;
    await this.client.put(storageKey, bytes, {
      access: "private",
      addRandomSuffix: false,
      contentType: file.type,
      token: this.token,
    });

    return Object.freeze({
      id,
      originalName,
      mimeType: file.type,
      size: file.size,
      storageKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  async remove(reference: Pick<PrivateUploadReference, "storageKey">) {
    this.assertStorageKey(reference.storageKey);
    await this.client.del(reference.storageKey, { token: this.token });
  }

  async read(storageKey: string): Promise<Buffer> {
    this.assertStorageKey(storageKey);
    const result = await this.client.get(storageKey, {
      access: "private",
      token: this.token,
    });
    if (!result || result.statusCode !== 200) {
      throw new Error("Private upload was not found");
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  private assertStorageKey(storageKey: string) {
    if (!/^private-uploads\/[0-9a-f-]{36}\.bin$/i.test(storageKey)) {
      throw new InvalidUploadError("Invalid private upload reference");
    }
  }
}
