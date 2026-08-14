import { describe, expect, it, vi } from "vitest";
import { BlobGalleryStore } from "./blob-gallery-store";
import { createGalleryStore } from "./gallery-store";
import { LocalGalleryStore } from "./local-gallery-store";

const limits = {
  GALLERY_MAX_UPLOAD_BYTES: "10485760",
  GALLERY_MAX_IMAGE_PIXELS: "40000000",
};

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("createGalleryStore", () => {
  it("uses private Blob storage when a Blob token is configured", () => {
    expect(createGalleryStore({
      ...limits,
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
    })).toBeInstanceOf(BlobGalleryStore);
  });

  it("keeps local gallery storage when Blob is not configured", () => {
    expect(createGalleryStore({
      ...limits,
      GALLERY_STORAGE_DIR: "/srv/rnr/gallery",
    })).toBeInstanceOf(LocalGalleryStore);
  });
});

describe("BlobGalleryStore", () => {
  it("stores and reads managed images using private Blob paths", async () => {
    const put = vi.fn().mockResolvedValue({ pathname: "gallery/managed/example.png" });
    const get = vi.fn().mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(onePixelPng);
          controller.close();
        },
      }),
    });
    const head = vi.fn().mockResolvedValue({ size: onePixelPng.byteLength });
    const store = new BlobGalleryStore(
      { maxUploadBytes: 1024, maxImagePixels: 1_000_000 },
      "vercel_blob_rw_test",
      {
        put,
        get,
        head,
        list: vi.fn(),
        del: vi.fn(),
      },
    );

    const stored = await store.writeManaged("d".repeat(64), onePixelPng);

    expect(stored.storageKey).toBe(
      `managed/${"d".repeat(64)}-431ced6916a2.png`,
    );
    expect(put).toHaveBeenCalledWith(
      `gallery/${stored.storageKey}`,
      expect.any(Buffer),
      expect.objectContaining({ access: "private", token: "vercel_blob_rw_test" }),
    );
    await expect(store.isAvailable(stored.storageKey)).resolves.toBe(true);
    await expect(store.read(stored.storageKey)).resolves.toEqual(onePixelPng);
  });
});
