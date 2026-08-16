import { describe, expect, it, vi } from "vitest";
import { BlobPrivateUploadStore } from "./blob-private-upload-store";
import { LocalPrivateUploadStore } from "./local-private-upload-store";
import { createPrivateUploadStore } from "./private-upload-store";

describe("createPrivateUploadStore", () => {
  it("uses private Blob storage when a Blob token is configured", () => {
    const store = createPrivateUploadStore({
      NODE_ENV: "production",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
    });

    expect(store).toBeInstanceOf(BlobPrivateUploadStore);
  });

  it("keeps local filesystem storage when Blob is not configured", () => {
    const store = createPrivateUploadStore({
      NODE_ENV: "production",
      RNR_PRIVATE_UPLOAD_DIR: "/srv/rnr/private-uploads",
    });

    expect(store).toBeInstanceOf(LocalPrivateUploadStore);
  });
});

describe("BlobPrivateUploadStore", () => {
  it("stores validated images in private Blob storage and can read and remove them", async () => {
    const put = vi.fn().mockResolvedValue({ pathname: "private-uploads/upload-id.bin" });
    const get = vi.fn().mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
          controller.close();
        },
      }),
    });
    const del = vi.fn().mockResolvedValue(undefined);
    const store = new BlobPrivateUploadStore(
      "vercel_blob_rw_test",
      { put, get, del },
      () => "11111111-1111-4111-8111-111111111111",
    );
    const file = new File(
      [new Uint8Array([0xff, 0xd8, 0xff])],
      "portrait.jpg",
      { type: "image/jpeg" },
    );

    const reference = await store.save(file);

    expect(reference.storageKey).toBe(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
    );
    expect(put).toHaveBeenCalledWith(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      expect.any(Buffer),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        contentType: "image/jpeg",
        token: "vercel_blob_rw_test",
      }),
    );
    await expect(store.read(reference.storageKey)).resolves.toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );
    await store.remove(reference);
    expect(get).toHaveBeenCalledWith(reference.storageKey, {
      access: "private",
      token: "vercel_blob_rw_test",
    });
    expect(del).toHaveBeenCalledWith(reference.storageKey, {
      token: "vercel_blob_rw_test",
    });
  });

  it("stores a PDF in private Blob storage only when explicitly allowed", async () => {
    const put = vi.fn().mockResolvedValue({ pathname: "private-uploads/upload-id.bin" });
    const store = new BlobPrivateUploadStore(
      "vercel_blob_rw_test",
      { put, get: vi.fn(), del: vi.fn() },
      () => "11111111-1111-4111-8111-111111111111",
    );
    const pdf = new File(
      [new TextEncoder().encode("%PDF-1.7\n")],
      "bank-receipt.pdf",
      { type: "application/pdf" },
    );

    await expect(store.save(pdf)).rejects.toThrow(
      "Choose a JPG, PNG, WebP, HEIC or HEIF image.",
    );
    expect(put).not.toHaveBeenCalled();

    await expect(store.save(pdf, { allowPdf: true })).resolves.toMatchObject({
      originalName: "bank-receipt.pdf",
      mimeType: "application/pdf",
    });
    expect(put).toHaveBeenCalledWith(
      "private-uploads/11111111-1111-4111-8111-111111111111.bin",
      expect.any(Buffer),
      expect.objectContaining({
        access: "private",
        contentType: "application/pdf",
        token: "vercel_blob_rw_test",
      }),
    );
  });
});
