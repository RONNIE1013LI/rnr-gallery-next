import { describe, expect, it, vi } from "vitest";
import { defaultProductRegistry } from "@/domain/catalogue/product-registry";
import { occasionLandingPages } from "@/domain/seo/occasion-landing-pages";
import { loadOccasionArtwork } from "./occasion-landing";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/server/admin/product-registry-runtime", () => ({ getSafePublicProductRegistry: vi.fn() }));
vi.mock("@/server/gallery/gallery-runtime", () => ({ getGalleryRuntime: vi.fn() }));
const item: PublicGalleryItem = { id: "a".repeat(64), productTypeSlug: "roll-up-banner", productSlug: "roll-up-banner", occasionSlug: "birthday", subOccasion: "1st Birthday", themeSlugs: [], altText: "Birthday", contentHash: "b".repeat(64), mimeType: "image/jpeg", width: 850, height: 2000 };

describe("occasion gallery loader", () => {
  it.each(Object.values(occasionLandingPages))("uses bounded cached public queries for $path", async (content) => {
    const list = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 1 });
    await loadOccasionArtwork(content, defaultProductRegistry, { list });
    expect(list).toHaveBeenCalledTimes(content.query.productTypes.length);
    expect(list.mock.calls.reduce((n, call) => n + call[1], 0)).toBeLessThanOrEqual(24);
    content.query.productTypes.forEach((type) => expect(list).toHaveBeenCalledWith({ ...content.query, page: 1, productTypes: [type] }, Math.floor(24 / content.query.productTypes.length)));
  });
  it("excludes artwork belonging to disabled products even if returned by the gallery", async () => {
    const registry = structuredClone(defaultProductRegistry);
    registry.products.find((product) => product.slug === item.productSlug)!.active = false;
    const list = vi.fn().mockResolvedValue({ items: [item], total: 1, page: 1, pageCount: 1 });
    expect(await loadOccasionArtwork(occasionLandingPages["1st-birthday-banners"], registry, { list })).toEqual([]);
  });
});
