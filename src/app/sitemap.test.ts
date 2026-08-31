import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProductRegistry } from "@/domain/catalogue/product-registry";

const state = vi.hoisted(() => ({
  getRegistry: vi.fn(),
  getSafeRegistry: vi.fn(),
  listDesigns: vi.fn(),
  cacheEpoch: 0,
  cacheConfig: null as null | {
    key: string;
    tags: readonly string[];
    revalidate: number | false;
  },
}));

vi.mock("@/server/admin/product-registry-runtime", () => ({
  getProductRegistryRuntime: () => ({ current: state.getRegistry }),
  getSafePublicProductRegistry: state.getSafeRegistry,
}));
vi.mock("@/server/gallery/gallery-runtime", () => ({
  getGalleryRuntime: () => ({
    publicService: { listSitemapDesigns: state.listDesigns },
  }),
}));
vi.mock("@/server/seo/site-url", () => ({
  getSiteUrl: () => new URL("https://rrgallery.co.nz"),
}));
vi.mock("@/server/cache/public-cache-tags", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/cache/public-cache-tags")>();
  return {
    ...original,
    cachePublicData: (
      loader: () => Promise<unknown>,
      key: string,
      tags: readonly string[],
      revalidate: number | false,
    ) => {
      state.cacheConfig = { key, tags, revalidate };
      let epoch = -1;
      let value: Promise<unknown> | undefined;
      return () => {
        if (epoch !== state.cacheEpoch) {
          epoch = state.cacheEpoch;
          value = undefined;
        }
        value ??= loader().catch((error) => {
          value = undefined;
          throw error;
        });
        return value;
      };
    },
  };
});

import sitemap from "./sitemap";
import { PUBLIC_CACHE_TAGS } from "@/server/cache/public-cache-tags";

describe("public sitemap cache", () => {
  beforeEach(() => {
    state.cacheEpoch += 1;
    state.getRegistry.mockReset().mockResolvedValue({ registry: defaultProductRegistry });
    state.getSafeRegistry.mockReset().mockResolvedValue({ registry: defaultProductRegistry });
    state.listDesigns.mockReset().mockResolvedValue([]);
  });

  it("reuses one generated sitemap for two days", async () => {
    const first = await sitemap();
    const second = await sitemap();

    expect(second).toBe(first);
    expect(state.getRegistry).toHaveBeenCalledOnce();
    expect(state.listDesigns).toHaveBeenCalledOnce();
    expect(state.cacheConfig).toEqual({
      key: "sitemap",
      tags: [
        PUBLIC_CACHE_TAGS.sitemap,
        PUBLIC_CACHE_TAGS.products,
        PUBLIC_CACHE_TAGS.gallery,
      ],
      revalidate: 172_800,
    });
    expect(state.getSafeRegistry).not.toHaveBeenCalled();
  });

  it("keeps product-source failures outside the two-day cache", async () => {
    state.getRegistry.mockRejectedValue(new Error("database unavailable"));

    const first = await sitemap();
    const second = await sitemap();

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    expect(state.getRegistry).toHaveBeenCalledTimes(2);
    expect(state.getSafeRegistry).toHaveBeenCalledTimes(2);
    expect(state.listDesigns).not.toHaveBeenCalled();
  });
});
