import { describe, expect, it, vi } from "vitest";
import { createVercelBlobBackupSource } from "./vercel-source";

describe("Vercel Blob backup source", () => {
  it("lists every page without retaining Blob URLs and reads by private pathname", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        blobs: [{
          pathname: "gallery/managed/example.webp",
          size: 4,
          uploadedAt: new Date("2026-08-27T00:00:00.000Z"),
          etag: "etag-gallery",
          url: "https://private.example/secret",
          downloadUrl: "https://private.example/secret?download=1",
        }],
        hasMore: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        blobs: [{
          pathname: "private-uploads/11111111-1111-4111-8111-111111111111.bin",
          size: 7,
          uploadedAt: new Date("2026-08-27T00:01:00.000Z"),
          etag: "etag-private",
          url: "https://private.example/customer",
          downloadUrl: "https://private.example/customer?download=1",
        }],
        hasMore: false,
      });
    const get = vi.fn().mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from("content")); controller.close(); } }),
      blob: { contentType: "application/octet-stream", size: 7 },
    });
    const source = createVercelBlobBackupSource("vercel_blob_rw_sensitive", { list, get });

    const items = await source.list();
    expect(items).toEqual([
      {
        pathname: "gallery/managed/example.webp",
        size: 4,
        uploadedAt: "2026-08-27T00:00:00.000Z",
        etag: "etag-gallery",
      },
      {
        pathname: "private-uploads/11111111-1111-4111-8111-111111111111.bin",
        size: 7,
        uploadedAt: "2026-08-27T00:01:00.000Z",
        etag: "etag-private",
      },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/https:|secret|downloadUrl|url/);
    await expect(source.read(items[1].pathname)).resolves.toEqual({
      bytes: Buffer.from("content"),
      contentType: "application/octet-stream",
    });
    expect(get).toHaveBeenCalledWith(items[1].pathname, {
      access: "private",
      token: "vercel_blob_rw_sensitive",
    });
  });

  it("rejects missing objects and metadata changes during read", async () => {
    const list = vi.fn().mockResolvedValue({ blobs: [], hasMore: false });
    const missing = createVercelBlobBackupSource("token", { list, get: vi.fn().mockResolvedValue(null) });
    await expect(missing.read("gallery/managed/missing.webp")).rejects.toThrow(/not found/i);

    const invalid = createVercelBlobBackupSource("token", {
      list,
      get: vi.fn().mockResolvedValue({ statusCode: 304, stream: null, blob: { contentType: null, size: null } }),
    });
    await expect(invalid.read("gallery/managed/example.webp")).rejects.toThrow(/unavailable/i);
  });
});

