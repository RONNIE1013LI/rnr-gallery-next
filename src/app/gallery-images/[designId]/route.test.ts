import { describe, expect, it } from "vitest";
import { createGalleryImageHandler } from "@/server/gallery/gallery-image-handler";

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
      new Request(`http://localhost/gallery-images/${designId}`),
      { params: Promise.resolve({ designId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("image-bytes");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("etag")).toBe(`"${metadata.contentHash}"`);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
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
