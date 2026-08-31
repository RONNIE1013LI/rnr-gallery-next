import { describe, expect, it, vi } from "vitest";
import {
  createCachedGalleryImageLookup,
  createGalleryImageHandler,
} from "@/server/gallery/gallery-image-handler";
import type { cachePublicData } from "@/server/cache/public-cache-tags";

const designId = "a".repeat(64);
const metadata = {
  id: designId,
  storageKey: `generations/${"b".repeat(64)}/${designId}-cccccccccccc.jpg`,
  contentHash: "c".repeat(64),
  mimeType: "image/jpeg" as const,
};

describe("gallery image route", () => {
  it("streams only active design bytes with immutable security headers", async () => {
    const handler = createGalleryImageHandler({
      findActiveImage: async (id) => id === designId ? metadata : null,
      read: async () => Buffer.from("image-bytes"),
    });

    const response = await handler(
      new Request(`http://localhost/gallery-images/${designId}?v=${metadata.contentHash}`),
      { params: Promise.resolve({ designId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("image-bytes");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("etag")).toBe(`"${metadata.contentHash}"`);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not make an unversioned or stale-version URL immutable", async () => {
    const handler = createGalleryImageHandler({
      findActiveImage: async () => metadata,
      read: async () => Buffer.from("image-bytes"),
    });
    const unversioned = await handler(
      new Request(`http://localhost/gallery-images/${designId}`),
      { params: Promise.resolve({ designId }) },
    );
    const stale = await handler(
      new Request(`http://localhost/gallery-images/${designId}?v=${"d".repeat(64)}`),
      { params: Promise.resolve({ designId }) },
    );

    expect(unversioned.headers.get("cache-control")).toContain("must-revalidate");
    expect(unversioned.headers.get("cache-control")).not.toContain("immutable");
    expect(stale.status).toBe(404);
  });

  it("reuses cached active-image metadata for repeated route requests", async () => {
    const findActiveImage = vi.fn().mockResolvedValue(metadata);
    const memoryCache = ((loader: (id: string) => Promise<unknown>) => {
      const values = new Map<string, unknown>();
      return async (id: string) => {
        if (values.has(id)) return values.get(id);
        const value = await loader(id);
        values.set(id, value);
        return value;
      };
    }) as typeof cachePublicData;
    const cachedLookup = createCachedGalleryImageLookup(findActiveImage, memoryCache);
    const handler = createGalleryImageHandler({
      findActiveImage: cachedLookup,
      read: async () => Buffer.from("image-bytes"),
    });

    await handler(new Request(`http://localhost/gallery-images/${designId}?v=${metadata.contentHash}`), {
      params: Promise.resolve({ designId }),
    });
    await handler(new Request(`http://localhost/gallery-images/${designId}?v=${metadata.contentHash}`), {
      params: Promise.resolve({ designId }),
    });

    expect(findActiveImage).toHaveBeenCalledOnce();
  });

  it("returns 304 for a matching ETag and 404 for invalid IDs", async () => {
    const handler = createGalleryImageHandler({
      findActiveImage: async (id) => id === designId ? metadata : null,
      read: async () => Buffer.from("image-bytes"),
    });
    const cached = await handler(
      new Request(`http://localhost/gallery-images/${designId}`, {
        headers: { "if-none-match": `"${metadata.contentHash}"` },
      }),
      { params: Promise.resolve({ designId }) },
    );
    const invalid = await handler(
      new Request("http://localhost/gallery-images/not-a-path"),
      { params: Promise.resolve({ designId: "../secret" }) },
    );

    expect(cached.status).toBe(304);
    expect(invalid.status).toBe(404);
  });

  it("returns a controlled 404 when the stored file cannot be read", async () => {
    const handler = createGalleryImageHandler({
      findActiveImage: async () => metadata,
      read: async () => { throw new Error("disk path details"); },
    });

    const response = await handler(
      new Request(`http://localhost/gallery-images/${designId}`),
      { params: Promise.resolve({ designId }) },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("disk path details");
  });
});
