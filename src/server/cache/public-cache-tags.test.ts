import { beforeEach, describe, expect, it, vi } from "vitest";

const nextCache = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((loader: (...args: unknown[]) => Promise<unknown>) => {
    const values = new Map<string, unknown>();
    return async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (values.has(key)) return values.get(key);
      const value = await loader(...args);
      values.set(key, value);
      return value;
    };
  }),
}));

vi.mock("next/cache", () => nextCache);

import {
  PUBLIC_CACHE_INVALIDATION,
  PUBLIC_CACHE_TAGS,
  cachePublicData,
  revalidatePublicCache,
} from "./public-cache-tags";

describe("public data cache boundaries", () => {
  beforeEach(() => {
    nextCache.revalidateTag.mockClear();
    nextCache.unstable_cache.mockClear();
  });

  it("reuses a tagged public read for the same arguments", async () => {
    const loader = vi.fn(async (key: string) => ({ key }));
    const cached = cachePublicData(loader, "test-public-data", [PUBLIC_CACHE_TAGS.content]);

    await expect(cached("home")).resolves.toEqual({ key: "home" });
    await expect(cached("home")).resolves.toEqual({ key: "home" });
    await expect(cached("footer")).resolves.toEqual({ key: "footer" });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(nextCache.unstable_cache).toHaveBeenCalledWith(
      loader,
      ["rnr-public:test-public-data"],
      { tags: [PUBLIC_CACHE_TAGS.content], revalidate: false },
    );
  });

  it("invalidates every requested public tag immediately", () => {
    revalidatePublicCache([PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap]);

    expect(nextCache.revalidateTag).toHaveBeenNthCalledWith(
      1,
      PUBLIC_CACHE_TAGS.products,
      { expire: 0 },
    );
    expect(nextCache.revalidateTag).toHaveBeenNthCalledWith(
      2,
      PUBLIC_CACHE_TAGS.sitemap,
      { expire: 0 },
    );
  });

  it("keeps the mutation invalidation matrix explicit", () => {
    expect(PUBLIC_CACHE_INVALIDATION).toEqual({
      content: [PUBLIC_CACHE_TAGS.content],
      product: [PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap],
      pricing: [PUBLIC_CACHE_TAGS.products, PUBLIC_CACHE_TAGS.sitemap],
      gallery: [
        PUBLIC_CACHE_TAGS.gallery,
        PUBLIC_CACHE_TAGS.galleryMedia,
        PUBLIC_CACHE_TAGS.sitemap,
      ],
      review: [PUBLIC_CACHE_TAGS.reviews, PUBLIC_CACHE_TAGS.reviewMedia],
    });
  });
});
