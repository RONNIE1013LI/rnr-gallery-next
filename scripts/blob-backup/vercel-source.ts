import { get as getBlob, list as listBlobs } from "@vercel/blob";
import type { BackupSource } from "./backup-engine";

type BlobClient = Readonly<{
  list: typeof listBlobs;
  get: typeof getBlob;
}>;

const defaultClient: BlobClient = { list: listBlobs, get: getBlob };

export function createVercelBlobBackupSource(
  token: string,
  client: BlobClient = defaultClient,
): BackupSource {
  if (!token.trim()) throw new Error("Vercel Blob read-write token is required");
  return Object.freeze({
    async list() {
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await client.list({ token, cursor });
        for (const blob of page.blobs) {
          items.push(Object.freeze({
            pathname: blob.pathname,
            size: blob.size,
            uploadedAt: blob.uploadedAt.toISOString(),
            etag: blob.etag,
          }));
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return Object.freeze(items);
    },

    async read(pathname) {
      const result = await client.get(pathname, { access: "private", token });
      if (!result) throw new Error("Production Blob object was not found");
      if (result.statusCode !== 200 || !result.stream || !result.blob.contentType) {
        throw new Error("Production Blob object contents are unavailable");
      }
      return Object.freeze({
        bytes: Buffer.from(await new Response(result.stream).arrayBuffer()),
        contentType: result.blob.contentType,
      });
    },
  });
}

