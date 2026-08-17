import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGalleryConfig } from "./config";
import { LocalGalleryStore } from "./local-gallery-store";
import { validateGalleryStorageKey } from "./storage-key";

const onePixelPng = Buffer.from([
  "iVBORw0KGgoAAAANSUhEUgAAAA",
  "E",
  "AAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
].join(""), "base64");

const temporaryDirectories: string[] = [];

async function temporaryStore(maxUploadBytes = 1024) {
  const storageDir = await mkdtemp(join(tmpdir(), "rnr-gallery-store-"));
  temporaryDirectories.push(storageDir);
  return new LocalGalleryStore({
    storageDir,
    maxUploadBytes,
    maxImagePixels: 1_000_000,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("parseGalleryConfig", () => {
  it("requires an absolute storage directory and bounded positive limits", () => {
    expect(
      parseGalleryConfig({
        GALLERY_STORAGE_DIR: "/var/lib/rnr-gallery",
        GALLERY_MAX_UPLOAD_BYTES: "10485760",
        GALLERY_MAX_IMAGE_PIXELS: "40000000",
      }),
    ).toEqual({
      storageDir: "/var/lib/rnr-gallery",
      maxUploadBytes: 10_485_760,
      maxImagePixels: 40_000_000,
    });
    expect(() => parseGalleryConfig({})).toThrow(/storage directory is required/i);
    expect(() =>
      parseGalleryConfig({
        GALLERY_STORAGE_DIR: "relative/gallery",
        GALLERY_MAX_UPLOAD_BYTES: "1",
        GALLERY_MAX_IMAGE_PIXELS: "1",
      }),
    ).toThrow(/must be absolute/i);
  });
});

describe("validateGalleryStorageKey", () => {
  it("accepts only generated relative gallery keys", () => {
    expect(
      validateGalleryStorageKey(
        `managed/${"a".repeat(64)}-${"b".repeat(12)}.webp`,
      ),
    ).toBe(`managed/${"a".repeat(64)}-${"b".repeat(12)}.webp`);
    for (const invalid of [
      "../secret.jpg",
      "/absolute.jpg",
      "managed\\image.jpg",
      "unknown/image.jpg",
      "managed/.hidden.jpg",
    ]) {
      expect(() => validateGalleryStorageKey(invalid), invalid).toThrow(
        /invalid gallery storage key/i,
      );
    }
  });
});

describe("LocalGalleryStore", () => {
  it("fully validates a PNG and returns hand-checked metadata", async () => {
    const store = await temporaryStore();

    await expect(store.inspect(onePixelPng)).resolves.toEqual({
      contentHash:
        "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
      extension: "png",
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 68,
    });
  });

  it("rejects oversized and corrupt files before storage", async () => {
    const store = await temporaryStore(67);
    await expect(store.inspect(onePixelPng)).rejects.toThrow(/too large/i);

    const normalStore = await temporaryStore();
    await expect(
      normalStore.inspect(Buffer.from("not an image")),
    ).rejects.toThrow(/invalid image/i);
  });

  it("writes a managed image atomically and reads it by validated key", async () => {
    const store = await temporaryStore();
    const designId = "d".repeat(64);

    const stored = await store.writeManaged(designId, onePixelPng);

    expect(stored.storageKey).toBe(
      `managed/${designId}-431ced6916a2.png`,
    );
    await expect(store.read(stored.storageKey)).resolves.toEqual(onePixelPng);
    await expect(store.isAvailable(stored.storageKey)).resolves.toBe(true);
    await expect(
      store.isAvailable(`managed/${"e".repeat(64)}-${"f".repeat(12)}.png`),
    ).resolves.toBe(false);
  });
});
