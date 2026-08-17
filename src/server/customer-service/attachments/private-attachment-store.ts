import { randomUUID } from "node:crypto";
import { del as deleteBlob, get as getBlob, put as putBlob } from "@vercel/blob";
import type { ResolvedAttachment } from "./image-validation";

type BlobClient = Readonly<{
  put: typeof putBlob;
  get: typeof getBlob;
  del: typeof deleteBlob;
}>;

export type PrivateAttachmentStore = Readonly<{
  save(attachment: ResolvedAttachment): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}>;

const defaultClient: BlobClient = {
  put: putBlob,
  get: getBlob,
  del: deleteBlob,
};

const STORAGE_KEY = /^customer-service-attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/i;

function assertStorageKey(storageKey: string) {
  if (!STORAGE_KEY.test(storageKey)) {
    throw new Error("Invalid customer service attachment key");
  }
}

export function createPrivateAttachmentStore(
  token: string,
  client: BlobClient = defaultClient,
  createId: () => string = randomUUID,
): PrivateAttachmentStore {
  const blobToken = token.trim();
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN is required");

  return Object.freeze({
    async save(attachment: ResolvedAttachment) {
      const storageKey = `customer-service-attachments/${createId()}.bin`;
      assertStorageKey(storageKey);
      await client.put(storageKey, attachment.bytes, {
        access: "private",
        addRandomSuffix: false,
        contentType: attachment.mimeType,
        token: blobToken,
      });
      return Object.freeze({ storageKey });
    },
    async read(storageKey: string) {
      assertStorageKey(storageKey);
      const result = await client.get(storageKey, {
        access: "private",
        token: blobToken,
      });
      if (!result || result.statusCode !== 200) {
        throw new Error("Customer service attachment was not found");
      }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async remove(storageKey: string) {
      assertStorageKey(storageKey);
      await client.del(storageKey, { token: blobToken });
    },
  });
}
