import { createHash } from "node:crypto";
import { get, list, put } from "@vercel/blob";
import { Pool } from "pg";
import { parseGalleryConfig } from "@/server/gallery/config";
import { LocalGalleryStore } from "@/server/gallery/local-gallery-store";

type GalleryRow = Readonly<{
  id: string;
  storageKey: string;
  contentHash: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function blobPath(storageKey: string): string {
  if (!/^(managed|generations)\/[a-zA-Z0-9._/-]+$/.test(storageKey)) {
    throw new Error("Invalid gallery storage key");
  }
  return `gallery/${storageKey}`;
}

async function readBlob(pathname: string, token: string): Promise<Buffer> {
  const result = await get(pathname, { access: "private", token });
  if (!result || result.statusCode !== 200) {
    throw new Error(`Blob verification failed for ${pathname}`);
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function existingBlobPaths(token: string): Promise<Set<string>> {
  const paths = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "gallery/", cursor, token });
    for (const blob of page.blobs) paths.add(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const databaseUrl = required("DATABASE_URL");
  const token = required("BLOB_READ_WRITE_TOKEN");
  const localStore = new LocalGalleryStore(parseGalleryConfig());
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await pool.query<GalleryRow>(`
      select
        id,
        storage_key as "storageKey",
        content_hash as "contentHash",
        mime_type as "mimeType",
        width,
        height
      from gallery_designs
      order by storage_key
    `);
    const existing = await existingBlobPaths(token);
    let totalBytes = 0;
    let uploaded = 0;
    let unchanged = 0;

    for (const row of result.rows) {
      const bytes = await localStore.read(row.storageKey);
      const metadata = await localStore.inspect(bytes);
      if (
        metadata.contentHash !== row.contentHash ||
        metadata.mimeType !== row.mimeType ||
        metadata.width !== row.width ||
        metadata.height !== row.height
      ) {
        throw new Error(`Local gallery metadata mismatch for ${row.id}`);
      }

      totalBytes += bytes.byteLength;
      const pathname = blobPath(row.storageKey);
      if (!execute) continue;

      if (!existing.has(pathname)) {
        await put(pathname, bytes, {
          access: "private",
          addRandomSuffix: false,
          contentType: row.mimeType,
          token,
        });
        uploaded += 1;
      } else {
        unchanged += 1;
      }

      const stored = await readBlob(pathname, token);
      const storedHash = createHash("sha256").update(stored).digest("hex");
      if (storedHash !== row.contentHash) {
        throw new Error(`Blob hash verification failed for ${row.id}`);
      }
    }

    process.stdout.write(`${JSON.stringify({
      mode: execute ? "execute" : "dry-run",
      assets: result.rowCount,
      bytes: totalBytes,
      uploaded,
      unchanged,
    })}\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`Gallery Blob migration failed: ${message}\n`);
  process.exitCode = 1;
});
