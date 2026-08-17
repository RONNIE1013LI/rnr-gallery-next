import { describe, expect, it, vi } from "vitest";
import type { ResolvedAttachment } from "./image-validation";
import { createPrivateAttachmentStore } from "./private-attachment-store";

const attachment: ResolvedAttachment = Object.freeze({
  bytes: Buffer.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg",
  width: 1,
  height: 1,
  sha256: "sha256-test-value",
});

describe("createPrivateAttachmentStore", () => {
  it("requires a Blob token and has no filesystem fallback", () => {
    expect(() => createPrivateAttachmentStore("", {
      put: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    })).toThrow("BLOB_READ_WRITE_TOKEN is required");
  });

  it("stores attachments under the dedicated private Blob prefix", async () => {
    const put = vi.fn().mockResolvedValue({
      pathname: "customer-service-attachments/11111111-1111-4111-8111-111111111111.bin",
    });
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
    const store = createPrivateAttachmentStore(
      "vercel_blob_rw_test",
      { put, get, del },
      () => "11111111-1111-4111-8111-111111111111",
    );

    const storageKey = store.allocateKey();
    const signal = new AbortController().signal;
    expect(put).not.toHaveBeenCalled();
    await store.save(storageKey, attachment, signal);

    expect(storageKey).toBe("customer-service-attachments/11111111-1111-4111-8111-111111111111.bin");
    expect(put).toHaveBeenCalledWith(
      "customer-service-attachments/11111111-1111-4111-8111-111111111111.bin",
      attachment.bytes,
      {
        access: "private",
        addRandomSuffix: false,
        abortSignal: signal,
        contentType: "image/jpeg",
        token: "vercel_blob_rw_test",
      },
    );
    await expect(store.read(storageKey, signal)).resolves.toEqual(attachment.bytes);
    await store.remove(storageKey, signal);
    expect(get).toHaveBeenCalledWith(storageKey, {
      access: "private",
      abortSignal: signal,
      token: "vercel_blob_rw_test",
    });
    expect(del).toHaveBeenCalledWith(storageKey, {
      abortSignal: signal,
      token: "vercel_blob_rw_test",
    });
  });

  it.each([
    "private-uploads/11111111-1111-4111-8111-111111111111.bin",
    "customer-service-attachments/../../token",
    "customer-service-attachments/not-a-uuid.bin",
  ])("rejects storage keys outside the dedicated prefix: %s", async (storageKey) => {
    const store = createPrivateAttachmentStore("vercel_blob_rw_test", {
      put: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    });

    await expect(store.read(storageKey)).rejects.toThrow("Invalid customer service attachment key");
    await expect(store.save(storageKey, attachment)).rejects.toThrow("Invalid customer service attachment key");
    await expect(store.remove(storageKey)).rejects.toThrow("Invalid customer service attachment key");
  });
});
